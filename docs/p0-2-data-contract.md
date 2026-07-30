# Life Compass P0-2 データ契約案

状態: **P0-2A監査後の確定baseline。まだ生産コードへ適用していない。**
対象HEAD: `a306132f8fbf7a3e28a5fa1decdfc4a3e4bda2c8`
根拠監査: `docs/p0-2-data-contract-audit.md`

## 1. 目的と不変条件

この契約は、ブラウザ保存、JSON、暗号化cloud backup、共同世帯同期、復旧用copyで同じplanを安全に識別・検証・移行するための正を定める。

不変条件:

1. compatibility判定の正は整数`schemaVersion`だけとする。
2. `appVersion`、暗号envelope version、DB migration version、共同世帯revision、権限revisionを混同しない。
3. validation、migration、参照検査、上限判定が全部成功する前に現在データを変更しない。
4. product上限超過を理由に読込時の黙示的削除をしない。
5. unknown future schemaは現在データを変更せず拒否する。
6. plan plaintext、復旧password、共有password、鍵をWorker、D1、R2、server logへ出さない。
7. `planId`やJSON内のowner／entitlement値を認可根拠にしない。
8. 保存成功と画面の成功表示を一致させる。

## 2. 確定canonical envelope

canonical plan schemaの現行versionは**10**とする。現HEADの`LifePlan.version = 9`はlegacy schema 9であり、canonical envelope導入を新しいschema changeとして区切る。ただし、1〜8を証拠なしに8個の独立schemaと断定しない。実際にリリースされたcommit／tagまたは匿名化した旧exportで形状を確認できたversionだけをfixture catalogueとmigration registryへ登録する。

```ts
type UtcInstant = string;
type PlanId = string;

interface PlanEnvelopeV10 {
  format: "life-compass-plan";
  schemaVersion: 10;
  appVersion?: string;
  planId: PlanId;
  contentRevision: number;
  createdAt: UtcInstant;
  updatedAt: UtcInstant;
  data: LifePlanDataV10;
}
```

`LifePlanDataV10`は現在の`LifePlan`からrootの互換性・identity metadataを除いたdata本体である。現在の計算ロジックが読むfield名と意味は、P0-2で目的外に変更しない。

新規コードでは、互換性の`schemaVersion`、外側形式の`envelopeVersion`、暗号方式の`encryptionVersion`、plan内容の`contentRevision`、共同世帯server順序の`sharedRevision`を別名・別型として扱う。既存wireの一般名`version`／`revision`はadapter境界で対応付け、schema判定へ流用しない。既存暗号envelope等の`version: 1`はplan schemaVersionではない。

### 2.1 field規則

| field | 規則 |
|---|---|
| `format` | 固定文字列。JSONや復号平文の誤種別を拒否する |
| `schemaVersion` | 1以上の単調増加整数。小数、負数、NaN、Infinity、文字列は禁止 |
| `appVersion` | 任意の記録用metadata。build時に`package.json`のversionから注入できるが、client request値は信用せず、互換性、認可、課金判定には使わない。commit／deployment IDが必要なら別の診断metadataにする |
| `planId` | `crypto.randomUUID()`相当で生成するUUID v4。論理planの不変identityであり、認可根拠にはしない |
| `contentRevision` | 1以上のsafe integer。新規canonical planは1で開始し、成功した論理更新ごとに1増加する。保存失敗時は増加しない。上限到達時は明示errorとし、wrapしない |
| `createdAt` | canonical identityが最初に確定した時刻のUTC instant。通常更新、canonical化後のmigration、同じplanとしてのrestoreで変更しない |
| `updatedAt` | 永続化に成功した論理更新時のUTC instant |
| `data` | 家計・資産・家族・目標・event・Pro data。strict schemaと参照規則に従う |

### 2.2 canonicalへ入れないmetadata

| metadata | 配置 | 理由 |
|---|---|---|
| `expectedContentRevision` | 保存操作の入力precondition | 永続dataではない |
| `backupId` | server backup resource／API response | 同じplanのsnapshotごとに別ID |
| `householdId` | shared外側envelope＋Worker認可metadata | plan identityでも所有権でもない |
| `sharedRevision` | shared外側envelope＋D1 | Worker正のCAS値。既存wire／D1の`revision`をdomain境界でmappingする |
| `exportedAt` | JSON export document外側 | plan更新日時と別 |
| `encryptedAt` | 必要なら暗号envelope外側のclient・非信頼時刻 | server保存時刻ではない。Worker/D1の`storedAt`／`createdAt`を別の正とする |
| `envelopeVersion`／`encryptionVersion` | 暗号envelope | data schemaと独立 |
| `checksum` | 経路外側。canonical planには原則入れない | AES-GCM認証の代替にしない |
| `sourceDevice` | 既定では保存しない | privacyとfingerprintingを増やす |
| `sourceAppVersion` | canonicalの`appVersion`で足りる | 重複を避ける |
| `migrationFromVersion`／`migratedAt` | operation result／local journal／監査log | migration時刻差でplan digestを変えない |
| `revisionHistoryId` | history entry | root identityではない |
| entitlement／owner／role | trusted Worker／D1だけ | 編集可能JSONを認可へ使わない |
| 暗号鍵／passphrase／access token／trusted-device credential | transport／端末の安全な資格情報領域 | canonical plan dataへ混入させない |
| route／modal／選択tab／通信中・保存中state／sync pending journal | UI／operation state | plan内容ではない |

## 3. 経路別document

### 3.1 local browser store

推奨はplan本体とrecovery metadataをIndexedDB transactionで保存する。既存localStorageはlegacy sourceとして読み取り、migration成功後もrollback期間中はrawを保持する。

```ts
interface LocalPlanRecord {
  envelope: PlanEnvelopeV10;
  persistedAt: UtcInstant;
}

interface RecoveryRecord {
  recoveryId: string;
  reason: "before-import" | "before-reset" | "before-restore" | "load-error";
  capturedAt: UtcInstant;
  envelope: PlanEnvelopeV10;
}
```

IndexedDB record keyは`envelope.planId`を明示keyとして使い、同じplanIdを外側fieldへ複製しない。`persistedAt`はlocal端末metadataであり、canonical `updatedAt`の代用ではない。

現行UIへcanonical metadataを複製しない。repository境界で`PlanEnvelopeV10`を保持し、editorには`data`のview modelだけを渡す。保存操作はrepositoryがmetadataとview modelを再結合する。P0-2.1ではadapterの型だけを固定し、React state全体の一括置換はP0-2.4まで行わない。

### 3.2 JSON export

```ts
interface PlanExportDocumentV1 {
  format: "life-compass-plan-export";
  exportVersion: 1;
  exportedAt: UtcInstant;
  plan: PlanEnvelopeV10;
}
```

