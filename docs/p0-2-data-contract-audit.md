# Life Compass P0-2A データ契約・非破壊性 実装前監査

監査日: 2026-07-31
対象ブランチ: `hardening/p0-2-data-contract`
対象HEAD: `a306132f8fbf7a3e28a5fa1decdfc4a3e4bda2c8`
監査種別: 読み取り専用の実装前監査（生産コード・テスト・DB migrationは未変更）

## 1. 結論

P0-2の生産実装へ進む前に、現在の保存・読込契約には受入を阻害するBlockerがあります。

1. ブラウザ初期読込だけ将来version拒否を迂回し、未知形式を現行v9へ変換する。
2. 世帯メンバー、家族別詳細収支、版履歴を読込時に黙って切り捨てる。
3. ブラウザ保存失敗時にもReact stateを次データへ切り替え、画面と永続データが分離する。
4. validationとmigrationが一つの寛容なnormalizerに混在し、現行形式の破損まで「修復成功」として受け入れる。
5. 安全目的を含む版履歴を保存候補の構築時に先に削り、上記のstate分離と組み合わさると後続保存で消失し得る。
6. cloud backup取得はR2 object sizeを本文読込前に検査せず、通常作成経路外の巨大objectをWorker memoryへ全読込する。

一方、次は受入可能です。

- JSON importはファイル読込前に5 MiB上限を確認する。
- クラウドbackupと共同世帯はクライアント側AES-GCMで暗号化され、Workerへ平文planやpasswordを送らない。
- Workerはbackupをuser ID、共有planをmembershipとhousehold IDで分離する。
- 共同世帯更新はWorker側revisionとCASで競合を拒否する。
- PWA service workerは`/api/`をcacheしない。
- 撤回済みの`scenarios.slice(0, 20)`は存在せず、既存テストも22件を保持する。

判定: **P0-2実装前監査は完了。一般課金開始はBlockerと「Required before billing」の解消後に再判定する。**

## 2. 監査範囲と基準状態

### 2.1 Gitと文書

- P0-1ブランチ、HEAD、clean working tree、リモートP0-1 HEAD一致を確認後に監査ブランチを作成した。
- `docs/pro-implementation-plan.md`、`docs/pro-release-checklist.md`、`docs/pro-entitlement-matrix.md`、`docs/p0-1-acceptance-review.md`と保存・暗号化・共同世帯関連文書を確認した。
- 現HEADには`docs/pro-hardening-audit.md`と`docs/PRO_FEATURE_COMPLETION_PLAN.md`が存在しない。stashからは復元していない。
- 文書と実装に差がある場合は実装を正とした。例として、自動同期はコード上「変更後20秒、可視時60秒poll」である。

### 2.2 基準検証

| 検証 | 結果 |
|---|---|
| `npm.cmd run verify` | 成功。logic 116/116、Worker API 30/30、E2E 56/56 |
| E2E内訳 | desktop 28/28、mobile 28/28 |
| `npm.cmd run build` | 成功。TypeScriptとVite build成功 |
| `npm.cmd audit --audit-level=high` | 成功。0 vulnerabilities |
| `git diff --check` | 成功。基準時点でwhitespace error、CRLF等の警告ともになし |

正常系の回帰がないことは確認できたが、後述するatomicity、strict validation、legacy migration、上限超過の異常系は現在のテストでは固定されていない。

## 3. 現在のデータモデル

### 3.1 最上位LifePlan

`LifePlan`は単一の平坦なobjectで、`version: number`と`updatedAt: string`を持つ。次は存在しない。

- `schemaVersion`
- `appVersion`
- `planId`
- root `createdAt`
- ローカルplan content revision
- data scope（personal／household）
- migration provenance

根拠: `src/types.ts:315-338`、`src/config.ts:1-4`

Pro関連データも同じLifePlanへ埋め込まれる。

| データ | 現在の型・保存内容 | identity／参照 |
|---|---|---|
| 見直しプラン | `PlanScenario`。家計・資産・目標・イベント・simulation条件の部分snapshot | scenario `id`。元planIdなし |
| レビュー／TODO | `ReviewNote`。計画値・実績値・TODO等のscalar snapshot | review `id`。TODOは独立entityではない |
| 版履歴 | `PlanRevision`と`PlanRevisionSnapshot` | history entry `id`。`sourceReviewId`は存在確認なし |
| 老後生活プラン | root `retirementPlan` | rootに一つ |
| 家族別詳細収支 | `householdMembers`と`detailedCashflowItems.memberId` | `memberId`のみ参照検査あり |
| 固定費見直し | root `fixedCostItems`、版snapshotにも含む | item `id` |
| 詳細simulation | 入力条件を保存し、結果は都度計算 | engine version／seed／input hashなし |
| ライフプラン診断 | `src/utils/diagnosis.ts`で現行planから都度導出 | 診断結果自体は保存しない |
| 予算・実績 | `budgetItems[].actuals[YYYY-MM]` | item `id`。月key総数上限なし |

根拠: `src/types.ts:100-337`、`src/utils/planRevisions.ts:10-88`、`src/utils/reviews.ts:105-170`

### 3.2 現在使われているversion／revision

| 名前 | 現在値・意味 | 問題 |
|---|---|---|
| `LifePlan.version` | 9。実質schema version | version別validator／migration registryがない |
| cloud encryption envelope `version` | 1 | data schemaとは別だが一般名 |
| cloud plaintext wrapper `version` | 1 | data schemaとは別 |
| shared encryption envelope `version` | 1 | data schemaとは別 |
| shared plaintext wrapper `version` | 1 | data schemaとは別 |
| trusted-device payload `version` | 1 | IndexedDB credential形式 |
| `shared_households.current_revision` | Worker正の共同世帯同期revision | CASとして正しく使用 |
| `TrustedDeviceRecord.lastRevision` | 最後に同期した共同世帯revision | local plan保存とatomicではない |
| `LifePlan.planRevisions[]` | ローカル版履歴 | numeric revisionではなくentry配列 |
| entitlement `revision` | P0-1権限snapshot revision | planとは独立 |
| DB migration番号 | SQLファイル`0001`〜`0006` | plan schemaとは独立 |

`package.json`の`0.1.0`は保存データへ記録されていない。

## 4. データ経路の監査表

### 4.1 形式・identity・metadata

