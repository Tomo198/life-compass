# P0-1 権限状態契約 受入監査

- 監査日: 2026-07-29
- 対象: 現在のWindowsローカル作業ツリー
- ブランチ: `main`
- 方針: P0-1実装コードは変更せず、差分・権限経路・テスト・文書だけを監査する
- 注意: 現在の作業ツリーにはP0-1以前の未コミット変更が混在しているため、作業ツリー全体とP0-1中核を分けて判定する
- 再監査追記: 第1～13節は修正前の監査履歴として保持する。2026-07-29の限定修正後の判定は第14節を正とする。

## 1. 結論

**現状のままではP0-1を受入不可とする。**

個人Proと共同世帯権限の型分離、fail-closed、Worker時刻、クラウドバックアップ作成、共同世帯の閲覧・編集・メンバー管理、同期のWorker側再判定は受入可能である。クライアントの旧feature gateだけでサーバー保存が成功する経路も見つからなかった。

ただし、次のHighがP0-1の確定条件に直接反する。

1. `ACCESS_MODE=preview`だけで、匿名・Freeを含む全利用者へ`source: "manual"`のactive個人Pro snapshotを発行する。

また、現在の作業ツリーをP0-1の配送単位として受け入れるには、P0-1外のUI・保存上限変更との分離が必要である。特に、読込時に20件を超えるシナリオを切り捨てる変更は、P0-1の「既存データを削除しない」という前提と別に受入判断しなければならない。

### 判定一覧

| ID | 分類 | 重要度 | 判定 |
|---|---|---:|---|
| A-01 | Accept | - | 個人契約と共同世帯権限がsnapshot内で分離され、相互にProへ昇格しない |
| A-02 | Accept | - | Workerの重要な保存操作はWorker側のDB・membership・所有権・Worker時刻で再判定される |
| A-03 | Accept | - | Free降格後の既存バックアップ取得・復元・削除と、新規作成拒否がWorkerで成立する |
| A-04 | Accept | - | UTC形式、不正状態、期限同一時刻を含むfail-closedの純粋関数テストがある |
| F-01 | Fix before P0-2 | High | `ACCESS_MODE=preview`単独で全利用者にmanual個人Proを発行する |
| F-02 | Fix before P0-2 | Process | P0-1中核と、それ以前のUI・保存・Pro完成変更が同じ未コミット差分に混在している |
| F-03 | Fix before P0-2 | High相当のデータ保全リスク | P0-1外の`scenarios.slice(0, 20)`が同じ差分に混在し、超過データを失い得る |
| F-04 | Fix before P0-2 | Documentation | `docs/pro-entitlement-matrix.md`の支払い失敗・viewer記述がP0-1実装前のままで、実装記録と矛盾する |
| U-01 | Follow-up | 一般課金前必須 | Free降格後の保存済みProデータ閲覧と編集禁止を、旧画面gateが表現できない |
| U-02 | Follow-up | 一般課金前必須 | manual取消のrunbook・取消テスト・監査履歴がない |
| U-03 | Follow-up | 一般課金前必須 | viewerは型と純粋判定だけで、D1・招待・role変更・読取専用UIは未実装 |
| U-04 | Follow-up | - | 共同世帯作成・削除、鍵rotation、backup救済操作は安全だが、共通`ProOperation`へ未統合 |
| U-05 | Follow-up | 一般課金前必須 | 開いている画面で権限をfocus・重要操作前に再取得しない |

## 2. 変更差分

### 2.1 Git差分

`git diff --stat`の追跡済み差分は次のとおり。

- 19ファイル
- 951 insertions
- 162 deletions
- staged差分なし
- 未追跡のP0-1中核:
  - `shared/entitlement-policy.js`
  - `shared/entitlement-policy.d.ts`
  - `tests/entitlements.test.ts`
  - Pro監査・計画文書群

現在の変更ファイル:

```text
docs/RELEASE_CHECKLIST.md
scripts/run-logic-tests.mjs
scripts/run-worker-api-tests.mjs
src/App.tsx
src/config.ts
src/features.ts
src/utils/storage.ts
src/views/HouseholdView.tsx
src/views/LifePlanDiagnosisView.tsx
src/views/RetirementPlanView.tsx
src/views/ScenarioComparisonView.tsx
src/views/SimulationView.tsx
tests/calculations.test.ts
tests/e2e/life-compass.spec.ts
worker/access.js
worker/backups.js
worker/households.js
worker/index.js
worker/sharedPlans.js
```

このほか、未追跡の`shared/`、`tests/entitlements.test.ts`、Pro関連文書がある。

### 2.2 package.jsonとテスト実行スクリプト