- exportはplan identityを維持する。
- `exportedAt`をplan `updatedAt`と混同しない。
- JSONは平文の個人情報を含むため、entitlementやserver ownershipを含めない。
- checksumは真正性を保証しない。P0-2では必須にせず、duplicate候補のcanonical digestは端末内で一時計算する。

### 3.3 cloud backup

暗号化する平文は`PlanEnvelopeV10`そのものとする。現在の暗号envelope v1を互換readerで維持し、将来変更時は`envelopeVersion`を増やす。

```ts
interface CloudBackupEnvelope {
  format: "life-compass-encrypted-backup";
  envelopeVersion: number;
  encryption: AesGcmMetadata;
  keyDerivation: Pbkdf2Metadata;
  ciphertext: string; // decrypted bytes are PlanEnvelope
}
```

- `backupId`はWorkerが作るsnapshot resource ID。
- `planId`はciphertext内だけに置き、D1へ平文で追加しない。
- D1 `plan_version`は移行期間中「未検証表示hint」であり、migration判断に使わない。
- R2 checksumは保存した暗号envelope bytesの破損検知。真正性はAES-GCM tagが担う。
- legacy D1 rowでchecksumがnullの場合は自動成功扱いしない。WorkerがR2 sizeとstrictな実envelope形式を確認し、R2 bytesからchecksumを再計算できたrowだけをbackfillする。`encryption_version`のdefault値だけでv1と認定せず、不一致rowはquarantineしてlocal current planを変更しない。

### 3.4 shared household

```ts
interface SharedPlanEnvelope {
  format: "life-compass-shared-plan";
  envelopeVersion: number;
  householdId: string;
  sharedRevision: number;
  keyEpoch: number;
  encryption: AesGcmMetadata;
  keyDerivation: Pbkdf2Metadata;
  ciphertext: string; // decrypted bytes are PlanEnvelope
}
```

- `householdId`は認可container、`planId`は論理plan。別fieldとする。
- `sharedRevision`はWorker正。clientは`expectedSharedRevision`だけを送る。
- E2EEのためclientは暗号化前にcandidate revision=`expected + 1`をenvelope／AADへ入れる。これは暗号protocol上の候補値であり権威ではない。Workerがcurrentから同じ値を再計算し、一致するcandidateだけをCASで受け入れる。
- 現行transportの`revision`／`expectedRevision`はenvelope/API v1で維持し、client domain境界で`sharedRevision`／`expectedSharedRevision`へmappingする。P0-2だけを理由に既存API fieldを破壊的renameしない。
- 現行shared wire v1の`version: 1`もbyte-for-byte維持し、domain adapterで`envelopeVersion`へmappingする。`envelopeVersion`名をwireへ出す場合は明示的なv2とし、reader／Workerを先行配布する。
- shared D1 `plan_version`もclient申告の非信頼hintであり、compatibility／migration判断に使わない。復号後inner `schemaVersion`だけを正とする。
- Workerは暗号平文を読まず、migrationもしない。
- clientは復号後に共通read pipelineを実行する。
- shared history restoreは古いrevisionへ巻き戻さず、現在revisionをexpected値として新revisionを作る。

shared history restoreは、`sourceRevision`と`expectedRevision`を明示する。clientはsourceを復号・検証・migrationし、現在keyEpochの鍵と新revision用AADで再暗号化する。sourceが旧keyEpochなら、その版の旧passwordを利用者へ別途求める。旧passwordがなければrevisionを削除せず「復元不可」とし、現在dataを変えない。全履歴の一括再暗号化はP0-2では行わない。Workerは通常saveと同じserver-side `edit_household` operation、書込可能なentitlement状態、sourceの存在、current revisionを検査し、CAS成功時だけ`restored` audit eventとsource revisionを記録する。将来viewerが追加されてもmembership／read権限だけでrestoreを許可しない。`household_audit_events.source_revision`を追加するD1 migrationはP0-2.6の必須commitとする。sourceがcurrentと同一、retention済み、復号不能、またはkeyEpoch再暗号化不能なら現在値を変えず拒否する。

### 3.5 trusted-device record

trusted-device recordは、verified sessionからWorkerが発行するopaque `accountBindingId`（Google sub／emailのclient自己申告は不可）、`householdId`、`planId`、`keyEpoch`へ結び、組が一致しないcursorやpasswordを再利用しない。空の共同世帯を初めて作る／personalから採用する場合は新しいshared `planId`を発行し、通常pullはremote shared `planId`を維持する。

IndexedDBは全recordを列挙できるrepository APIを持ち、次を冪等にcleanupする。

- 除名、退出、household削除、account削除
- Google account切替またはaccount generation変更
- keyEpoch不一致
- recordがないmarker、markerがないghost record
- planId不一致

通常logoutで保持するかは人間判断だが、保持する場合も次loginのverified sub一致を必須にする。未知の将来device-store versionは破壊的に削除せずquarantine／disableし、markerを「使用不可」へreconcileする。明示的な利用者削除または対応readerでのmigrationまでciphertextを保持する。

## 4. schemaVersionとlegacy規則

### 4.1 確定判定

| 入力 | 扱い |
|---|---|
| canonical `schemaVersion: 10` | v10 strict validation |
| `LifePlan.version: 9`＋既知root fingerprint | `legacy-versioned`。P0-2.3以降にversion別validator後のmigration対象とする |
| その他の証拠付きlegacy `LifePlan.version` | fixture catalogueへ実在が登録された場合だけ対応候補。1〜8を自動的に全許可しない |
| versionなし | 既知legacyのroot fingerprintを満たす場合だけ`legacy-unversioned`候補。schema 9またはcurrentとはみなさない |
| `version: 0` | historical fixture調査まではunsupported。実データ証跡がなければ拒否を確定 |
| 小数、負数、NaN、Infinity、string | `INVALID_SCHEMA_VERSION` |
| 10より大きい整数 | `UNSUPPORTED_SCHEMA_VERSION`。現在データは不変 |

versionなしを無条件にcurrentまたはschema 9として扱わない。既知fingerprintに一致しないversionless dataは`invalid`とする。versionless producerの実在は現repository履歴から確認できていないため、P0-2.1のknown-shape fixtureは旧importerが受理していたroot fingerprintに基づくsynthetic validation fixtureとして扱い、historical evidenceとは呼ばない。migration本体はP0-2.3以降で、証拠と救済規則を揃えてから実装する。

fixture catalogueは、schema label、由来commit／tag、旧app version、匿名化方法、元bytesのchecksum、期待migration結果を持つ。実履歴に基づくhistorical fixtureと境界試験用synthetic fixtureを別directory・別名称で管理する。