| データ経路 | 保存場所／key・table | 書込 | 読込 | 現在の最上位構造 | schema／versionなし | planId／revision | 時刻・checksum／認証 | 上限 |
|---|---|---|---|---|---|---|---|---|
| ブラウザ通常保存 | localStorage `life-compass-plan-v1` | `savePlan` | `loadPlan` | bare `LifePlan` | versionなしもgeneric normalize | planIdなし、revisionなし | `updatedAt`はclient時刻 | platform quotaのみ |
| default生成／reset／空plan | memory→localStorage `life-compass-plan-v1` | `resetPlan`／`startEmptyPlan`→`commitPlan` | `cloneDefaultPlan`／`createEmptyPlan` | bare `LifePlan` | current version 9を生成 | planId／revisionなし | client `updatedAt` | platform quotaのみ |
| 復旧用コピー | localStorage `life-compass-recovery-v2` | `createRecoveryBackup` | `getRecoveryBackups` | `RecoveryBackup[]` | 各planをgeneric normalize | recovery UUID、planIdなし | client `createdAt` | 3件rolling |
| 読込不能raw | localStorage `life-compass-recovery-v2-unreadable` | `preserveUnreadablePlan` | UI読込なし | raw string | 判定なし | なし | なし | 1 slot、次回上書き |
| JSON export | user file | `exportPlan` | file input | bare `LifePlan` | `version`のみ | planIdなし | exportedAt／checksumなし | export時上限なし |
| JSON import | memory→localStorage | `DataView.handleImport` | `FileReader` | bare `LifePlan` | versionなし受入、futureは拒否 | planIdなし | authなし（local file） | file 5 MiB |
| cloud backup作成 | R2 `BACKUPS`＋D1 `cloud_backups` | `encryptCloudBackup`、`POST /api/backups` | 一覧GET | encrypted envelope v1、内側wrapper v1＋LifePlan | inner LifePlanは現状のversion | backup UUID、planIdなし | inner client `createdAt`、D1 server `created_at/updated_at`、encryptedAtなし、AES-GCM＋R2 checksum＋user auth | plaintext producer 5 MiB、body 7 MiB、5件 |
| cloud backup復元 | R2 `BACKUPS`／D1 `cloud_backups`→client→localStorage | `restoreCloudPlan`／`commitPlan` | `GET /api/backups/:id` | 復号後LifePlan | generic normalize | backup IDとplan identityは無関係 | D1 server時刻、Worker checksum後にAES-GCM認証 | producer上限は同上。復号consumer再検査なし |
| shared push | R2 `SHARED_PLANS`＋D1 `shared_households`／`shared_plan_revisions`／`household_audit_events`／`shared_plan_object_cleanup` | `saveSharedPlan` | Worker PUT | encrypted shared envelope v1 | inner LifePlan version | `householdId + householdRevision`、planIdなし | D1 server `updated_at/created_at`、encryptedAtなし、AAD＋R2 checksum＋membership | plaintext producer 5 MiB、body 7 MiB |
| shared pull | R2 `SHARED_PLANS`＋D1 `shared_households`／`shared_plan_revisions`→localStorage | `commitPlan` | current GET | 復号後LifePlan | `validateImportedPlan` | household revision、planIdなし | D1 revision `created_at`、membership＋AES-GCM | producer 5 MiB。復号consumer再検査なし |
| shared revision読込 | 同R2／D1 tables→localStorage | 後続syncで新revisionになり得る | revision GET | 過去暗号envelope | 同上 | 過去revisionをlocalへ反映 | D1 revision `created_at`、membership＋AES-GCM | list／retention目標10。cleanup失敗中は一時超過 |
| 見直しプラン採用 | localStorage `life-compass-plan-v1` | `adoptScenario`→`commitPlan` | 現在React state内scenario | bare `LifePlan`。採用前planをscenario／historyへ複製 | root version 9、versionなしもgeneric normalize | root planIdなし。scenario／history UUID | client `adoptedAt`／`createdAt`／`updatedAt` | scenario 20、history 8を作成時slice |
| 版履歴復元 | localStorage `life-compass-plan-v1` | `restorePlanRevision`→`commitPlan` | 現在React state内`planRevisions` | bare `LifePlan`。復元前historyを追加 | root version 9、versionなしもgeneric normalize | root planId／numeric content revisionなし。history UUID | client `createdAt`／`updatedAt` | history 8を作成・読込時slice |
| レビュー保存 | localStorage `life-compass-plan-v1` | `addReview`／`updateReview`→`commitPlan` | 現在React state内`reviews` | bare `LifePlan`。reviewと作成時history | root version 9、versionなしもgeneric normalize | review UUID、root revisionなし | review domain date＋client `createdAt`／`updatedAt` | review件数の明示上限なし、history 8 |
| 老後生活プラン保存 | localStorage `life-compass-plan-v1` | `updateRetirementPlan`→`commitPlan` | 現在React state内`retirementPlan` | bare `LifePlan`のroot settings | root version 9、versionなしもgeneric normalize | root planId／revisionなし | root client `updatedAt` | field UI範囲のみ、object safety上限なし |
| trusted sync state | IndexedDB `life-compass-secure-device` | device-store functions | 同左 | household/revision metadata＋暗号化password／digest | payload v1のみ | householdId、keyEpoch、lastRevision。Google sub／planIdなし | non-extractable AES-GCM device key | 明示count上限なし。markerは1世帯だけ |
| app設定／通知marker | localStorage | `saveAppSettings`、App notification | load／getItem | settings object／date string | settings v1 keyのみ | なし | なし | 明示上限なし |
| PWA cache | CacheStorage `life-compass-v6` | service worker | service worker | static response | cache name v6 | なし | browser cache | `/api/`は除外 |

### 4.2 validation・migration・置換

| 経路 | 読込前安全確認 | validation／migration | 破損・失敗時 | 現在データの変更時点 | atomic replace／rollback | 根拠 |
|---|---|---|---|---|---|---|
| ブラウザ初期読込 | 明示byte/depth確認なし | 浅いroot確認後にgeneric normalize。future version判定なし | parse errorはraw退避、semantic errorの一部は退避せずdefault | React初期state構築時 | localStorageは書換えないが次の編集で上書き可能 | `storage.ts:246-257,337-386` |
| 通常編集 | UI入力制約 | save前strict validationなし | `setItem`失敗時にcatchで画面stateを次planへ変更 | 成功時はsave後、失敗時は未保存stateへ変更 | 不成立 | `useLifePlanEditor.ts:138-148` |
| default生成／reset／空plan | reset前recovery作成だけ必須 | default自体はcode生成、plan全体strict validationなし | recovery成功後のmain保存失敗でもstateを変更し、成功messageを出す | `commitPlan`内 | recoveryとmainは別keyでatomicでない | `useLifePlanEditor.ts:764-784` |
| JSON import | File.size 5 MiB | parse→浅い検査→generic normalize | recovery成功後main保存失敗でUIだけ新plan | main `setItem`後が理想だが失敗catchでstate変更 | cross-key transactionなし | `DataView.tsx:54-80` |
| recovery復元 | 明示sizeなし | get時generic normalize | recovery key破損は空扱い | recovery追加後main保存 | main失敗時UIだけ新plan | `DataView.tsx:97-111` |
| cloud復元 | Worker checksum、client envelope／AES-GCM | 復号後にgeneric normalize | local save失敗でもCloud panelは成功文言を出し得る | recovery追加後main保存 | cross-system rollbackなし | `CloudBackupPanel.tsx:178-199`、`DataView.tsx:122-131` |
| shared pull | Worker size・checksum、client AES-GCM | 復号後generic normalize | local save失敗でUIだけremote、metadataは旧 | recovery→main→IDB metadata | recoverable journalなし | `useHouseholdAutoSync.ts:129-148` |
| shared push | client plaintext size、Worker envelope size | encrypt前generic digest | Worker成功・IDB失敗でserverだけrevision進行 | Worker CAS成功後metadata | 分散transaction不可、再調停のみ | `useHouseholdAutoSync.ts:266-325` |
| shared revision読込 | 同上 | 同上 | 読込はlocal置換のみ。専用restore APIなし | local反映後に通常sync | source revisionのauditなし | `HouseholdSharingPanel.tsx:193-199,551-566` |
| 見直しプラン採用 | UI上限確認のみ | current scenario／snapshotもgeneric normalize由来。参照完全性検査なし | 採用前historyを候補内で先にsliceし、main保存失敗でもstateは採用後になり得る | `commitPlan`内 | atomicでなく、採用前history成功を独立確認しない | `useLifePlanEditor.ts:615-630`、`scenarios.ts:312-335` |
| 版履歴復元 | 対象ID存在確認 | history snapshotを現在planへ展開。復元前historyも同一candidateへ追加 | main保存失敗でもstateは復元後になり得る | `commitPlan`内 | atomicでなく、復元前history成功を独立確認しない | `useLifePlanEditor.ts:405-417`、`planRevisions.ts:78-87` |
| レビュー保存 | UI入力制約 | reviewのstrict validator／参照検査なし | reviewとhistoryを同一candidateにし、main保存失敗でもstateだけ変わり得る | `commitPlan`内 | atomicでなくrollbackなし | `useLifePlanEditor.ts:342-369`、`reviews.ts:105-170` |
| 老後生活プラン保存 | UI入力範囲 | field更新後のplan全体strict validationなし | main保存失敗でもstateだけ変わり得る | 各入力changeの`commitPlan` | atomicでなくrollbackなし | `useLifePlanEditor.ts:310`、`RetirementPlanView.tsx:126-183` |