**Accept**

- `package.json`自体に`HEAD`との差分はない。
- `verify`は従来どおり`test:logic && test:worker-api && test:e2e`であり、いずれかが失敗すれば後続を実行せず失敗する。
- `scripts/run-logic-tests.mjs`は既存`tests/calculations.test.ts`を残したまま`tests/entitlements.test.ts`を追加している。
- logic runnerは子processの終了コードをそのまま返す。
- E2E runnerもPlaywrightの終了コードを返す。
- `test.skip`、`test.only`、`describe.skip`、`describe.only`、`process.exitCode = 0`による失敗の握りつぶしは見つからなかった。
- Playwrightは`retries: 0`、desktop/mobileの2projectを維持している。
- 生産用の計算エンジン本体にP0-1由来の差分はない。

テスト数:

| Suite | 現在 |
|---|---:|
| logic全体 | 116 |
| うち新規権限unit test | 8 test block |
| Worker API | 30 |
| E2E | 56（desktop 28 + mobile 28） |

### 2.3 目的外変更

**Fix before P0-2**

- `src/utils/storage.ts:360-365`は、読込・import時の`scenarios`を`MAX_PLAN_SCENARIOS`件へ切り詰める。
- 上限は`src/config.ts:11`の20件。
- `tests/calculations.test.ts:3091-3104`は切り捨てを期待動作として固定する。
- 保存JSONのschema番号自体は変わらないが、20件超の既存JSONを読み込んで再保存すると超過分を失い得る。
- これはP0-1ではなく、明示的に後続とされた上限超過データの扱いである。P0-1差分へ含めず、別のデータ移行・拒否方針として監査する。

**Follow-up**

- 複数画面の`Pro予定`／`Proプレビュー`から`Pro`への文言変更
- Pro老後プランE2E
- `docs/RELEASE_CHECKLIST.md`のPro完成状況更新

これらはP0-1権限状態契約そのものではない。変更内容が直ちに不正という意味ではなく、受入単位を分ける必要がある。

## 3. Worker APIと操作権限の対応

`ProOperation`欄は、Workerが実際に共通判定へ渡す操作名を示す。`—`は共通操作を直接呼ばない。後者も、別のWorker認証・所有権確認があるかを個別に確認した。