### 4.2 migration registry

```ts
type MigrationResult<T> =
  | { ok: true; value: T; from: number; to: number; warnings: MigrationWarning[] }
  | { ok: false; error: DataContractError };

interface MigrationContext {
  assignedPlanId: PlanId;
  assignedCreatedAt: UtcInstant;
  migratedAt: UtcInstant;
  entityIdMap?: Readonly<Record<string, string>>;
}

type MigrationStep<From, To> = (
  input: Readonly<From>,
  context: Readonly<MigrationContext>
) => MigrationResult<To>;

// P0-2.1ではinterfaceだけを固定し、実migrationは登録しない。
const migrationRegistry = new Map<number, MigrationStep<unknown, unknown>>();
```

規則:

1. stepはpureで、入力objectを変更しない。
2. 1 stepごとに「from strict validation→migration→to strict validation」を行う。
3. migration途中のobjectをReact state、storage、sync metadataへ渡さない。
4. current v10を再migrationしない。
5. 同じlegacy fixtureのmigration結果は決定的にする。日時やrandom IDが必要ならmigration contextから固定供給する。
6. ID生成mappingを一つのmigration resultへ保持し、参照を一括更新する。
7. warningは家計金額や氏名を含めず、field pathとreason codeだけにする。
8. 成功後も元rawをrollback／再export用に保持する。
9. legacyへ初めて付与する`planId`とfallback `createdAt`はmigration contextを作るjournalへ一度だけ記録し、同じraw fingerprintの再試行で再利用する。
10. legacy `createdAt`は有効な既存`updatedAt`を第一候補とし、使えなければjournalに固定したmigration開始時刻を使う。補完した事実はprivacy-safe warningとして残し、canonical化後は不変とする。
11. P0-2.1ではschema 9→10、versionless→10のmigration本体を実装せず、未登録versionは明示的な未対応結果にする。

## 5. 共通read pipeline

全経路で順序を固定する。

```text
raw取得
→ raw byte size確認
→ parse
→ structural budget（depth、node、string byte）確認
→ schemaVersion／legacy discriminator判定
→ version別strict validation
→ pure migration chain
→ current schema strict validation
→ duplicate ID・参照整合性確認
→ product／safety上限判定
→ 完全なcandidate stateを構築
→ canonical serialization／digestをmemory上で確定
→ expectedContentRevision等のpreconditionを確認
→ pre-change recoveryとcandidateを同一transactionで永続化
→ transaction completionを永続化成功境界とする
→ 必要なsync metadataをjournalに従って確定
→ 最後にReact stateと成功表示を更新
```

transaction commitより前に失敗した場合、次を変更しない。

- 現在の画面state
- 現在のplan record
- 現在のrecovery／版履歴
- 現在のplanId
- 現在のcontentRevision
- 現在のsharedRevision cursor
- 自動保存対象

raw file、暗号backup、shared revisionは元の場所に残す。

transaction commit後に別systemのmetadata確定が失敗し得るshared／cloudでは、単純な「全て不変」を約束しない。旧recordとpending journalを残し、再起動時に冪等reconcileして、成功表示はreconcile完了後に限る。commit後の任意read-backを成功条件にはせず、read-back不一致を検知する設計なら旧recordからの補償手順と`ROLLBACK_FAILED`を別途実装する。

## 6. strict validationと参照整合性

### 6.1 validation原則

- current schemaでは欠落、不正型、不正enum、不正日時、不正numberをdefaultや現在時刻へ黙って変換しない。
- legacy補完はmigration stepでのみ行う。
- unknown fieldは既定で`VALIDATION_FAILED`とする。将来拡張が必要な箇所だけ明示的`extensions` objectを定義する。
- JSONに表現できないNaN／Infinityはin-memory inputやtestでも拒否する。
- 金額、率、年齢、年はdomain範囲をstrictに検査する。
- user textはUTF-8 byte長を検査し、HTMLとして信用しない。

### 6.2 identity規則

- UUID生成は一つの`createPlanId`／`createEntityId`へ集約する。
- `planId`は全planで一意になるようrandom UUIDを使うが、推測困難性を認可に使わない。
- child IDは`planId + entity type`のscopeでunique。
- duplicate IDを黙って再発行しない。legacy migrationで再発行する場合は全参照を同じmappingで更新する。
- 新規plan作成で削除済みplanIdを意図的に再利用しない。
- 明示的な「削除済みplanのbackup復元」は同一論理planの復活としてplanId維持を許す。
- legacy planの初回IDはmigration journalでraw fingerprintに対応付ける。永続化に失敗した再試行で別IDを発行しない。

### 6.3 参照

最低限次を検査する。

- `detailedCashflowItems[].memberId`→同snapshotのhousehold member
- scenario／history snapshot内のmember参照はsnapshot内で完結
- `PlanRevision.sourceReviewId`は「live FK」か「historical pointer」かをfield名で区別
- active scenario provenanceはnameだけでなくscenario／history source IDを持つ
- entityを削除する操作は参照を明示的に更新し、import時にnull化しない
- 循環構造を許すfieldは現在ない。将来referenceを追加する場合はacyclic検査を定義する

### 6.4 canonical current snapshot境界

canonical current snapshotは、現行`LifePlan`のうちユーザーが入力・作成し、現在永続化されるdata全体をallow-listで持つ。rootのlegacy互換性metadata `version`と`updatedAt`は含めず、canonical envelopeの`schemaVersion`、`createdAt`、`updatedAt`へ責務を分離する。

含む対象は、profile／家族／家計／詳細収支／期間収支／資産／目標／event／timeline memo／simulation条件／取崩し・老後生活plan／notes／reviews・TODO／見直しscenario／版履歴／active scenario／固定費／予算・実績である。現行型はsimulation結果を永続化しておらず、P0-2.1で結果fieldを新設しない。将来結果を永続化する場合はschema changeとして追加する。

entitlement、Square契約、Google account／session、household membership／role、trusted-device資格情報、暗号鍵／passphrase、backup ID、household ID、Worker側sharedRevision、API token、PWA cache、一時UI／通信／保存state、sync pending journalは含めない。

canonical current snapshot内の版履歴entryは、履歴自身を再帰的に含まない専用`CanonicalPlanHistorySnapshot`を持つ。P0-2.1では既存`LifePlan`生産型や既存復元動作を変更せず、新契約型の境界だけを固定する。

### 6.5 既存Pro部分snapshot境界

P0-2では既存計算・UIを変えず、現在のscenario／版履歴snapshotの意味も別契約として固定する。