表4.1と4.2で依頼されたfieldを形式と処理に分割した。明記がないbare `LifePlan`経路には`schemaVersion`、`appVersion`、root `planId`、root `createdAt`、`exportedAt`、`encryptedAt`、content revisionがなく、version別migration、migration後validation、全entity参照整合性検査もない。local操作の利用者errorは`storageError`または成功messageとの混在、Worker操作はAPI error codeからの表示であり、共通の構造化data-contract errorは未実装である。

5 MiBはJSON fileと暗号化前producerでの上限である。cloud／sharedの復号consumerは認証済みplaintextのbyte数を復号後に再検査しておらず、Worker側が保証するのは暗号化request body 7 MiBまでである。P0-2ではproducer制限をconsumer validationの代用にしない。

## 5. 指摘一覧

分類は`Blocker`、`Required in P0-2`、`Required before billing`、`Follow-up`、`Accepted`で表す。各指摘の「必要テスト」に明記しないtest層は原則として非該当であり、DB migrationを「不要」とした項目はplan／client migrationだけを検討対象とする。

### P2A-B01 — ブラウザ初期読込が未知の将来schemaを現行v9として扱う

- 分類／重要度: **Blocker / High**
- 根拠: `src/utils/storage.ts:246-257,322-373`
- 現在の挙動: JSON importは`version > 9`を拒否するが、`loadPlan`は`validateImportedPlan`を通さず、future versionも`normalizePlan`でv9へ変換する。必須root欠落時はrawを退避せずdefaultを返す。
- 想定事故／影響: 新しいアプリで保存した未知fieldが旧アプリ起動後の次回保存で失われる。JSON parse失敗時はrawを別keyへbest-effort退避するだけでUIから読込／exportできず、退避失敗も握りつぶしてdefaultを表示するため、次編集でmainを上書きし得る。semantic corruptionは退避対象外の場合がある。
- 互換性／セキュリティ: forward compatibilityを破壊する。直接の認可漏れではないが、攻撃的local dataを寛容に解釈する。
- 推奨対応: 全経路を共通read pipelineへ統合し、整数schemaVersionをparse直後に判定する。futureは現在stateとstorageを変更せず、raw export導線を出す。
- 対応フェーズ: P0-2.1〜P0-2.4
- migration／DB migration: plan migration必要、DB migration不要。
- 必要テスト: unitで起動時future／fractional／negative／欠落root、E2Eでrawと画面stateの不変。Worker API不要。
- 既存データ／rollback: release commit／tagまたは旧exportで形状を確認できたversionだけをhistorical fixtureとして先に固定し、readerをfeature flagで切戻せる単位にする。

### P2A-B02 — 読込時の黙示的切り捨て

- 分類／重要度: **Blocker / Critical（データ消失）**
- 根拠: `src/utils/storage.ts:170-219,337-373,407-429`、`tests/calculations.test.ts:3022-3078`
- 現在の挙動: 世帯メンバー20人、家族別詳細収支200件、版履歴8件を`.slice()`する。import、browser load、recovery、cloud restore、shared pullでも共通して発生する。
- 想定事故／影響: 上限超過分とその参照が利用者への確認なしに消える。member ID再生成・null化により収支の帰属も変わる。
- 互換性／セキュリティ: 旧データや別版データのlossless recoveryを保証できない。DoS対策としてproduct上限を流用しているが、安全上限としての根拠はない。
- 推奨対応: validator／migrationから切り捨てを除く。product上限超過は全件保持したread-only整理状態、安全上限超過は全体拒否とする。
- 対応フェーズ: P0-2.1、P0-2.2、P0-2.7
- migration／DB migration: lossless migration必要、DB migration不要。
- 必要テスト: 20/21、200/201、8/9と安全上限境界を全経路のunit／E2Eへ追加。shared fixtureも必要。
- 既存データ／rollback: 先に現在rawをexport可能にし、旧normalizerへ戻す場合もraw backupを残す。

`scenarios`は現HEADで切り捨てておらず、22件保持テストがあるため、この点はAcceptedである。

### P2A-B03 — 保存失敗時に画面stateだけ置換される

- 分類／重要度: **Blocker / Critical（atomicity）**
- 根拠: `src/hooks/useLifePlanEditor.ts:138-148`、`src/views/DataView.tsx:54-131`、`src/components/CloudBackupPanel.tsx:178-199`
- 現在の挙動: `savePlan`が失敗しても`commitPlan`は`nextPlan`をstateへ入れる。cloud restore側はcallbackのbooleanを受けず、復元成功messageを表示し得る。
- 想定事故／影響: 画面は新plan、localStorageは旧planとなる。`resetPlan`と`startEmptyPlan`もcommit結果を確認せず成功messageを出す。利用者が成功と誤認し、次の成功保存で意図しない全体上書きが起きる。
- 互換性／セキュリティ: JSON、backup、共有の全restoreに波及する。権限問題ではないが信頼境界の表示を破壊する。
- 推奨対応: candidateのcanonical bytes／digestをstate外で構築し、pre-change recoveryとmainを同一transactionでcommitする。transaction completionを永続化成功境界とし、その後だけstateを更新する。callbackは構造化結果を返し、成功messageを一か所で決める。
- 対応フェーズ: P0-2.4、P0-2.5、P0-2.8
- migration／DB migration: 不要。
- 必要テスト: quota／recovery候補／main候補／transaction abortの各pre-commit失敗でstateとmain recordのbyte-for-byte不変をunit/E2Eで確認。commit後検証を追加する場合はjournalによる補償を別途検証する。
- 既存データ／rollback: 書込関数の旧実装を一コミットで戻せるよう、UI変更と分離する。