| Endpoint | Method | 種別 | 使用ProOperation | 個人契約 | 共同世帯role | Worker側の最終確認 | client判定だけか |
|---|---|---|---|---|---|---|---|
| `/api/health` | GET | 読取 | — | 不要 | 不要 | 公開情報のみ | 該当なし |
| `/api/me` | GET | 読取 | — | 不要 | 不要 | session cookieをDB照合 | いいえ |
| `/api/entitlement` | GET | 読取 | — | 不要 | 不要 | DB契約・membershipから生成 | いいえ。ただしF-01あり |
| `/api/billing/config` | GET | 読取 | — | 不要 | 不要 | 公開可能な設定だけ返す | 該当なし |
| `/api/billing/checkout` | POST | 作成準備 | — | 未契約者向け | 不要 | same-origin、verified login | いいえ |
| `/api/billing/square/webhook` | POST | 更新 | — | 不要 | 不要 | URL、HMAC、merchant、Square再取得 | いいえ |
| `/api/backups` | GET | 一覧 | — | 不要 | 不要 | login、mode、`user_id`絞込 | いいえ |
| `/api/backups` | POST | 作成 | `create_cloud_backup` | 個人Pro必須 | 不要 | Worker時刻、DB契約、same-origin、所有者 | いいえ |
| `/api/backups/:id` | GET | 復元用読取 | —（意味上`restore_cloud_backup`） | 不要 | 不要 | login、mode、`user_id`所有権、checksum | いいえ |
| `/api/backups/:id` | DELETE | 削除 | —（意味上`delete_cloud_backup`） | 不要 | 不要 | login、same-origin、`user_id`所有権 | いいえ |
| `/api/shared-household` | GET | 読取 | `view_household` | 本人の個人Pro不要 | owner/editor/viewer | membership、owner契約、retention | いいえ |
| `/api/shared-household` | POST | 作成 | — | 作成者の個人Pro必須 | 未所属 | fresh login、same-origin、Worker DB契約 | いいえ |
| `/api/shared-household` | DELETE | 削除 | — | 不要 | owner | fresh login、same-origin、DB owner、確認語 | いいえ |
| `/api/shared-household/invitations` | POST | 作成 | `manage_household_members` | owner側Proが世帯write条件 | owner | fresh login、same-origin、owner、writeAllowed | いいえ |
| `/api/shared-household/invitations/accept` | POST | 作成 | owner snapshotへ`manage_household_members` | invitee不要、owner側Pro必須 | inviteeはnone | token、招待email HMAC、期限、owner権限を受諾時に再確認 | いいえ |
| `/api/shared-household/invitations/:id` | DELETE | 削除 | `manage_household_members` | owner側Proが世帯write条件 | owner | fresh login、same-origin、owner、household ID | いいえ |
| `/api/shared-household/members/:id` | DELETE | 更新・失効 | `manage_household_members` | owner側Proが世帯write条件 | owner | fresh login、same-origin、owner、対象membership | いいえ |
| `/api/shared-household/members/:id` | PUT/PATCH | role変更 | 未実装 | - | - | 405 | 該当なし |
| `/api/shared-household/leave` | POST | 更新・退出 | `view_household`＋直接role確認 | 不要 | 非owner。現SQLはeditor | login、same-origin、membership、対象user ID | いいえ |
| `/api/shared-household/plan` | GET | 読取・同期pull | `view_household` | 本人の個人Pro不要 | owner/editor/viewer | login、membership、readAllowed、checksum | いいえ |
| `/api/shared-household/plan` | PUT | 更新・同期push | `edit_household` | caller個人Pro不要。owner側Proが必要 | owner/editor | same-origin、Worker policy、revision競合、membership | いいえ |
| `/api/shared-household/plan/rotate-key` | PUT | 更新 | `view_household`後に直接確認 | owner個人Pro必須 | owner | owner、ownerPro、fresh login、最終SQLのowner | いいえ |
| `/api/shared-household/revisions` | GET | 一覧 | `view_household` | 不要 | owner/editor/viewer | membership、readAllowed | いいえ |
| `/api/shared-household/revisions/:revision` | GET | 読取 | `view_household` | 不要 | owner/editor/viewer | membership、household ID、checksum | いいえ |
| `/api/auth/config` | GET | 読取 | — | 不要 | 不要 | 公開設定のみ | 該当なし |
| `/api/auth/nonce` | GET | 認証準備 | — | 不要 | 不要 | rate limit、HttpOnly nonce cookie | いいえ |
| `/api/auth/google` | POST | 認証作成 | — | 不要 | 不要 | same-origin、nonce、Google JWT | いいえ |
| `/api/auth/logout` | POST | session更新 | — | 不要 | 不要 | same-origin、cookie token hash | いいえ |
| `/api/auth/logout-all` | POST | session更新 | — | 不要 | 不要 | same-origin、login、`user_id` | いいえ |
| `/api/account` | DELETE | 全削除 | — | active契約中は拒否 | ownerは世帯削除が先 | fresh login、same-origin、確認語、DB所有権 | いいえ |
| `/api/*` | OPTIONS | preflight | — | 不要 | 不要 | データ操作なし | 該当なし |
| 未知の`/api/*` | 任意 | - | — | - | - | 404/405 | 該当なし |

主なroute根拠:

- `worker/index.js:230-375`
- `worker/backups.js:128-235`
- `worker/households.js:789-830`
- `worker/sharedPlans.js:549-573`

### 3.1 重点操作

**Accept**

- クラウドバックアップ作成はWorkerで`create_cloud_backup`を確認する。
- 一覧・取得・削除は個人Proを要求しないが、ログイン本人の`user_id`へ限定する。
- backupのPUT/PATCH、ID付きPOSTは存在せず、Freeから既存backupを更新する経路はない。
- 共同世帯取得は`view_household`、shared plan更新は`edit_household`、メンバー管理は`manage_household_members`を使う。
- 招待受諾時にもownerの管理権限を再確認する。
- 自動同期は弱い専用endpointを持たず、GET/PUT `/api/shared-household/plan`を使う。pullは`view_household`、pushは`edit_household`。
- 個人Proだけで未所属世帯へアクセスできない。
- 共同世帯owner/editorだけで個人backup作成、個人比較、個人採用は許可されない。

**Follow-up**

- 共同世帯作成は`personalAccess.tier`を直接確認する。
- 共同世帯削除はDB owner membershipを直接確認する。
- 鍵rotationは`view_household`の後、owner・ownerPro・fresh sessionを個別確認する。
- backup復元・削除は意味上の操作名を共通policyへ渡さず、認証と所有権で直接保護する。

いずれも現在のサーバー権限漏れではないが、操作名と監査ログを統一する後続候補である。

### 3.2 role変更

role変更endpointは未実装である。`viewer`を実利用へ出す前に、次が必要。

- D1のrole CHECKをowner/editor/viewerへmigration
- 招待roleまたはownerによるrole変更API
- viewerの退出・除名・アカウント削除
- shared planの最終UPDATE/INSERT SQLでもroleを再確認
- viewer向け読取専用UIとWorker API test