| snapshot kind | 置換対象 | 現在値を維持するもの |
|---|---|---|
| scenario | household members／household／cashflow mode・items・periods／assets／goals／events／simulation | profile、timeline memo、withdrawal／retirement、notes、fixed cost、budget／actual、reviews、history、その他root metadata |
| plan revision | profile、household、cashflow、assets、goals、events、timeline、simulation、withdrawal／retirement、notes、active scenario、fixed cost、budget／actual | reviews、scenarios、history collection自体 |

将来、各snapshotは`kind`とsnapshot schema discriminatorを持ち、含有fieldと維持fieldをfixtureで固定する。「採用」「復元」を完全plan snapshotと呼ばない。完全snapshot化やレビュー／scenarioまで過去へ戻す仕様は、既存意味を変えるため別の商品判断・migrationとする。

## 7. planIdの操作別規則

| 操作 | planId | contentRevision | 補足 |
|---|---|---|---|
| 通常保存／自動保存 | 維持 | 成功時+1 | 失敗時は変更なし |
| JSON export | 維持 | 変更なし | exportedAtだけ外側へ追加 |
| 同じplanとしてJSON復元 | 維持 | 現在とimportの最大値+1 | 同一IDなら確認必須 |
| JSONから複製 | 新規発行 | 1 | createdAt／updatedAtは複製時刻 |
| cloud backup作成 | 維持 | 変更なし | backupIdは毎回新規 |
| cloud backup復元（同一plan） | 維持 | 現在とbackupの最大値+1 | 復元前copy必須 |
| 別端末で同じplanを初回復元 | 維持 | backup値を維持 | 次の成功編集で+1 |
| 見直しplan作成 | root planId維持 | root保存成功時+1 | scenarioは独立scenarioId |
| 見直しplan採用 | root planId維持 | +1 | 採用前history成功を必須化 |
| 版履歴作成 | root planId維持 | +1 | historyEntryIdを新規発行 |
| 版履歴復元 | root planId維持 | +1 | 古いcontentRevisionへ戻さない |
| personal→household採用 | 新規発行 | 1 | scopeが変わるcopyとして扱う |
| household通常pull | shared planId維持 | remote値 | sharedRevisionは別 |
| household過去版復元 | shared planId維持 | +1 | 新sharedRevisionとして保存 |
| household→personal複製 | 新規発行 | 1 | server membershipを引き継がない |
| 同じJSONの重複import | restoreなら上記、copyなら毎回新規 | mode依存 | canonical digestは候補表示のみ |
| planId衝突 | 自動上書きしない | 変更なし | restore／copy／cancelを選択 |
| 削除済みplanId | 新規作成では再利用禁止 | - | 明示restoreだけ同一ID復活可 |

`max + 1`を使う操作は、両方のrevisionがsafe integerであることとoverflowしないことを先に確認する。import値を無制限に採用しない。通常保存、自動保存、import、restoreは`expectedContentRevision`をrepositoryへ渡し、transaction内のcurrent値と一致しない場合は`REVISION_CONFLICT`として自動merge・自動上書きをしない。

## 8. revisionの命名と正

| 名前 | 意味 | 正 |
|---|---|---|
| `contentRevision` | 一つのlogical planの成功更新回数 | local transactional store／canonical plan |
| `expectedContentRevision` | editorが変更開始時に見たlocal revision | local transactionのprecondition |
| `sharedRevision` | 共同世帯server snapshotの順序 | Worker／D1 |
| `expectedSharedRevision` | clientが編集開始時に見たserver revision | request precondition |
| `historyEntryId` | version history itemのidentity | plan data |
| `historySequence` | 必要な場合の表示順 | plan data。時刻だけに依存しない |
| `entitlementRevision` | P0-1権限snapshot | Worker |
| `dbMigrationVersion` | D1 schema migration | migration file／D1 |
| `schemaVersion` | plan data compatibility | canonical envelope |
| `envelopeVersion` | encryption／transport envelope | 経路固有envelope |
| `backupId`／`backupGeneration` | backup snapshot identity／任意順序 | Worker |
| `reviewId` | review record identity | plan data |
| `simulationEngineVersion` | 計算結果の再現性 | 将来の計算engine contract |

共同世帯ではclient申告値で次revisionを決めず、Workerが`current + 1`を発行する。競合は409 `REVISION_CONFLICT`で、現在server dataを上書きしない。

## 9. timestamp規則

- canonical instantはUTC ISO 8601 `YYYY-MM-DDTHH:mm:ss.sssZ`。
- `createdAt`は原則不変。migration日時は別metadata。
- `updatedAt`は永続更新成功時だけ変更。
- export、backup、history、review、暗号化、sync時刻を別fieldにする。
- server resourceの作成・更新時刻はWorker/D1時刻を正とする。
- local時刻は非信頼metadataであり、認可、課金、共同世帯CASへ使わない。
- `Date.parse`可能というだけでは受けず、canonical文字列へround-tripできることを検査する。
- invalid dateを現在時刻へ置換しない。
- `createdAt <= updatedAt`を必須とする。
- client clockが戻ってもorderingは`contentRevision`を正とし、timestampだけで競合解決しない。新しい`updatedAt`は前値より前にしないが、補正が必要なら結果へclock warningを付ける。
- importされたplan時刻、local `persistedAt`、server backup作成時刻は別値として維持し、上書きしない。
- future skewの許容値は実データ調査後の人間判断とし、P0-2.1 outer validatorでは現在時刻を取得・比較しない。
- domain date（eventの年月、review日）とinstantを混同しない。

## 10. product上限とabsolute safety上限

P0-2.1では商品上限とsafety上限を別field・別定数で表現するが、根拠のないsafety値を本番定数として固定しない。具体的なabsolute値はP0-2.2のfixture、desktop／mobile性能試験、既存data分布の確認後に決定する。

| 対象 | 確定product上限 | P0-2.1 safety上限 | product超過時 |
|---|---:|---:|---|
| 見直しscenario | 20 | 未確定（`null`） | 全件保持、warning／over-limit、新規追加だけ拒否 |
| 家族ごとの詳細収支 | 200 | 未確定（`null`） | 全件保持、warning／over-limit、新規追加だけ拒否 |
| 計画版履歴 | 8 | 未確定（`null`） | 全件保持、warning／over-limit、新規追加だけ拒否 |

既存生産コードにあるJSON file 5 MiB、暗号化前plaintext 5 MiB、Worker request body 7 MiB等は監査時点の経路別safeguardであり、P0-2.1で変更しない。これらをcanonical plan全体のstructural safety値や、各collectionのsafety上限として流用しない。

household member、cloud backup、local recovery、共同世帯server revision等の既存商品・retention規則はこの3種と別policyである。特に共同世帯server revisionのlist／retention目標10と、計画版履歴8件を混同しない。shared revisionのabsolute safety値もP0-2.2の測定前に100等へ固定しない。