### P2A-B04 — strict validationとlegacy migrationが分離されていない

- 分類／重要度: **Blocker / High**
- 根拠: `src/utils/storage.ts:135-160,322-373,388-698`
- 現在の挙動: 不正日時を現在時刻へ、欠落IDを新IDへ、未知enumをdefaultへ、極端値をclampして成功扱いする。schemaVersion別validatorはない。
- 想定事故／影響: current schemaの破損や参照不整合までlegacy migrationとして受け入れ、意味の違うデータへ変換して置換する。
- 互換性／セキュリティ: duplicate ID、dangling reference、unknown fieldを検知できない。入力の形状によって計算量が大きくなる。
- 推奨対応: version別strict validator、pure migration、migration後validator、参照整合性validatorを分離する。自動補正は明示されたmigration stepだけで行う。
- 対応フェーズ: P0-2.1〜P0-2.3
- migration／DB migration: pure plan migration必要、DB migration不要。
- 必要テスト: authentic legacy fixture、current corruption、duplicate、dangling ref、invalid date/number、idempotence。
- 既存データ／rollback: 最初はshadow validationで実測し、拒否対象を確認してからread pathを切り替える。

### P2A-B05 — 版履歴・安全copyのretentionが保存成功と一体化されていない

- 分類／重要度: **Blocker / High**
- 根拠: `src/utils/planRevisions.ts:75-87`、`src/hooks/useLifePlanEditor.ts:342-417,615-630`、`src/utils/storage.ts:274-300`
- 現在の挙動: 新履歴候補を作る時点で8件へsliceする。保存失敗後にもstateが候補へ変わる。recoveryは3件へsliceし、破損時は全件空扱いになる。
- 想定事故／影響: 採用前・復元前・レビュー時の安全履歴が通常履歴と競合し、意図せず最古履歴を失う。失敗後の次回保存で消失が確定し得る。
- 推奨対応: manual historyとsafety checkpointを分離する。rolling pruneは新candidateの永続化成功が保証されるtransaction内だけで行い、import/migration中はpruneしない。
- 対応フェーズ: P0-2.7、P0-2.8
- migration／DB migration: 既存履歴の分類migrationが必要になる可能性あり。DB migration不要。
- 必要テスト: 8→9件、保存失敗、採用前／復元前copy失敗、safety優先、rollback。
- 既存データ／rollback: 既存8件を削除せずtype不明のlegacy historyとして保持する。

### P2A-R01 — root plan identityとlocal content revisionがない

- 分類／重要度: **Required in P0-2 / High**
- 根拠: `src/types.ts:315-338`、`src/hooks/useLifePlanEditor.ts:133-149`
- 現在の挙動: 一つのlocalStorage slotを全snapshotで置換する。JSON復元と複製、personalとhouseholdのidentityを区別できない。複数tabはlast-write-wins。
- 想定事故／影響: 同一JSON重複import、plan衝突、別scopeへのcopyを追跡できない。
- 推奨対応: UUID `planId`、成功保存時だけ進む`contentRevision`、不変`createdAt`をcanonical envelopeへ追加する。
- 対応フェーズ: P0-2.1〜P0-2.6
- migration／DB migration: legacy planへのID付与migration必要。planIdを暗号内に置くならDB migration不要。
- テスト／rollback: restore/copy/衝突/複数tabのunit＋E2E。legacy readerを残してrollbackする。

### P2A-R02 — ID重複と参照整合性を検証しない

- 分類／重要度: **Required in P0-2 / High**
- 根拠: `src/utils/storage.ts:139-140,170-219,407-429,553-698`
- 現在の挙動: household member重複だけID再発行し、他entityの重複は許す。dangling `memberId`はnull化、`sourceReviewId`は未検査。
- 想定事故／影響: Map描画や更新で一方が見えなくなる。ID再発行後に参照の意味が変わる。
- 推奨対応: plan内でentity typeごとのunique、参照関係の明示、曖昧な自動修復禁止。historical pointerはlive FKと区別する。
- 対応フェーズ: P0-2.1〜P0-2.3
- migration／DB migration: duplicateを持つ実データの救済規則が必要。DB不要。
- テスト／rollback: duplicate／dangling／historical pointer fixture。変換mappingを保存してrollback可能にする。

### P2A-R03 — product上限とsafety上限が混在し、複数種別に絶対上限がない

- 分類／重要度: **Required in P0-2 / High、Required before billing**
- 根拠: `src/config.ts:5-19`、`src/features.ts:76-100`
- 現在の挙動: file 5 MiB以外にdepth、総node、単一文字列長がない。goal、event、review、budget、fixed cost等は件数上限なし。
- 想定事故／影響: 5 MiB内でも多数の小entityや深いobjectでmobile UI／計算を停止させ得る。
- 推奨対応: productとabsolute safetyを別定数・別errorにし、性能fixtureで値を固定する。
- 対応フェーズ: P0-2.1、P0-2.2、P0-2.7
- migration／DB migration: 不要。既存超過データは保持または全体拒否を種別ごとに選ぶ。
- テスト／rollback: byte、depth、node、string、各配列境界。limit設定は一ファイルで戻せるようにする。

### P2A-R04 — cloud／sharedの外側planVersionはinner schema／plan identityと結び付かない

- 分類／重要度: **Required in P0-2 / Medium、Required before billing**
- 根拠: `src/utils/cloudBackupCrypto.ts:67-124`、`worker/backups.js:159-218`、`worker/sharedPlans.js:132-138,333-463`、`migrations/0001_auth_billing_backup.sql:28-39`、`migrations/0005_household_sharing_foundation.sql:70-83`
- 現在の挙動: cloud／sharedともclient申告`planVersion`をD1へ保存・応答するが、暗号内LifePlanとWorkerは照合できない。backupIdとplanIdの関係もない。
- 想定事故／影響: 一覧のversion表示が誤る。復号後に初めて互換性を判断する。
- 推奨対応: schemaの正は暗号内canonical envelopeとし、D1 `plan_version`は両経路とも非信頼hintとして扱う。migration判断へ使わず、復号後のinner schemaと不一致でも現在データを変えない。planIdは暗号内、backupId／householdIdは外側で分離する。
- 対応フェーズ: P0-2.5、P0-2.6
- migration／DB migration: D1 columnの意味を再定義するだけなら不要。renameや新metadataが必要なら別migration。
- テスト／rollback: 外側hintとinner schema不一致、future inner schema、復号後無変更。既存envelope v1 readerを保持。