現在はDBでviewerを作れないため、viewer由来の現行権限漏れはない。

## 4. 時刻の信頼境界

### Accept

- Workerの権限API、backup write、household、shared planは`new Date().toISOString()`をWorker内で生成する。
- request body・queryから`currentTime`を受け取る経路はない。
- `validUntil`、`graceUntil`は正規化したUTC instantとして扱う。
- active/cancelは`now < validUntil`、past_dueは`now < graceUntil`である。
- 期限と同一時刻は拒否される。
- 不正日時、未来の`evaluatedAt`、欠落期限、7日でない猶予はfail-closedになる。

根拠:

- `shared/entitlement-policy.js:34-40,65-115,160-170,227-250`
- `worker/index.js:137-160`
- `worker/backups.js:40-50`
- `worker/households.js:98-120,437-449`
- `worker/sharedPlans.js:39-57`
- `tests/entitlements.test.ts:63-203,279-414`

### Follow-up

- クライアント時刻は`getEffectiveTier`等のUI・ローカル計算表示に使われる。
- クライアント時計を巻き戻すとローカルPro表示が古く残り得るが、Worker保存権限は変わらない。
- entitlement取得はmountとaccount changeが中心で、focus・visibility復帰・重要操作前のrefreshはない。
- 開いたローカルPro画面への即時失効反映はP3-1で対応する。

## 5. manual／test／preview権限

### F-01: preview単独のmanual発行

**Fix before P0-2 / High**

`worker/index.js:145-162`では、`ACCESS_MODE=preview`かつ実契約がFreeなら、利用者の認証・owner設定に関係なく次を合成する。

```text
status: active
source: manual
validUntil: null
graceUntil: null
```

同時に`effectiveTier`もProとなる。`scripts/run-worker-api-tests.mjs:931-946`は、この挙動を正として固定している。

これは「preview modeだけでは権限を付与しない」という受入条件に反する。checked-inの`wrangler.jsonc`は`ACCESS_MODE=enforced`であるため、現在のローカル設定では発火しない。また、重要なWorker保存APIはこの応答snapshotを信用せず再判定するため、直接のサーバーデータ権限漏れではない。

それでも、環境変数の設定事故だけで一般利用者へクライアント完結Pro機能を開くため、課金境界のHighとする。P0-2前に、previewでもverified `OWNER_GOOGLE_SUB`だけへ限定するか、previewを表示上の状態だけにして権限付与を分離する必要がある。対応時は現在と反対向きのWorker/E2E testを追加する。

### manual operator

**Accept（最小要件）**

- クライアントがrequestへmanual snapshotを送るAPIはない。
- `isOwnerTestUser`はWorker側の`OWNER_GOOGLE_SUB`と、サーバーsessionから得たGoogle subの完全一致を要求する。
- verified emailも要求する。
- Worker保存APIはクライアントのsnapshotを受け取らず、DB・envから再算出する。
- クライアントはrawの`tier`を信用せず、schema検証済みsnapshotからlegacy tierを再導出する。
- PWAはAPI応答をcacheしない。

根拠:

- `worker/access.js:72-79,221-265`
- `worker/auth.js:74-99`
- `src/features.ts:181-217`
- `public/sw.js:24-35`
- `scripts/run-worker-api-tests.mjs:948-1002,2507-2511`

**Follow-up**

- manualは`validUntil:null`を許容する。
- 現在の明示的取消は`OWNER_GOOGLE_SUB` secretの削除・差替えであり、次のWorker requestから失効する。
- 付与scriptはあるが、取消runbook・取消テスト・監査履歴がない。
- 一般課金前に、取消手順、担当者、確認API、ログ確認を文書化する。
- 将来、複数利用者・期限付きmanual grantへ広げるなら、DBにissuer・expires/revoked・auditを持たせる。

### 他のpreview mode

- `CLOUD_BACKUP_MODE=preview`はverified ownerだけへ限定される。
- `HOUSEHOLD_SHARING_MODE=preview`だけではmembershipやroleを発行しない。
- Highはglobalな`ACCESS_MODE=preview`の個人Pro発行に限定される。
- 実際にデプロイ済みのCloudflare環境変数・secretは今回のローカル監査では確認していない。一般課金前にproduction設定を別途照合する。

## 6. Free降格後の救済操作