### 10.1 over-limit状態

- product超過はdata自体をinvalidにしない。全件を保持し、閲覧・export・削除・整理を許可し、新規追加だけ止める。
- safety超過は常に全体拒否。
- 保存し直すだけで超過分を削除しない。
- safety値が未確定のpolicyでは、product超過をsafety超過へ読み替えない。
- 件数判定は入力collectionを変更せず、先頭・末尾・超過分を削除しない。
- P0-2.2でabsolute safety値を決めるまでは、strict payload validatorや生産read pathへ推測値を接続しない。

## 11. atomic replaceとrollback

### 11.1 browser

最終形はIndexedDB transactionを推奨する。

1. current planとrecoveryを同一transactionでread。
2. transaction内currentの`contentRevision`とcallerの`expectedContentRevision`を照合する。
3. candidateのcanonical bytes／digestをtransaction前に確定する。
4. candidateとpre-change recoveryを同一transactionへwrite。
5. transaction completionをawaitし、これを永続化成功境界とする。
6. 成功後だけReact stateを更新。

localStorageを暫定利用する場合は、staging record、commit marker、起動時recoveryを持つjournal protocolが必要である。複数keyの「順番にsetItem」をatomicと呼ばない。

### 11.2 JSON／cloud restore

- 復元前copyの永続化に失敗したら復元を中止する。
- main保存に失敗したらstate、password欄、選択target、成功messageを変更しない。
- `RestoreResult`はphaseとerror codeを返し、UI文字列はdomain logicへ入れない。
- migration失敗時は元fileをsession中に再downloadできるよう保持する。

### 11.3 shared pull／push

D1、R2、browser store、IndexedDBを一つのtransactionにはできないため、recoverable state machineを使う。

```text
pending operation journal作成
→ remote／local precondition確認
→ plan永続化またはWorker CAS
→ device cursor永続化
→ read-back／reconcile
→ journal完了
→ UI成功
```

operation journalは最低限、operation ID、`pull | push | restore`、phase、account binding、householdId、planId、keyEpoch、expected revision、candidate revision、source revision（restore時）、stable sync-content digest、candidate encrypted-envelope digestを持つ。push response喪失後はserver current revisionと取得したencrypted-envelope digestをcandidateと照合し、完全一致していれば再pushせずcursor確定へ進む。

sync-content digestはclient内だけで計算し、canonical `data`のstable fieldを対象にする。`appVersion`、`contentRevision`、`createdAt`、`updatedAt`、local persistedAt、journal metadataはsemantic data digestから除外するが、`schemaVersion`、`planId`、`createdAt`、`contentRevision`は別fieldとしてremote candidateと完全一致を確認する。`updatedAt`／`appVersion`はpull時にremote canonical値へ収束させる。data digestだけが同じでmetadataが異なるplanを「同期済み」としない。canonical serializationの規則とfixtureを固定し、plaintext digestをserverへ送らない。

再起動時はjournal、server current revision、planId、sync-content digestを比較して冪等に完了またはrollbackする。古いrevisionをclient判断で再送しない。memory上のcredential cursor、`lastSyncedAt`、UI表示はIndexedDB更新promiseが完了してから進める。

shared readerは本文読込前にR2 object size、D1 `size_bytes`、R2 custom metadataを照合する。AES-GCM認証失敗はpassword誤り／暗号破損の同一一般errorにできるが、認証成功後のwrapper parse、future schema、legacy migration、validation errorは別phase／codeに分ける。future schemaをpassword errorへ丸めず、remote revisionとlocal current／cursorを維持する。

shared historyの10件はlist／retention目標であり、cleanup失敗中の一時超過を破損扱いしない。R2削除後にD1 revision row削除が失敗したdangling stateをcleanup queueで冪等に再試行し、current revisionを削除対象にしない。absolute safety capはP0-2.2の負荷測定後に決定し、計画版履歴8件や根拠のない100件を流用しない。決定時は契約・fixture・運営cleanup手順を同じreview単位で更新する。

### 11.4 cloud R2／D1

- D1 rowへ`pending_create`／`active`／`pending_delete`を持つstate machineを採用する。
- clientはplanやbackup IDと独立したrandom `operationId`をPOSTのidempotency keyとして送る。D1は`(user_id, operation_id)`をuniqueとし、同じoperationの再試行では既存状態／結果を返す。
- createはD1 transactionでquota slotと`pending_create`を確保→R2 put→D1 `active`、deleteはD1 `pending_delete`→R2 delete→D1 row削除の順とする。
- 5件上限は`pending_create`、`active`、`pending_delete`を合計し、同時POSTのslot確保をserializableなD1 transactionまたは同等のconditional updateで行う。
- 一覧と復元APIは`active`だけを返す。server内各phaseはbackup ID、client再試行はoperationIdをidempotency keyとする。
- cleanupはpending rowを正として冪等なCronで再試行する。D1 row作成前の失敗ではR2を書かない。
- R2本文読込前にobject size、D1 size、custom metadataを検査する。
- rollback不能なpartial stateを「成功」として返さない。

## 12. checksumと暗号化

- 独自暗号方式を追加しない。
- 暗号文の真正性・改ざん検知はAES-GCM tagとAADが正。
- R2 SHA-256は保存bytesの偶発破損、D1/R2不一致検知用。
- checksumをpassword、鍵、salt、IV、tagの代用にしない。
- JSON duplicate候補にはcanonical serialization後のdigestを端末内で一時利用できるが、認証済みchecksumとは表示しない。
- canonical serializationはobject keyを安定順序にし、空白差だけでdigestが変わらないようにする。
- plan plaintextから得たdigestをserverへ送る設計は、同一データ判別によるprivacy影響を再評価するまで採用しない。
- 平文、password、鍵、家計値をlog、exception、analyticsへ出さない。

AADはenvelope versionごとのprotocolとする。既存cloud envelope v1は現行固定AADを、shared envelope v1は現行の`householdId`／`revision`／`keyEpoch`を結ぶcanonical AADをbyte-for-byte維持する。新しいenvelope versionでAADを変える場合は、`format`、`envelopeVersion`、各identity fieldを長さ曖昧性のないcanonical encodingで結び、既存fixtureとの復号互換テストを必須にする。backup IDをAADへ結ぶ変更は二段階ID発行が必要になるため、P0-2で暗黙に追加せず別security designで決定する。

## 13. エラー契約