### P2A-R05 — shared planと端末metadataの分散更新にjournalがない

- 分類／重要度: **Required in P0-2 / High**
- 根拠: `src/hooks/useHouseholdAutoSync.ts:129-148,266-325`、`src/utils/sharedPlanDeviceStore.ts:81-99`
- 現在の挙動: pullはlocal plan後にIDB cursor、pushはWorker成功後にIDB cursorを更新する。さらに`saveMetadata`はIDB promise完了前にmemory credential／`lastSyncedAt`を進める。後段失敗でserver、local plan、IDB、same-session UIの一部だけが進む。
- 想定事故／影響: 再起動後に同じremoteを再適用、server revisionが進んだのにlocal cursorが古い、または同一sessionだけ成功済みと誤表示する状態になる。
- 推奨対応: pending operation journalと再起動reconcileを導入し、成功表示は全local metadata確定後にする。
- 対応フェーズ: P0-2.6、P0-2.8
- migration／DB migration: IndexedDB version migrationの可能性あり。D1不要。
- テスト／rollback: 各phase失敗、IDB resolve前のmemory cursor不変、response喪失、再起動、reconcile。旧device record readerを残す。

### P2A-R06 — 共同世帯revision復元が独立したサーバー操作ではない

- 分類／重要度: **Required in P0-2 / Medium**
- 根拠: `src/components/HouseholdSharingPanel.tsx:193-199,551-566`、`worker/sharedPlans.js:469-488`
- 現在の挙動: 過去版をlocalへ読込み、後続の通常syncで新revisionになり得る。audit eventは常に`saved`で、`restored`はschemaにあるが未使用。key rotation後も過去revisionは旧keyEpochのままで、現在passwordだけでは復号できない場合がある。
- 想定事故／影響: どのrevisionから復元したか追跡できず、復元と通常編集の競合を区別できない。
- 推奨対応: 過去revisionを直接currentへ戻さず、source revisionを持つ新しいhousehold revisionをCASで作成する。旧keyEpoch版は旧passwordを明示入力してclientで復号し、現在keyEpochへ再暗号化する。旧passwordがなければ削除せず復元不可とする。
- 対応フェーズ: P0-2.6
- migration／DB migration: `household_audit_events.source_revision`を追加するDB migrationが必要。
- テスト／rollback: current更新との競合、source audit、失敗時current不変。

### P2A-R07 — trusted-device credentialの失効後残存

- 分類／重要度: **Required before billing / Medium**
- 根拠: `src/hooks/useHouseholdAutoSync.ts:150-264,382-390`、`src/utils/sharedPlanDeviceStore.ts:14-21,101-184`、`src/components/AccountPanel.tsx:177-243`
- 現在の挙動: 実行中に検出したkeyEpoch不一致と明示解除では削除するが、起動時のkeyEpoch不一致はloadをnullにするだけでrecord／markerを残す。recordはGoogle sub／planIdに結び付かず、logout、account切替、membership不在、将来device payload versionの一部経路でも残存または破壊的削除になり得る。
- 想定事故／影響: server権限は失効しても、同一browserのXSS等が古いcredentialへ到達する残留リスク。
- 推奨対応: recordをverified session由来のserver発行opaque account binding、householdId、planIdへ結び、全record列挙と冪等cleanupを実装する。除名、退出、account削除、別account切替、keyEpoch mismatch、stale markerを明示matrixで扱う。未知の将来device versionは削除せずquarantine／disableする。通常logoutで保持するかは人間判断。
- 対応フェーズ: P0-2.6
- migration／DB migration: IDB cleanupのみ。DB不要。
- テスト／rollback: logout／除名／退出／切替／keyEpoch mismatch／future device version後の全record、marker、server拒否、冪等cleanup。

### P2A-R08 — timestamp契約が不統一

- 分類／重要度: **Required in P0-2 / Medium、Required before billing**
- 根拠: `src/utils/storage.ts:157-160`、`migrations/0005_household_sharing_foundation.sql:5-14,70-84`
- 現在の挙動: localはISO `Z`、D1 `CURRENT_TIMESTAMP`はtimezone suffixなし。不正日時を現在時刻へ置換する。
- 想定事故／影響: 並び順・更新判断・migration provenanceが端末timezoneやparse実装で変わる。
- 推奨対応: canonicalはUTC ISO 8601 `YYYY-MM-DDTHH:mm:ss.sssZ`。不正値は拒否し、server metadataはWorker側時刻を正とする。
- 対応フェーズ: P0-2.1、P0-2.6
- migration／DB migration: D1 responseの正規化で足りる可能性あり。
- テスト／rollback: timezone、invalid、future skew、createdAt不変、updatedAt成功時のみ更新。

### P2A-R09 — 個人cloud backupのR2／D1部分失敗を回収する台帳がない

- 分類／重要度: **Required before billing / High**
- 根拠: `worker/backups.js:179-232`。共同世帯側の回収台帳は`migrations/0006_shared_plan_cleanup.sql:1-12`にあるが、個人backup側には同等物がない。
- 現在の挙動: 作成はR2→D1、D1失敗時はR2削除。削除はR2→D1。cleanup自体の失敗や、R2削除後のD1失敗を表す永続状態がない。
- 想定事故／影響: 未追跡の暗号objectが残る、または一覧に行があるのに復元objectがない状態になる。既存plan平文は漏れないが、復元可能性と保存料金へ影響する。
- 推奨対応: client生成`operationId`を`(user_id, operation_id)`でuniqueにし、D1 transactionで5件quota slotと`pending_create`を同時確保する。R2成功後`active`、削除時は`active`→`pending_delete`→row削除へ遷移させ、server phaseはbackup IDでCron再試行する。一覧はactiveだけを返す。
- 対応フェーズ: P0-2.5またはbilling前storage hardening
- migration／DB migration: **operation ID、state、quota slotのDB migrationが必要**。P0-2.1には含めない。
- テスト／rollback: D1 insert失敗＋R2 delete失敗、R2 delete成功＋D1 finalize失敗、Cron再試行。既存rowはactiveへbackfillする。

### P2A-R10 — cloud backup取得時にR2 objectのサイズを本文読込前に検証しない

- 分類／重要度: **Blocker / High**
- 根拠: `worker/backups.js:203-218`
- 現在の挙動: POSTは7 MiBで制限するが、GETは`object.text()`で全objectを読み、`object.size`とD1 `size_bytes`の一致を先に確認しない。
- 想定事故／影響: 通常POST経路は7 MiBで制限されるため直接の一般requestはboundedだが、管理操作、旧実装、破損objectにはその保証がなく、WorkerがR2 object全体を無条件にmemoryへ保持する。JSON parse errorも安定したintegrity errorへ正規化されない。Blocker基準の「巨大入力を無制限にparse・保持」に該当する。
- 推奨対応: `object.size <= absolute limit`、D1 size一致、R2 custom metadata一致を本文読込前に確認する。
- 対応フェーズ: P0-2.5
- migration／DB migration: 不要。
- テスト／rollback: 過大object、size mismatch、metadata mismatch、不正JSON。readerのみの変更単位で切戻す。