| 操作 | 純粋契約 | Worker／UI実装 | 判定 |
|---|---|---|---|
| 保存済みProデータ閲覧 | `view_saved_pro_data`はFree可 | 旧画面gateがscenarios/reviews等を閉じる | Follow-up |
| JSON出力 | `export_personal_data`はFree可 | topbarとData画面から常時実行 | Accept |
| JSON入力 | `import_personal_data`はFree可 | Data画面で常時実行 | 既存Free機能としてAccept |
| 既存backup一覧 | 救済読取 | login本人の一覧 | Accept |
| 既存backup復元 | `restore_cloud_backup`はFree可 | 本人暗号文GET、browser内復号、local planへ反映 | Accept |
| 既存backup削除 | `delete_cloud_backup`はFree可 | same-origin、本人所有権でDELETE | Accept |
| 新規backup作成 | `create_cloud_backup`はFree不可 | UIとWorker POSTの両方で拒否 | Accept |
| 既存backup更新 | 禁止 | PUT/PATCH/ID付きPOST routeなし | Accept |
| 見直し作成・編集・比較・採用 | Free不可 | 純粋契約では拒否。旧画面gateはread/writeを区別できない | Follow-up |
| 詳細simulation再計算 | Free不可 | local feature gateで拒否 | Accept、操作単位化は後続 |
| version復元 | `restore_version`はFree不可 | 純粋契約では拒否。UI統合は後続 | Follow-up |

backup復元が返すのは、ログイン本人が以前保存した暗号化envelopeである。Workerは平文を受け取らず、復号はbrowser内で行う。復元endpoint自体はserver writeを行わず、backup更新APIも存在しない。このため、救済を任意の個人Proサーバー書込権限へ転用する経路は見つからなかった。

### 保存済みProデータ閲覧の未接続

`shared/entitlement-policy.js`はFreeでも保存済みProデータ閲覧を許可する一方、`canOpenView`はFree利用者をscenarios、reviews、retirement、diagnosis等からpricingへ送る。画面を開く許可と、作成・編集・比較・採用の許可が同じfeature gateにまとめられているため、閲覧のみを表現できない。

これはP0-1で明示的に対象外とされた画面全体置換に該当し、現時点のサーバー権限漏れではない。ただし、一般課金前には保存済み結果をread-onlyで開き、新しいPro生成操作だけをoperation単位で止める必要がある。

## 7. 旧feature gateの分類

| 対象 | 分類 | 理由 |
|---|---|---|
| `getEffectiveTier` | 現状のままで安全 | validated personal snapshotだけから導出し、household権限を個人Proへ昇格させない |
| `hasFeatureAccess` | 後続で操作単位へ変更 | 現在のサーバー漏れはないが、閲覧・作成・編集・復元を区別できない |
| `canOpenView` | 後続で操作単位へ変更 | Free降格後の保存済みPro閲覧を画面ごと閉じる |
| `App.tsx`画面遷移 | 後続で操作単位へ変更 | UI制御だけでサーバー権限ではないが、read-only救済を表現できない |
| `CloudBackupPanel` | 現状のままで安全 | save UIは旧gateだがPOSTはWorkerが再判定。restore/deleteはFreeでも表示 |
| `HouseholdView` | 現状のままで安全 | matching householdかつ`edit_household`可能な同期planだけへ詳細編集を限定。viewerはwrite不可 |
| `SimulationView` | 現状のままで安全 | browser内の詳細計算だけを制御。server writeなし |
| `PricingView` | 現状のままで安全 | 表示と画面遷移だけ |

現在、旧feature gateだけでサーバー保存権限が漏れる箇所は見つからなかった。

ただし、一般課金前には次をoperation単位へ変更する。

- 保存済みscenario/review/versionの閲覧
- scenario作成・編集・比較・採用
- 詳細simulation再計算
- version復元
- backup作成前の正確なreason表示
- 権限失効後の開いている画面

## 8. 確定・仮仕様の一覧