```ts
type DataContractErrorCode =
  | "INVALID_JSON"
  | "EMPTY_DATA"
  | "FILE_TOO_LARGE"
  | "INVALID_ENVELOPE"
  | "UNSUPPORTED_ENVELOPE_VERSION"
  | "UNSUPPORTED_EXPORT_VERSION"
  | "INVALID_SCHEMA_VERSION"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "INVALID_PLAN_ID"
  | "INVALID_CONTENT_REVISION"
  | "TIMESTAMP_ORDER_INVALID"
  | "MIGRATION_REQUIRED"
  | "UNSUPPORTED_LEGACY_DATA"
  | "LEGACY_MIGRATION_FAILED"
  | "VALIDATION_FAILED"
  | "REFERENCE_INTEGRITY_FAILED"
  | "DUPLICATE_ID"
  | "PLAN_ID_CONFLICT"
  | "PRODUCT_LIMIT_EXCEEDED"
  | "SAFETY_LIMIT_EXCEEDED"
  | "INVALID_TIMESTAMP"
  | "INVALID_NUMBER"
  | "CHECKSUM_MISMATCH"
  | "DECRYPTION_FAILED"
  | "STORAGE_WRITE_FAILED"
  | "STORAGE_QUOTA_EXCEEDED"
  | "REVISION_CONFLICT"
  | "ATOMIC_REPLACE_FAILED"
  | "ROLLBACK_FAILED";

interface DataContractError {
  code: DataContractErrorCode;
  phase:
    | "read"
    | "parse"
    | "decrypt"
    | "integrity"
    | "validate"
    | "migrate"
    | "commit"
    | "sync"
    | "reconcile"
    | "rollback";
  retryable: boolean;
  fieldPath?: string;
  schemaVersion?: number;
}
```

P0-2.1のpure validation issueは、少なくとも`EMPTY_DATA`、`INVALID_ENVELOPE`、`INVALID_SCHEMA_VERSION`、`UNSUPPORTED_SCHEMA_VERSION`、`INVALID_PLAN_ID`、`INVALID_CONTENT_REVISION`、`INVALID_TIMESTAMP`、`TIMESTAMP_ORDER_INVALID`、`VALIDATION_FAILED`、`PRODUCT_LIMIT_EXCEEDED`、`SAFETY_LIMIT_EXCEEDED`、`MIGRATION_REQUIRED`、`UNSUPPORTED_LEGACY_DATA`、`REVISION_CONFLICT`を安定codeとして持つ。issueは`code`、schema fieldだけからなる`path`、`error | warning`の`severity`、安全なtechnical summaryだけを返し、raw inputや実際のfield値を含めない。

error objectへ氏名、email、家計金額、資産額、家族情報、memo、plan plaintextを入れない。

Workerの既存lower snake case API code、domainのupper snake case code、UI文言はadapterで分離する。HTTP statusとWorker codeをclient domain errorへ一方向にmappingし、UIはdomain codeだけを表示文言へ変換する。`fieldPath`はschema field名と配列indexだけに限定し、user生成key、ID、氏名を含めない。

### 利用者表示

- 何が失敗したか、現在データが変更されていないか、再試行可能かを伝える。
- future schemaは「このアプリより新しい形式。更新後に再試行」と表示し、元file／backupを削除しない。
- over-limitは削除件数を示さず、自動削除していないことと整理／export手段を示す。
- rollback failureは通常errorと分け、JSON exportとsupport導線を最優先にする。
- cloud password誤りと暗号破損はsecurity上同じ一般messageでもよい。詳細はlogにも平文を含めない。

### log

記録してよい:

- error code、phase、schema／envelope version
- byte数、entity count、limit名
- backup ID／household IDは必要最小限の内部IDとしてaccess制御されたlogへ
- household revision、HTTP status、CF-Ray、duration

記録禁止:

- plan JSON、復号平文、ciphertext全文
- password、鍵、salt／IVの組、session token、invite token
- 氏名、email、memo、目標名、家計・資産・収支・家族情報
- raw import file

## 14. future schemaとmigration失敗の救済

- future schemaはplan viewerへ渡さず、raw download／元backup保持だけを許可する。
- old appで意味を解釈したread-only表示は行わない。unknown fieldを誤表示するためである。
- migration失敗時は元rawを変更せず、error codeと失敗stepだけを表示する。
- browser起動時legacy migrationは、pre-migration raw退避とcanonical保存の両方が成功してから画面へ反映する。
- 保存できない場合は旧rawを上書きせず、容量整理とraw exportを案内する。

### 14.1 reader-first rollout

1. legacyとv10を読めるreaderを先に配布し、writerはv9のままにする。
2. desktop／mobile、JSON、cloud、sharedでreader実測とrollback rehearsalを完了する。
3. 少なくとも次のreleaseでv10 writerをfeature flagにより有効化する。
4. writer有効化後に旧appへrollbackする場合も、配布済みreaderがv10を拒否・破壊しないことを確認する。

legacy readerの保持期限は経路ごとに分ける。localStorage旧keyはmigration成功率とrollback期間を根拠に終了できるが、利用者保管JSON、cloud envelope v1、shared envelope v1は全objectの移行確認または明示的な長期support／sunset policyなしに削除しない。単に「1 release経過」を削除根拠にしない。

## 15. JSON importのrestore／copy

import開始前にmodeを選択させる。

- **復元**: 同一論理planとしてplanIdを維持する。現在planIdと一致する場合も明示確認し、contentRevisionを前進させる。
- **複製**: 新planId、contentRevision 1、new createdAt／updatedAtを発行する。child IDはplanId scopeなので全体copyでは維持可能だが、外部参照は引き継がない。
- planIdがcurrentと異なるのに「復元」を選ぶ場合は、現在planを置換することを明示しpre-change recoveryを必須にする。
- identity衝突時に自動上書きしない。
- 同じJSONを複数回importした場合、canonical digestで候補警告できるが、最終判断はmodeに従う。

## 16. data保持と削除

- Free降格、migration、上限超過を理由に保存済みdataを削除しない。
- explicit user delete、公開済みrolling retention、法的retentionだけを削除根拠にする。
- manual history、安全checkpoint、server shared history、cloud backupを別retention classにする。
- safety checkpointはmanual historyより優先する。
- rolling削除は新snapshotの永続化成功後だけ行う。
- R2削除はD1状態遷移とcleanup retryを伴う。
- account／household権限失効後はserver accessを即拒否し、device credential cleanup方針を別途適用する。

## 17. JSON・backup・sharedの共通点と相違点