### P2A-R11 — legacy cloud backup rowのchecksum／encryption version規則が未定義

- 分類／重要度: **Required in P0-2 / Medium**
- 根拠: `migrations/0001_auth_billing_backup.sql:28-39`、`migrations/0003_cloud_backup_encryption_version.sql:1-4`、`worker/backups.js:207-217`
- 現在の挙動: `checksum_sha256`はnullable、`encryption_version`は後付けdefault 1だが、GETはchecksum必須として比較する。
- 想定事故／影響: legacy rowが一律integrity errorになる、またはdefault 1を根拠なく受け入れる判断が将来混入する。
- 推奨対応: checksumなしrowを隔離・拒否・再計算のどれにするかmigration runbookで固定し、fail-openにしない。
- 対応フェーズ: P0-2.5
- migration／DB migration: backfill方針によりdata migrationが必要。schema migrationは必須ではない。
- テスト／rollback: null checksum、旧row、encryption version不一致、原envelope再取得。

### P2A-R12 — shared R2読込がD1 size／R2 metadata不一致を検査しない

- 分類／重要度: **Required in P0-2 / Medium、Required before billing**
- 根拠: `worker/sharedPlans.js:149-174,370-377`
- 現在の挙動: shared readerはR2 object上限、checksum、JSON、期待envelopeを検査するが、`object.size`とD1 `size_bytes`、R2 custom metadataの一致を本文読込前後に照合しない。
- 想定事故／影響: partial write、管理操作、metadata破損を一貫したintegrity errorとして検出できない。平文漏えいではないが復元・同期の信頼性を落とす。
- 推奨対応: 本文読込前にabsolute size、D1 size、R2 metadataを照合し、不一致はcurrent local planとcursorを変えず拒否する。
- 対応フェーズ: P0-2.6
- migration／DB migration: 不要。
- 必要テスト: Worker APIでsize／metadata mismatch、unit/E2Eでlocal state／cursor不変。既存正常envelope fixtureをrollback基準にする。

### P2A-R13 — Pro snapshotの復元対象が型に黙示され、利用者契約になっていない

- 分類／重要度: **Required in P0-2 / Medium**
- 根拠: `src/types.ts:239-313`、`src/utils/calculations.ts:366-377`、`src/utils/planRevisions.ts:78-87`
- 現在の挙動: scenario snapshotは家計・資産・目標・event・simulation等だけを持ち、採用時にprofile、老後／取崩し、予算実績、レビュー等は現在値を維持する。PlanRevision snapshotはより広いがreviews、scenarios、history自体を含まず、復元時にも現在のreviews／scenariosを維持する。
- 想定事故／影響: 「採用」「版へ戻す」を完全snapshot復元と理解した利用者に、時点の異なるdataが混在して見える。直接の消失ではないが、比較・復元の再現性を誤認させる。
- 推奨対応: P0-2では現挙動を目的外に変えず、snapshot kindごとの含有field、維持field、参照境界をversioned contractとfixtureへ固定する。完全snapshot化は別の商品判断とする。
- 対応フェーズ: P0-2.1〜P0-2.3
- migration／DB migration: plan migrationでsnapshot discriminatorが必要になる可能性あり。DB不要。
- 必要テスト: scenario採用とhistory復元で「置換されるfield／維持されるfield」をunitとE2Eへ追加。既存snapshotを削除せずlegacy kindとして読む。

### P2A-R14 — shared復号成功後のschema errorまでpassword／破損errorへ丸める

- 分類／重要度: **Required in P0-2 / High、Required before billing**
- 根拠: `src/utils/sharedPlanCrypto.ts:170-191`
- 現在の挙動: AES-GCM decrypt、plaintext JSON／wrapper検査、`validateImportedPlan`を一つのcatchで囲み、future schemaやvalidation失敗も「共有password違い／改ざん・破損」として返す。
- 想定事故／影響: 認証済みの新しいschemaを破損と誤表示し、更新すれば救済できる利用者がpassword再入力を繰り返す。migration／compatibility telemetryも失われる。
- 推奨対応: authenticated decryptと、wrapper parse→schema判定→migration→validationをphase分離する。認証失敗は曖昧な一般messageを維持し、認証成功後のfuture schemaは`UNSUPPORTED_SCHEMA_VERSION`としてremoteとlocal current／cursorを変えず返す。
- 対応フェーズ: P0-2.6
- migration／DB migration: client処理のみ。DB不要。
- 必要テスト: 正password＋future／legacy不正／invalid reference、誤password、ciphertext改ざんをunitとdesktop/mobile E2Eで分離する。既存envelope v1 readerを維持する。

### P2A-F01 — app settingsは型検証・保存失敗表示がない

- 分類／重要度: **Follow-up / Low**
- 根拠: `src/utils/settings.ts:22-43`
- 現在の挙動: parsed objectをdefaultへspreadし、save例外をAppで捕捉しない。
- 影響: plan自体ではないが、壊れた設定でUI挙動が変わる可能性。
- 推奨対応: settings専用version／validatorと非破壊fallback。P0-2 coreと別commit。
- migration／DB migration: local settings migrationのみ。
- テスト／rollback: malformed settings、quota failure。

### P2A-A01 — 暗号化backup／共有planは平文をWorkerへ送らない

- 分類／重要度: **Accepted / High security invariant**
- 根拠: `src/utils/cloudBackupCrypto.ts:67-100`、`src/utils/sharedPlanCrypto.ts:112-154`、`worker/backups.js:67-103`、`worker/sharedPlans.js:76-130`
- 評価: AES-GCM、PBKDF2-SHA-256 600,000、16-byte salt、12-byte IV。shared AADはhouseholdId／revision／keyEpochを結ぶ。Workerはallowlist envelopeだけをR2へ保存する。
- 注意: Worker checksumはR2保存破損検知であり、暗号認証の代替ではない。
- migration／DB migration: P0-2では暗号方式migration不要。canonical plaintextのclient migrationのみ。
- テスト／既存データ／rollback: crypto unitとWorker APIで平文field拒否・既存envelope v1復号を継続し、desktop/mobile E2Eでbackup／sharedを確認する。v1 readerを維持する。

### P2A-A02 — 共同世帯CASは無条件上書きを防止する

- 分類／重要度: **Accepted / High integrity invariant**
- 根拠: `worker/sharedPlans.js:315-516`、`migrations/0005_household_sharing_foundation.sql:70-84`
- 評価: client `expectedRevision`とserver currentを照合し、Workerが次revisionを決める。D1 updateでもexpected値を再確認し、競合は409にする。
- 注意: FakeD1の`batch`は実D1 transaction rollbackを完全には模倣しないため、integration testは後続で必要。
- migration／DB migration: 現CAS自体のschema migration不要。restore source audit追加時だけ別migration。
- テスト／既存データ／rollback: Worker APIの競合・古い再送を維持し、real D1 integrationとE2Eでcurrent不変を追加する。現revision列を正として維持する。