| 仕様 | コード | テスト | 後から変える影響 | DB migration | 仮仕様か |
|---|---|---|---|---|---|
| 支払い失敗後7日猶予 | `shared/entitlement-policy.js:35,100-105,243-246`; `worker/access.js:99-127,177-197` | `tests/entitlements.test.ts:135-174`; Worker `2131-2165` | policy、access、Square event順序、契約表示、利用規約 | 現在はeventから導出するため不要。永続化するなら必要 | 確定仕様。Square順不同処理は後続 |
| viewer role | `shared/entitlement-policy.js:12,117-157,253-280`; `worker/access.js:10,319-357` | unit `248-276,332-370` | migration、招待、role変更、退出、削除、UI、全Worker test | 実利用開始に必要 | P0-1では契約先行の仮仕様 |
| Freeの保存済みPro閲覧・JSON | `shared/entitlement-policy.js:41-48,285-297`; JSON UI | unit `205-231`、既存JSON E2E | read-only UI、action gate、法務文言 | 不要 | 権利は確定。UI範囲は後続 |
| Freeの既存backup復元・削除 | policy同上、`worker/backups.js:203-232` | Worker `2198-2329` | backup handler、UI、retention、support | 不要 | 確定仕様 |
| 解約予約中は期限までPro | `shared/entitlement-policy.js:106-110,238-242`; `worker/access.js:159-175` | unit `97-132`; Worker `2118-2129` | Square同期、契約表示、法務文言 | 既存列を使うため不要 | 確定仕様 |
| manual entitlement | `shared/entitlement-policy.js:96-99,232-237`; `worker/access.js:72-79,221-264` | unit `83-88`; Worker `948-1002` | env/secret、access API、取消、監査、全server operation | 現在の単一operatorなら不要。期限・複数grantなら必要 | operator test専用の仮仕様 |

### 支払い失敗7日猶予の注意

現在は、直近の処理済み支払い成功以後にWorkerが最初に受信した失敗eventの`received_at`を起点とする。同じ失敗期間中のretryは猶予を延長しない。event順不同・遅延・返金・Squareとの定期照合はP0-1対象外であり、一般課金前のSquare hardeningで扱う。

### viewerの注意

`migrations/0005_household_sharing_foundation.sql`はroleをowner/editorだけに制限し、招待もeditor固定である。したがって、viewerは「型と判定の契約を先に固定した状態」であり、利用可能機能として表示してはならない。

## 9. 文書整合性

**Fix before P0-2**

`docs/pro-implementation-plan.md`と`docs/pro-release-checklist.md`にはP0-1実装記録がある一方、`docs/pro-entitlement-matrix.md`には次の古い記述が残る。

- 支払い失敗は直ちにFree
- 7日猶予は未決定
- viewerを採用するか未決定

コードを正として今回の監査を行ったが、権限マトリクスは一般課金前の人間承認資料であるため、P0-2へ進む前に履歴を残したまま現仕様へ更新する。

## 10. 検証結果

package.jsonに存在するコマンドだけを使用した。

| Command | 結果 |
|---|---|
| `npm.cmd run verify` | 成功。logic 116/116、Worker API 30/30、E2E 56/56 |
| `npm.cmd run build` | 成功。TypeScriptとVite production build完了 |
| `npm.cmd audit --audit-level=high` | 成功。0 vulnerabilities |
| `git diff --check` | 成功。whitespace errorなし。既存ファイルのLF→CRLF警告のみ |

テスト成功はF-01を否定しない。現在のWorker testがpreviewによるmanual Pro発行を期待動作として固定しているためである。

## 11. 受入条件ごとの最終判定

| 受入観点 | 判定 | 備考 |
|---|---|---|
| 個人Proと共同世帯Proの型分離 | Accept | snapshot内で独立 |
| 単一`isPro`だけに依存しない | Accept | 共通operation policyあり |
| 支払い失敗7日猶予 | Accept | exact UTC boundary、retry延長なし |
| 解約予約と期限終了 | Accept | exact boundaryでFree |
| owner/editor/viewer/none | Accept（契約のみ） | viewer runtimeは未実装 |
| Free救済の純粋契約 | Accept | unit testあり |
| Free救済の実UI | Follow-up | 保存済みPro閲覧read-onlyが未接続 |
| 個人Proと世帯権限の非波及 | Accept | unit・Worker・E2Eで確認 |
| 不正状態fail-closed | Accept | 不正snapshotから新規Pro操作不可 |
| Worker保存操作の最終判定 | Accept | client-only経路なし |
| preview単独で権限を付与しない | **Fail / High** | F-01 |
| manual取消 | 条件付Accept | env取消は可能。runbook/test不足 |
| 既存データを削除しない | P0-1中核はAccept、作業ツリー全体はFail | P0-1外のscenario切り詰めが混在 |
| UI・計算・保存形式に目的外変更なし | Fail（配送単位） | 混在差分を分離する必要あり |
| 追加・既存test成功 | Accept | 指定全suite成功 |
| TypeScript build | Accept | 成功 |

## 12. P0-2前に行うこと

1. F-01を修正し、`ACCESS_MODE=preview`だけではmanual個人Proを発行しない反対向きテストへ変更する。
2. P0-1中核ファイルと未追跡ファイルを同一のレビュー可能な単位として整理する。
3. `scenarios.slice(0, 20)`をP0-1から分離し、上限超過時に黙って削除しない方針で別監査する。
4. `docs/pro-entitlement-matrix.md`を現コードと確定仕様へ追随させる。
5. P0-1修正後に、同じ4コマンドを再実行する。