| 項目 | JSON | cloud backup | shared household |
|---|---|---|---|
| canonical plaintext | 同じPlanEnvelope | 同じPlanEnvelope | 同じPlanEnvelope |
| 暗号化 | なし | client AES-GCM | client AES-GCM |
| server保存 | なし | R2 ciphertext＋D1 metadata | R2 ciphertext＋D1 auth/revision |
| identity外側 | exportVersion | backupId | householdId＋sharedRevision |
| compatibility判定 | client | 復号後client | 復号後client |
| concurrency | local contentRevision | restore時local contentRevision | Worker CAS sharedRevision |
| ownership | user file管理 | Worker session user ID | Worker membership／role |
| migration | client | 復号後client | 復号後client |
| checksum | 任意local digest | R2 envelope SHA-256 | R2 envelope SHA-256 |
| failure recovery | raw file維持 | backup維持＋local recovery | remote revision維持＋journal |
| server plaintext | なし | なし | なし |

## 18. 人間が決定する事項

| 項目 | 推奨 | 代替／trade-off | 推奨を覆す条件 |
|---|---|---|---|
| versionなし | 既知legacy fingerprint一致時だけ`legacy-unversioned`候補。schema 9／currentにはしない | 全拒否は安全だが旧importer互換性を落とす | versionless実データの形状証拠が確認された場合 |
| schemaVersion現行値 | **10で確定**。`LifePlan.version: 9`はlegacy schema 9 | 1から再開始はenvelope versionと混同しやすい | schema変更の正式な後続versionを採用する場合 |
| canonical位置 | dataの外側PlanEnvelope | rootへ混在は差分小だが責務が曖昧 | 大規模migration riskが許容不能な場合 |
| import mode | restore／copyを選択 | 一律restoreは簡単だが衝突する | single-plan固定を永久仕様にする場合 |
| scenario 20超 | 全件保持、warning、閲覧・export・削除・整理可、新規追加停止 | 全体拒否は簡単だがproduct上限をdata lossへ転用する | P0-2.2で別safety上限を実測した場合 |
| 詳細収支200超 | 全件保持、warning、閲覧・export・削除・整理可、新規追加停止 | UIで安全に扱えないabsolute超過は全体拒否 | P0-2.2で別safety上限を実測した場合 |
| history 8件 | manualは自動削除せず整理、明示server rollingだけ自動削除 | 常時rollingは簡単だがuser historyを失う | UIで8件rollingが明示承認された場合 |
| safety history | manualより優先 | 同列は実装簡単 | 別の外部backupが必ず存在する場合 |
| restore前copy | 必須。失敗時中止 | best effortは復旧不能risk | transactionで完全rollbackできる場合のみ省略可 |
| migrated data保存 | raw退避後に即時atomic保存 | memoryのみは次編集と混ざる | read-only migration preview機能を実装する場合 |
| shared migration担当 | 復号後client | Workerは平文を読めず不可能 | server-side E2EEを廃止する場合 |
| future schema表示 | raw exportのみ | read-only viewerは互換性risk | forward-compatible subset schemaを別途定義した場合 |
| planId衝突 | restore／copy／cancel、無条件上書き禁止 | 自動copyは簡単だが重複を増やす | currentが明示的empty placeholderの場合 |
| duplicate import検出 | planId＋local canonical digestでwarning | 未検出でもdata lossはない | performance／privacy負担が大きい場合 |
| checksum追加 | canonical内には追加しない | JSON外側checksumは破損検知に便利 | 実際の破損事例とcanonical serializerが整った場合 |
| safety値 | P0-2.1では未確定。P0-2.2のfixture・desktop／mobile実測後に別定数として決定 | 小さすぎるとlegacyを拒否、大きすぎるとDoS | benchmarkと既存data分布の証拠が揃った場合 |
| parse前拒否 | byte上限、parse後structural budget | streaming parserは依存と複雑性増 | 5 MiB parseが対象mobileで危険と判明した場合 |
| migration失敗raw export | 必須 | session memory負担 | platformがfile再選択を確実に案内できる場合 |
| 通常logout時credential | account切替・除名等は削除。通常logoutは利用者選択を推奨 | 常時削除は安全だが再設定負担 | shared deviceを恒久trustedとする商品判断 |
| timestamp skew／下限 | 新規local instantはfuture 24時間案、orderingはrevision | 全future拒否は端末clock誤差に弱い | 実データ分布と対象端末clock誤差 |
| legacy reader終了 | 経路別support policy。cloud／sharedは時間だけで削除しない | 永久保持は保守負担 | 全object移行確認と利用者向けsunset完了 |
| Pro snapshot範囲 | P0-2では現行の部分snapshot意味を明文化して維持 | 完全snapshotは直感的だが保存量・migration・復元意味が変わる | 利用者調査で「完全に時点へ戻る」期待が優勢な場合 |

## 19. P0-2実装タスク

### P0-2.1 — canonical contract、validator、error

- 目的: 本番pathを変えずに型とpure判定を固定する。
- 対象候補: 新規`shared/plan-data-contract.js`＋型宣言、`tests/fixtures/plan-data-contract/`、logic test、最小test runner更新。既存`src/types.ts`生産型は変更しない。
- 変更: PlanEnvelopeV10、canonical／非再帰history snapshot境界、error code、outer envelope strict validator、product／safety limit decision interface、migration interface、expectedContentRevision。
- 対象外: JSON／backup／sharedの実動作、UI、DB。
- 依存: なし。
- 受入: current／invalid／future／limit metadataのpure test、既存data無変更。
- test: unit必須。既存Worker API／E2Eの回帰は`verify`で確認するが、生産経路への新しいintegration testは追加しない。
- migration: interfaceのみ。DB migrationなし。
- 既存data: 変更なし。
- rollback: 新規moduleとtestをrevert。
- commit単位／範囲: 1実装commit＋1仕様証跡commit、small。
- billing: 必須。**次に実装する最小タスク。**

### P0-2.2 — historical fixture catalogue、性能基準、pure limit policy

- 目的: 実在したlegacy schemaと対象端末の安全域を証拠化し、migrationより先に非破壊limit判定を固定する。
- 対象候補: Git tag／commit由来historical fixture、匿名化旧export、別directoryのsynthetic boundary fixture、benchmark runner、pure limit policy。
- 変更: fixture catalogue、由来metadata、version fingerprint候補、product／safety decision、aggregate budget。
- 対象外: migration、保存path接続、整理UI。
- 依存: P0-2.1。
- 受入: historicalとsyntheticを区別し、desktop／mobile基準を記録。超過結果は全件保持候補または全体拒否で、sliceしない。
- test: unit必須。Worker API／E2E不要。
- migration: なし。DBなし。
- 既存data: fixture／benchmarkのみ。実data書換えなし。
- rollback: pure policyとfixtureをrevert。
- commit単位／範囲: fixture catalogue、benchmark、pure policyを分ける、medium。
- billing: 必須。

### P0-2.3 — evidence-backed pure legacy migration