### P2A-A03 — PWAはAPIをcacheしない

- 分類／重要度: **Accepted / High privacy invariant**
- 根拠: `public/sw.js:1-63`
- 評価: app shell／static assetのみを扱い、`/api/`、認証、課金、backup、共有data responseはcache対象外。
- migration／DB migration: 不要。
- テスト／既存データ／rollback: desktop/mobile E2Eまたはservice-worker unitでAPI非cacheを固定する。既存cache migration不要で、変更時は旧cache名の通常cleanupだけを行う。

現行D1／wire roleはowner／editorのみで、viewerはP0-1の型・policyにあるだけでD1、招待、API、UIへ未実装である。P0-2の保存形式監査でviewerを既存persisted roleとして扱わない。

なお、repositoryの`wrangler.jsonc`には`CLOUD_BACKUP_MODE`がない。実行時設定が別途存在しなければWorkerはdisabledになるが、この監査では本番Cloudflare環境値を確認していないため、本番有効／無効は断定しない。

## 6. 上限監査

| データ種別 | 現在の商品上限 | 現在の安全上限 | 現在の超過挙動 | P0-2推奨 |
|---|---:|---:|---|---|
| scenario | Pro 20 | なし（file 5 MiBのみ） | 新規追加拒否、読込は全件保持 | 20超は保持・整理、性能測定後に別safety cap |
| 詳細収支 | 200 | 200を流用 | 読込時slice | 200超を保持・追加停止、absolute cap超は全体拒否 |
| 版履歴 | 8 | 8を流用 | 作成・読込でslice | manual/safetyを分離、8超legacyは保持 |
| household member | 20 | 20を流用 | 読込時slice、参照null化 | 20超を保持・追加停止 |
| recovery | 3 rolling | localStorage quota | 作成・読込でslice | 明示rolling policy。破損rawを保持 |
| cloud backup | 5 | plaintext 5 MiB、body 7 MiB | 5件で409 | 維持可能 |
| shared revision | list／retention目標10 | body 7 MiB、revision件数のabsolute値は未確定 | cleanupはbest effortで、一時的に11件以上残り得る | currentを保護する別safety capをP0-2.2の性能検証後に決定 |
| JSON | 該当なし | 5 MiB | parse前拒否 | 維持し、depth/node/string cap追加 |
| goal/event/review/budget/fixed cost等 | なし | file 5 MiBのみ | 全件受入 | 性能fixtureでabsolute capを決定 |
| actual月key | なし | file 5 MiBのみ | `YYYY-MM`風keyを全件保持 | 正規月検証＋entry cap |
| string | なし | file 5 MiBのみ | 全長保持 | field別product長＋global string byte cap |
| nesting／総node | なし | なし | JSON.parse後にのみ判明 | depthと総node cap |

原則:

- product上限は「通常UIから追加できる件数」であり、読込時削除の根拠にしない。
- product上限超過かつabsolute安全域内なら、全件を保持し、閲覧・export・削除・整理を許可し、新規追加を止める。
- UIや計算で安全に扱えないabsolute上限超過は、現在データを変更せずimport全体を拒否する。
- exact safety値は実端末の性能fixtureで決める。根拠なく200／8／20を流用しない。

## 7. 必須異常系と現在の不足

| 異常系 | 現状 | P0-2の期待結果 | 主テスト層 |
|---|---|---|---|
| 空file／空object／JSON構文error | 一部拒否 | 現在state・保存を不変、raw再選択可 | unit＋E2E |
| 必須項目欠落／型不一致 | root一部のみ拒否、他は補正 | version別strict拒否 | unit |
| duplicate ID／planId衝突 | memberだけ再発行、root planIdなし | 曖昧なら拒否、copyだけ再発行 | unit＋E2E |
| dangling／循環相当参照 | memberIdをnull化 | 参照整合性error | unit |
| NaN／Infinity／極端値 | fallback／clamp | current schemaでは拒否、legacy stepだけ明示変換 | unit |
| 不正日時 | 現在時刻へ置換 | `INVALID_TIMESTAMP`、不変 | unit |
| 巨大文字列／配列／深いnest | 5 MiB以外なし | safety error、置換前拒否 | unit＋E2E |
| product上限超過 | 3種はslice | 保持・整理または全体拒否 | unit＋E2E |
| versionなし／旧version | generic normalize | fingerprint→明示migration | fixture unit |
| future／fractional／negative schema | import futureのみ拒否 | 全経路で整数範囲判定 | unit＋E2E |
| checksum不一致／復号失敗 | 拒否 | 現在データ不変 | Worker API＋unit＋E2E |
| 復号後schema不一致 | 寛容normalize | strict拒否、現在データ不変 | unit＋E2E |
| migration途中／後validation失敗 | migration概念なし | pure candidate破棄 | unit |
| localStorage／IDB失敗 | UI分離またはcursor分離 | journal／state不変／再試行 | unit＋E2E |
| shared revision競合／古い再送 | 409 | 維持。local不変 | Worker API＋E2E |
| 同一JSON重複import | 毎回置換 | restore／copy modeで決定的 | unit＋E2E |
| import中reload／backup通信切断 | 専用journalなし | current保存は不変、再試行可 | E2E |
| unknown field | normalizeで破棄 | schema policyに従い拒否またはextension保持 | unit |
| migration済みdata再migration | 判別不能 | idempotence／currentはmigrationしない | unit |
| 別user backup／別household revision | serverで404/403 | 維持 | Worker API |

P0-2の共通異常系契約は次とする。

- commit前の失敗では画面state、current保存、IndexedDB cursor、版履歴、自動保存対象を変更せず、部分変更を残さない。
- 元file／backup／shared revisionは削除せず、local rawは安全上限内で再export可能にする。攻撃的なsafety超過rawはmemoryへ再保持せず元file再選択を案内する。
- 利用者には安定した理由code、現在データが不変か、再試行可能かを示す。
- distributed commit後の失敗はpending journalを残してreconcileし、成功表示を出さない。
- 各行の主テスト層に加え、privacy log assertionをunit／Worker APIへ共通適用する。

loggingについて、現行Workerの共通`reportWorkerError`はmethod、scope、CF-Ray、error nameだけを記録し、request bodyやplanを出していない（`worker/index.js:102-109`）。P0-2ではこの原則を全errorへ広げ、家計・資産・家族情報をlogへ含めず、error code、schemaVersion、byte数、件数、phase、request/ray IDだけを記録する。

## 8. fixture・自動テスト計画

### 必須fixture

- Git履歴または匿名化した実exportで形状を確認できたlegacy versionの最小・代表・最大historical fixture
- 旧importer由来の既知legacy fingerprintを満たすsynthetic versionless fixture
- current v9からcanonical v10へ移行するfixture
- future、fractional、negative、string schemaVersion
- duplicate ID、dangling memberId、欠落source review、不正timestamp／number
- scenario 20/21、詳細収支200/201、版履歴8/9、member 20/21
- 5 MiB境界、深いnest、巨大string、総node超過
- cloud/shared encryption envelope v1とinner legacy/future schema