一般課金前の後続必須事項:

- 保存済みProデータのread-only UI
- operation単位のaction gate
- focus・重要操作前のentitlement refresh
- manual取消runbookとproduction環境照合
- viewerを採用する場合のD1/API/UI一式
- Square event順不同、返金、照合

## 13. 変更・公開操作の確認

- P0-1の生産コード、テスト、設定はこの監査で変更していない。
- この監査で追加したのは`docs/p0-1-acceptance-review.md`だけである。
- commitしていない。
- pushしていない。
- deployしていない。
- Square設定を変更していない。

## 14. F-01～F-04限定修正後の再監査（2026-07-29）

### 14.1 結論

**F-01～F-04は解消し、P0-1は再受入可能な状態になった。**

初回監査の指摘と根拠は第1～13節に残し、限定修正後の判定を次のとおり更新する。

| ID | 修正後判定 | 確認結果 |
|---|---|---|
| F-01 | Accept | `ACCESS_MODE=preview`はmode表示だけになり、一般Free利用者のpersonal snapshot、`effectiveTier`、上限、個人Pro操作を昇格させない。 |
| F-02 | Accept（レビュー単位を明示） | P0-1中核、混在hunk、P0-1外の既存変更を第14.4節で分離した。indexは変更せず、既存差分を保持したまま選択的にstageできる。 |
| F-03 | Accept | `src/utils/storage.ts`の`scenarios.slice(0, 20)`を撤回し、同ファイルはHEADとの差分なし。22件をそのまま保持する回帰testへ反転した。 |
| F-04 | Accept | `docs/pro-entitlement-matrix.md`を確定仕様と現行コードへ合わせ、2026-07-28の初版と2026-07-29の変更理由を履歴として残した。 |

### 14.2 previewとmanualの修正後契約

- `/api/entitlement`は、`ACCESS_MODE=preview`でも`resolvePersonalAccess`が返した個人契約をそのまま使用する。
- 一般Free利用者は`tier: free`、`effectiveTier: free`、`source: anonymous`、personal `status/source: none`となる。
- manualはpreviewから独立し、verified emailかつWorker sessionのGoogle subが`OWNER_GOOGLE_SUB`と完全一致する場合だけ、Workerが`source: manual`のpersonal entitlementを生成する。
- manualはhousehold membershipまたはroleを生成しない。
- backup POSTにクライアントから`tier: pro`、`source: manual`、manual相当snapshotを追加しても、Workerはこれらを認可へ使用せず、DB・session・env・Worker時刻から再判定して403を返す。
- `CLOUD_BACKUP_MODE=preview`と`HOUSEHOLD_SHARING_MODE=preview`の既存運営者限定経路は別のmodeであり、今回変更していない。一般Free利用者への書込権限にはならない。

主な根拠:

- `worker/index.js`
- `worker/access.js`
- `worker/backups.js`
- `scripts/run-worker-api-tests.mjs`
- `tests/calculations.test.ts`
- `tests/e2e/life-compass.spec.ts`

### 14.3 追加・変更した回帰test

- preview一般利用者のpersonal entitlement、`effectiveTier`、plan/scenario上限がFreeのままである。
- verified owner manualがenforcedとpreviewの両方で有効であり、別subと未verified emailはFreeのままである。
- preview一般Free利用者による新規backup作成を拒否する。
- clientがmanual相当の`tier/source/snapshot`をbackup requestへ混入しても403となる。
- クライアントのpreview modeだけではPro featureとPro画面を開かない。
- E2Eの通常Pro fixtureを`enforced/operator`へ変更し、preview一般FreeのPC・スマホ回帰を追加した。
- 22件のscenarioを読み込んでも黙って20件へ切り詰めない。

### 14.4 P0-1レビュー単位

#### P0-1としてファイル全体をレビューするもの

- `scripts/run-logic-tests.mjs`
- `scripts/run-worker-api-tests.mjs`
- `src/App.tsx`
- `tests/calculations.test.ts`
- `worker/access.js`
- `worker/backups.js`
- `worker/households.js`
- `worker/index.js`
- `worker/sharedPlans.js`
- `shared/entitlement-policy.js`
- `shared/entitlement-policy.d.ts`
- `tests/entitlements.test.ts`
- `docs/pro-entitlement-matrix.md`

`docs/p0-1-acceptance-review.md`は実装差分ではなく受入証跡として、P0-1実装とは別の文書レビューにする。

#### 同一ファイル内でP0-1 hunkだけをレビューするもの