- 目的: catalogueで確認したversionだけを決定的にv10へ変換する。
- 対象候補: 新規migration registry、migration journal型、logic test。
- 変更: evidence-backed discriminator、directまたは必要なstep migration、migration後validation、stable planId／createdAt context、snapshot discriminator、ID mapping。
- 対象外: 保存path接続、UI、DB。
- 依存: P0-2.1、P0-2.2。
- 受入: 全historical fixture成功、current再migrationなし、失敗時input不変、同じjournal contextで決定的、証拠なしversion拒否。
- test: unit必須。Worker API／E2E不要。
- migration: plan migrationあり。DBなし。
- 既存data: fixtureだけ。実data書換えなし。
- rollback: registry未接続のためmodule revert。
- commit単位／範囲: observed version群ごとに小commit、medium。
- billing: 必須。

### P0-2.4 — transactional browser repositoryとJSON

- 目的: browser load/save/import/exportを共通pipelineとatomic state updateへ接続する。
- 対象候補: `src/utils/storage.ts`、`useLifePlanEditor.ts`、`DataView.tsx`、新browser repository。
- 変更: localStorage legacy reader、IndexedDB transaction、restore/copy mode、raw rescue。localStorage journalはIndexedDBを採用できない根拠が出た場合だけのfallback。
- 対象外: cloud／shared。
- 依存: P0-2.1〜P0-2.3。
- 受入: transaction commit前の全失敗phaseでcurrent bytesとReact state不変。commit完了後だけstate更新。future拒否。黙示sliceなし。
- test: unit＋desktop/mobile E2E。Worker API不要。
- migration: browser data migrationあり。DBなし。
- 既存data: pre-migration rawを保持。
- rollback: legacy readerと旧keyをrollback期間保持。
- commit単位／範囲: repository、JSON export、JSON importを分ける、large。
- billing: 必須。

### P0-2.5 — cloud backup restoreとR2／D1 lifecycle

- 目的: 復号後strict validation、atomic local restore、server partial failure回収。
- 対象候補: `cloudBackupCrypto.ts`、`CloudBackupPanel.tsx`、`worker/backups.js`、必要ならmigration。
- 変更: canonical plaintext、legacy envelope reader、RestoreResult、R2 size check、`operationId` idempotency、atomic quota slot、`pending_create`／`active`／`pending_delete` state machine。
- 対象外: Square、権限contract変更。
- 依存: P0-2.1〜P0-2.4。
- 受入: Free rescue維持、平文非送信、全local pre-commit failureで無変更、同じoperationId再試行は同じbackupを返し、同時POSTでも5件を超えず、server cleanupを再試行できる。
- test: unit＋Worker API＋E2E。response喪失再POST、同時quota slot、各pending state、R2／D1 failure injectionを含む。
- migration: legacy backup reader／row handlingあり。operation ID、state、quota slot用DB migrationあり。
- 既存data: envelope v1とnullable checksum行の方針をrunbook化。
- rollback: v1 readerとold API responseを維持し、new writerをflag化。
- commit単位／範囲: client contract、Worker read hardening、lifecycle migrationを分ける、large。
- billing: 必須。

### P0-2.6 — shared identity、schema、revision、device journal

- 目的: E2EEを維持しながらplanId、client migration、server CAS、local cursorを整合させる。
- 対象候補: shared crypto／API／auto-sync／device store／Worker sharedPlans。
- 変更: canonical plaintext、legacy reader、new-revision restore、source audit、pending journal、account／household／plan／keyEpoch binding、future device version隔離、credential cleanup、shared R2 read integrity。
- 対象外: viewer本実装、role UI、招待仕様変更。
- 依存: P0-2.1〜P0-2.4。
- 受入: future／inner schema mismatchはpassword errorと分離してlocal／cursor不変。CAS維持、平文非送信、IDB完了後だけmemory cursor更新、lost response再調停、旧key履歴の明示password復元、再起動reconcile。
- test: unit＋Worker API＋desktop/mobile E2E＋real D1 integration。size／custom metadata mismatch、account／household切替、空household採用の新planId、pullでremote planId維持、future device version、key rotation前historyを含む。
- migration: encrypted planはclient migration。account／plan bindingとquarantine用IDB migration。`household_audit_events.source_revision`追加のDB migrationを必須とする。
- 既存data: shared envelope v1 reader必須。
- rollback: old envelope reader、keyEpoch、current revisionを維持し、writer切替をflag化。
- commit単位／範囲: crypto contract、client journal、Worker restoreを分ける、large。
- billing: 必須。

### P0-2.7 — over-limit整理UIとhistory retention

- 目的: P0-2.2のpure policyを各経路へ接続し、超過分を削除せず整理可能にし、history retentionを安全化する。
- 対象候補: config、各editor、history/recovery repository、最小整理UI。
- 変更: over-limit state、追加停止、整理／export、安全拒否、manual/safety retention分離。
- 対象外: 新しいPro販売上限、UI全面変更。
- 依存: P0-2.2、P0-2.4。cloud/shared接続はP0-2.5／P0-2.6後。
- 受入: boundary fixtureで全件保持または全体拒否、sliceなし、rollingは成功後だけ。
- test: unit＋対象E2E。Workerはcloud/shared limitのみ。
- migration: legacy over-limit分類あり。DBなし。
- 既存data: 自動削除なし。
- rollback: limit enforcementをdisableしてもraw保持を継続。
- commit単位／範囲: structural limit、product over-limit、historyを分ける、medium-large。
- billing: 必須。

### P0-2.8 — reader-first rollout、migration rehearsal、rollback、回帰証跡

- 目的: 実data rollout前の運用手順とend-to-end failure matrixを完成させる。
- 対象候補: fixture runner、E2E、runbook、release checklist。
- 変更: dry-run、backup確認、rollback、privacy-safe log、real D1 test。
- 対象外: 新機能。
- 依存: P0-2.1〜P0-2.7。
- 受入: 全異常系、desktop/mobile、build、audit、rollback rehearsal成功。
- test: unit／Worker API／E2E／integrationすべて。
- migration: 本番data migration手順。必要なDB migrationを順序化。
- 既存data: dry-run report後にのみwriter有効化。
- rollback: reader先行配布後にwriterを有効化。local旧readerは実測期間、JSON／cloud／shared v1 readerは経路別sunset完了まで維持。new writer停止手順を固定。
- commit単位／範囲: testsとrunbookを分ける、medium。
- billing: 必須。

## 20. P0-2対象外

- Square event順序、返金、chargeback、定期照合
- viewerのD1／招待／API／UI実装
- entitlement refresh
- simulation seed／input hash／engine version本実装
- read-only Pro UI全体
- 新しい課金画面
- UI全面design変更

この文書は上記の拡張点を命名するが、実装をP0-2へ混入させる根拠にはしない。