fixtureへ実在利用者の家計・資産・家族情報を入れない。

### テストの役割

- unit: schema、pure migration、identity、reference、limit、atomic candidate、error code。
- Worker API: size、ownership、checksum、CAS、R2/D1 cleanup、outer/inner hint不一致、ログ非露出。
- E2E: import／backup／sharedのUI、保存失敗時のstate不変、over-limit整理、future schema救済導線。
- real D1 integration: batchの中途失敗rollback。現在のFakeD1だけを証拠にしない。

## 9. 一般課金前のgate

### P0-2で必須

- canonical envelope、schemaVersion、planId、contentRevision、timestamp契約
- strict validator、pure migration registry、reference integrity
- JSON／cloud／sharedの共通read pipeline
- 非破壊的product limitとabsolute safety limit
- atomic replaceと保存失敗回帰テスト
- IDB cursor／local planのrecoverable journal
- trusted-deviceのaccount／plan binding、future version隔離、失効cleanup

### P0-2.1後、P0-2全体の完了までに必須

- cloud復号後とshared復号後のstrict validationを本番pathへ接続
- legacy実データmigration rehearsal、backup、rollback runbook
- privacy-safe logging確認
- product/safety limitのdesktop／mobile性能検証

### 後続可能

- checksumを使った同一JSON重複候補表示
- migration差分の高度な比較UI
- source device metadata
- 任意の履歴名と複数世代migration可視化

## 10. 監査上の最小次タスク

次はP0-2.1だけを実装する。

- canonical type（まだ本番保存形式を切り替えない）
- pure strict validator
- pure migration interface／registryの枠
- error code
- synthetic fixture
- 既存データを変更しないunit test

JSON import、backup restore、shared sync、UI、DBをP0-2.1では変更しない。詳細な契約とタスク分割は`docs/p0-2-data-contract.md`を正とする。

## 11. P0-2.1開始時に確定した人間判断

確定日: 2026-07-31

この節は上記の監査事実や未解決Blockerを書き換えるものではない。P0-2.1の純粋contract実装に先立ち、監査で人間判断待ちだった事項のbaselineだけを固定する。生産保存・読込経路へ未接続のため、§5のBlockerは未解決のままである。

### 11.1 schema、identity、revision

- canonical planの現行`schemaVersion`は10とする。現行生産型の`LifePlan.version: 9`はlegacy schema 9である。schemaVersionは単調増加する整数とする。
- `appVersion`は任意の記録用metadataであり、互換性、認可、課金判定には使わない。
- 暗号化envelope等の既存`version: 1`はplan schemaVersionではない。新規domain型は`schemaVersion`、`envelopeVersion`、`encryptionVersion`、`contentRevision`、`sharedRevision`を別概念として命名する。
- versionなしdataを無条件にcurrentまたはschema 9として扱わない。旧importerに根拠を持つ既知legacy fingerprintへ一致する場合だけ`legacy-unversioned`候補とし、不一致は拒否する。repository履歴でversionless producerは確認できていないため、この候補fixtureはhistorical evidenceではなくsynthetic validation fixtureとする。
- `planId`はUUID v4の不変logical identityとする。通常保存、export、同じplanとしてのrestoreでは維持し、copyでは新規発行する。planIdを所有権・権限の根拠にしない。restore／copyは後続で別操作にする。P0-2.1では既存dataへplanIdを付与しない。
- canonical envelopeへ保存するrevisionは`contentRevision`で、新規canonical planは1から開始する。永続化成功時だけ増加する。`expectedContentRevision`は保存操作のpreconditionだけに用い、envelopeへ保存しない。Worker正の`sharedRevision`とは別概念とし、P0-2.1では既存保存処理へCASを接続しない。

### 11.2 timestamp、snapshot、migration

- `createdAt`／`updatedAt`は厳密なUTC ISO 8601 instant `YYYY-MM-DDTHH:mm:ss.sssZ`とする。createdAtはcanonical identityが最初に確定した時刻で原則不変、updatedAtは永続化成功時だけ変更する。同一時刻は新規作成時に許可し、`updatedAt < createdAt`だけを拒否する。
- validator／migratorは現在時刻やrandom IDを直接取得しない。legacyへ必要なplanId、日時、entity ID mapは明示的`MigrationContext`から受け取る。
- canonical current snapshotは、現行`LifePlan`で保存対象のユーザー作成data全体をallow-listで含む。家計、資産、家族、目標、event、予算・実績、scenario、review／TODO、老後生活plan、詳細収支、固定費、保存中のsimulation条件、版履歴を対象とする。現行はsimulation結果を永続化していないため、P0-2.1で結果fieldを新設しない。
- entitlement、Square／Google／session、household membership／role、trusted-device資格情報、鍵／passphrase、backup ID、household ID、Worker側sharedRevision、API token、PWA cache、一時UI／通信／保存state、sync journalはcanonical snapshotへ含めない。
- 版履歴entryは履歴配列自身を含まない専用の非再帰snapshot型を持つ。現行scenario／版履歴の部分snapshot意味と生産復元動作はP0-2.1で変更しない。
- migrationはpure interfaceとして定義し、入力を変更しない。同じinput／contextなら同じ結果にする。実在を確認したhistorical versionだけを将来registryへ登録し、synthetic fixtureを実在versionの証拠にしない。schema 9→10とversionless→10のmigration本体はP0-2.3以降まで実装しない。

### 11.3 product上限とsafety上限

- 見直しscenarioの商品上限は20、家族ごとの詳細収支は200、計画版履歴は8とする。
- product上限超過はdataをinvalidにせず、warning／over-limitとして全件を保持する。閲覧、export、削除、整理を許可し、新規追加だけを拒否する。
- safety上限超過はvalidation errorとして全体を拒否する。ただし具体値はP0-2.2のfixture、desktop／mobile性能試験、既存data分布の確認後に決定する。P0-2.1のproduct policyでは`safetyLimit: null`とし、商品上限と同じ定数や推測値を使わない。
- 共同世帯server revisionのlist／retention目標と計画版履歴8件は別policyである。根拠なく計画版履歴を10件へ変更せず、shared revisionのabsolute safety値もP0-2.2前に100等へ固定しない。

### 11.4 P0-2.1の非接続境界

- P0-2.1はcanonical型、schema分類、outer envelope validator、error code、limit interface、revision precondition、migration interface、fixture、unit testだけを対象とする。
- `src/utils/storage.ts`、React state、JSON import／export、cloud backup、Worker API、shared push／pull、IndexedDB、localStorage、D1、暗号envelope、既存上限処理、UIへ接続しない。
- この節の追加とP0-2.1 primitivesだけでは、future schemaの起動時誤変換、黙示的slice、保存失敗時state乖離、非原子的retention、R2本文読込前size検査不足、各復元経路へのstrict validation未接続は解消しない。