| ファイル | P0-1 hunk | P0-1外として残すhunk |
|---|---|---|
| `src/features.ts` | 共通policyのimport/export、snapshot型、個人/世帯非波及、fail-closed parser、互換adapter | `MAX_PLAN_SCENARIOS` importとPro表示上限の定数参照 |
| `tests/e2e/life-compass.spec.ts` | entitlement fixture、preview-Free回帰、個人/世帯scope回帰 | Pro画面文言の期待変更、Pro老後生活プランE2E |
| `docs/pro-implementation-plan.md` | P0-1実装記録と今回のpreview/manual訂正 | P0-2以降の実装計画 |
| `docs/pro-release-checklist.md` | P0-1権限状態契約の検証記録 | 一般課金全体のrelease checklist |

#### P0-1外として既存のまま残すもの

- `src/config.ts`: scenario表示上限定数
- `src/views/HouseholdView.tsx`
- `src/views/LifePlanDiagnosisView.tsx`
- `src/views/RetirementPlanView.tsx`
- `src/views/ScenarioComparisonView.tsx`
- `src/views/SimulationView.tsx`
- `docs/RELEASE_CHECKLIST.md`
- `docs/PRO_FEATURE_COMPLETION_PLAN.md`
- `docs/pro-hardening-audit.md`
- `tests/e2e/life-compass.spec.ts`内のPro文言・老後生活プランhunk
- `src/features.ts`内の上限hunk
- `docs/pro-implementation-plan.md`と`docs/pro-release-checklist.md`内の後続phase

`src/utils/storage.ts`のscenario切り捨て差分は撤回済みで、現在は変更ファイルではない。P0-1外のUI、Pro完成、一般release文書、老後E2E、上限定数は削除・上書きしていない。

### 14.5 stage状態と選択stage

- staged: 0
- unstaged tracked: 18ファイル
- untracked: 9ファイル
- 秘密情報・ローカルenvファイル: 差分一覧になし

P0-1だけの選択stageは可能である。ファイル全体で分離できる中核を通常stageし、`src/features.ts`と`tests/e2e/life-compass.spec.ts`はhunk単位、未追跡の混在文書はintent-to-add後のpatch単位で選択できる。今回は明示的なstage指示がないためindexを変更していない。

### 14.6 限定修正後の検証

package.jsonに存在するコマンドだけを使用し、失敗を無視するoptionやtest除外は追加していない。

| Command | 結果 |
|---|---|
| `npm.cmd run verify` | 成功。logic 116/116、Worker API 30/30、E2E 58/58（desktop 29、mobile 29） |
| `npm.cmd run build` | 成功。TypeScriptとVite production build完了 |
| `npm.cmd audit --audit-level=high` | 成功。0 vulnerabilities |
| `git diff --check` | 成功。whitespace errorなし。Gitの既存LF→CRLF予告のみ |

### 14.7 残る一般課金前の課題

次はP0-1再受入の阻害事項ではないが、一般課金前には引き続き必要である。

- 保存済みProデータのread-only UIと、作成・編集・比較・採用・詳細再計算のoperation gate
- focus・visibility復帰・重要操作前のentitlement refresh
- manual取消runbook、production環境変数照合、監査手順
- viewerを一般提供する場合のD1・API・招待・role変更・UI
- Square event順不同、返金・チャージバック、定期照合
- P0-2でのschemaVersion、migration、scenario上限超過時の拒否・移行方針

### 14.8 変更・公開操作

- 既存データを削除していない。
- UIデザインとSquare処理・設定を変更していない。
- commitしていない。
- pushしていない。
- deployしていない。
- Square設定を変更していない。

## 15. P0-1独立配送検証（2026-07-30）

- branch: `hardening/p0-1-entitlement-contract`
- P0-1実装コミット: `5f447514b1891278a6207c49cc4a1251f1269fdd`
- P0-1外差分を一時stashへ退避し、P0-1の17ファイルだけをstageした独立配送状態で検証した。
- `npm.cmd run verify`: 成功
  - logic: 116/116
  - Worker API: 30/30
  - E2E: 56/56（desktop 28、mobile 28）
- `npm.cmd run build`: 成功
- `npm.cmd audit --audit-level=high`: 成功、`0 vulnerabilities`
- `git diff --cached --check`: 成功
- P0-1外変更への依存: なし
- push: なし
- deploy: なし
- Square設定変更: なし

第14.6節のE2E 58件は、P0-1外のPro老後生活プランE2Eを含む混在作業ツリーでの実測値である。P0-1外差分を除いた独立配送単位の正式値は56件（desktop 28件、mobile 28件）であり、テスト削除、テスト除外、失敗の握りつぶしによる減少ではない。
