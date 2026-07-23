# Life Compass 世帯共有セキュリティ設計

## 1. 状態

この文書は世帯共有の設計と段階的な実装状態を管理します。D1とWorkerの非公開基盤は実装済みですが、共同プラン保存、共同編集、利用者向けUIは本番利用者へ公開しません。

実装は`disabled`、運営者限定の`preview`、本番用の`enforced`の順で進めます。セキュリティ受入条件をすべて満たすまで`enforced`へ切り替えません。

現在の既定値は`HOUSEHOLD_SHARING_MODE=disabled`です。リモートD1へマイグレーションを適用し、招待用Secretを設定し、否定テストと運営者確認を終えるまで変更しません。

## 2. 目的

- Googleログインした本人と配偶者が、1つの共同プランを利用できる
- 1契約につきオーナー1人、共同利用者1人まで参加できる
- 家計、資産、家族、目標、イベント、レビュー、シナリオを共同で確認できる
- 誰がいつ保存したかを確認できる
- サーバーや運営者がライフプランの平文を読めない
- 招待、解除、退会、アカウント削除を利用者自身で管理できる

## 3. 対象外

初期版では次を実装しません。

- 3人以上のアカウント共有
- リアルタイム同時編集
- フィールド単位の自動マージ
- 運営者による共有パスワードの復旧
- Google Driveへの保存
- 招待メールの自動送信
- 端末間での暗号鍵の自動移行

## 4. 用語の分離

既存の`householdMembers`は、試算上の本人、配偶者、子ども、親を表します。Googleログインする共同利用者とは別の概念です。

- 計画上の世帯メンバー: `LifePlan.householdMembers`
- ログイン利用者: `users`
- 共同プランへの参加権限: `household_memberships`
- 共同プランの単位: `shared_households`

計画上の「配偶者」を追加しても、Googleアカウントへの共有権限は発生しません。

## 5. 採用する安全モデル

### 5.1 二重の保護

共同プランは次の2条件がそろった場合だけ開けます。

1. Googleログイン済みで、D1に有効な世帯参加権限がある
2. 利用者が世帯共有パスワードを入力し、ブラウザ内で暗号文を復号できる

招待URLだけ、Googleログインだけ、R2オブジェクトキーだけでは共同プランを読めません。

### 5.2 平文の保存場所

- ブラウザ: 編集中の共同プランの平文
- D1: 世帯、参加者、招待、保存版、監査履歴のメタ情報
- R2: 暗号化された共同プラン
- Workerログ: エラー分類と操作結果だけ

D1、R2、Workerログへライフプランの平文を保存しません。

### 5.3 共有パスワード

- 12文字以上、200文字以下
- ブラウザからWorkerへ送信しない
- localStorage、sessionStorage、IndexedDB、Cookieへ保存しない
- JavaScriptメモリ内で、そのタブを開いている間だけ保持できる
- 招待URLへ含めない
- オーナーと共同利用者が別の安全な経路で共有する
- 忘れた場合、運営者は復旧できない

初期版では、Googleログインと共有パスワードを分けることで、Googleアカウントまたは招待URLの片方だけが漏れた場合の影響を抑えます。

## 6. 暗号化形式

既存の暗号化クラウドバックアップと同じWeb Crypto APIを使います。

- 暗号化: AES-256-GCM
- 鍵導出: PBKDF2-HMAC-SHA-256
- 反復回数: 600,000回
- salt: 保存ごとに16バイトの暗号学的乱数
- IV: 保存ごとに12バイトの暗号学的乱数
- 認証タグ: 128ビット

共同プラン形式:

```text
format: life-compass-shared-plan
version: 1
householdId: UUID
revision: 1以上の整数
keyEpoch: 1以上の整数
encryption: AES-GCM / 256
keyDerivation: PBKDF2 / SHA-256 / 600000
salt: Base64
iv: Base64
ciphertext: Base64
```

追加認証データには次を含めます。

```text
Life Compass shared plan v1|householdId|revision|keyEpoch
```

これにより、暗号文を別世帯、別リビジョン、別の鍵世代へ差し替えた場合に復号が失敗します。

## 7. D1データモデル

次段階で新しいマイグレーションとして追加します。既存テーブルの意味は変更しません。

### shared_households

| 列 | 内容 |
| --- | --- |
| id | UUID |
| owner_user_id | 契約者であるオーナー |
| status | active、read_only、deleting |
| key_epoch | 共有鍵の世代 |
| current_revision | 現在版 |
| created_at、updated_at | 日時 |
| deleted_at | 論理削除日時 |

### household_memberships

| 列 | 内容 |
| --- | --- |
| household_id | 対象世帯 |
| user_id | Googleログイン利用者 |
| role | owner、editor |
| status | active、revoked、left |
| joined_at、revoked_at | 日時 |

制約:

- 1世帯につきownerは1人
- activeな参加者は最大2人
- 1利用者が初期版で参加できるactive世帯は1つ
- ownerをmembershipにも必ず登録する

### household_invitations

| 列 | 内容 |
| --- | --- |
| id | UUID |
| household_id | 対象世帯 |
| created_by | 招待したowner |
| token_hash | 招待トークンのSHA-256ハッシュ |
| invitee_email_hmac | 確認済みメールのHMAC |
| role | editor固定 |
| expires_at | 24時間以内 |
| accepted_at、revoked_at | 使用、取消日時 |
| created_at | 作成日時 |

平文メールを招待テーブルへ保存しません。HMACにはCloudflare Secretの専用pepperを使います。

### shared_plan_revisions

| 列 | 内容 |
| --- | --- |
| household_id | 対象世帯 |
| revision | 単調増加する版番号 |
| key_epoch | 暗号鍵の世代 |
| r2_object_key | 非公開R2キー |
| envelope_version | 暗号化形式 |
| plan_version | Life Compass保存形式 |
| size_bytes | 暗号文サイズ |
| checksum_sha256 | 暗号化JSONのチェックサム |
| created_by | 保存した利用者 |
| created_at | 保存日時 |

最大10版を保持します。上限を超えた古い版は、D1とR2の両方から安全に削除します。

### household_audit_events

| 列 | 内容 |
| --- | --- |
| id | UUID |
| household_id | 対象世帯 |
| actor_user_id | 操作した利用者 |
| event_type | created、invited、joined、saved、restored、removed、left、deleted |
| revision | 関連する場合だけ |
| created_at | 日時 |

ライフプラン本文、金額、名前、メモ、共有パスワード、招待トークンを監査履歴へ保存しません。

## 8. 招待フロー

1. ownerがGoogleへ再ログインしてから招待を作成する
2. ownerが共同利用者のGoogle確認済みメールを入力する
3. Workerが256ビット以上のランダムトークンを生成する
4. D1にはトークンのSHA-256ハッシュとメールHMACだけを保存する
5. 生のトークンは招待URLとして1回だけownerへ返す
6. ownerが招待URLを共同利用者へ渡す
7. 共同利用者が対象メールのGoogleアカウントでログインする
8. Workerがトークン、期限、未使用、未取消、メールHMAC、人数上限を確認する
9. 1回の処理でmembershipを作り、招待を使用済みにする
10. 共同利用者は共有パスワードを別途入力して共同プランを復号する

招待受諾はD1トランザクションで行い、同じトークンの二重受諾を防ぎます。

## 9. 権限

| 操作 | owner | editor |
| --- | --- | --- |
| 共同プラン閲覧 | 可 | 可 |
| 新しい版の保存 | 可 | 可 |
| 過去版の閲覧、復元 | 可 | 可 |
| 更新履歴の確認 | 可 | 可 |
| 招待作成、取消 | 可 | 不可 |
| 共同利用者の解除 | 可 | 不可 |
| 自分で世帯から退出 | 世帯削除または所有権移行が必要 | 可 |
| 共有パスワード変更 | 可 | ownerの確認が必要 |
| 世帯削除 | 可 | 不可 |

初期版ではviewer権限を作りません。役割を増やすと認可分岐とテスト範囲が広がるためです。

## 10. API設計

共有機能は`HOUSEHOLD_SHARING_MODE`が`preview`または`enforced`の場合だけ利用できます。

予定API:

```text
GET    /api/shared-household
POST   /api/shared-household
POST   /api/shared-household/invitations
DELETE /api/shared-household/invitations/:id
POST   /api/shared-household/invitations/accept
GET    /api/shared-household/plan
PUT    /api/shared-household/plan
GET    /api/shared-household/revisions
POST   /api/shared-household/revisions/:revision/restore
DELETE /api/shared-household/members/:userId
POST   /api/shared-household/leave
DELETE /api/shared-household
```

共通要件:

- Googleログイン必須
- 状態変更は同一Origin必須
- 許可したContent-TypeとHTTPメソッドだけを受け付ける
- 世帯IDをリクエスト本文から信用せず、membershipから解決する
- owner専用操作はroleをD1で確認する
- Rate Limitingを適用する
- エラーに内部SQL、R2キー、メールHMAC、Secretを含めない
- `Cache-Control: no-store`

## 11. 保存と競合

初期版は自動同期ではなく、明示的な「共有へ保存」「共有から取得」から始めます。

保存時:

1. ブラウザで共同プランを暗号化する
2. 現在取得済みの`expectedRevision`を送る
3. WorkerがmembershipとPro権限を確認する
4. 現在版と一致しない場合は409を返す
5. 新しいR2キーへ暗号文を保存する
6. D1へ新しいrevisionを登録し、現在版を更新する
7. D1登録に失敗した場合は新しいR2オブジェクトを削除する

409の場合は自動上書きせず、利用者へ「別の端末または共同利用者が更新しました」と表示します。

## 12. 共有解除、退出、削除

### 共同利用者の解除

- ownerだけが実行できる
- membershipを即時revokedにする
- 以後のAPIはすべて拒否する
- 既存セッションを維持していてもmembershipを毎回再確認する
- 新しい共有パスワードとkeyEpochへの更新が完了するまで、新規保存を停止する

### editorの退出

- 自分のmembershipだけをleftにする
- 退出後の新しいデータへアクセスできない
- 退出前に本人が保存したコピーを遠隔削除できないことを画面で説明する

### ownerのアカウント削除

ownerが共同利用者を残したままアカウント削除する場合は、次のどちらかを明示的に選びます。

- ownerを共同利用者へ移行する
- 共同世帯と暗号化データを削除する

契約状態は別管理のため、所有権移行だけで課金契約を移行しません。

### 世帯削除

- 最近のGoogleログインを要求する
- 画面で世帯名と確認文言を入力する
- R2の全リビジョンを削除する
- D1の共有メタ情報を削除または削除済みにする
- 失敗時は再試行可能な状態を残す

## 13. Pro権限

- 世帯ownerの有効なPro契約を基準にする
- editor自身の契約は初期版では不要
- owner以外が世帯をProへ変更できない
- 契約失効時は招待と保存を停止する
- 読み取り、JSONエクスポート、世帯削除を直ちに塞がない

契約失効後は、契約期間終了日から90日間を閲覧・JSONエクスポート・削除だけが可能な期間とします。新規保存、招待、復元による更新は停止します。90日経過後は暗号化された共同プラン本体と版管理情報を削除します。

この保持期間は料金ページ、解約・返金方針、プライバシーポリシー、アプリ内表示へ同じ内容を反映するまで運用開始しません。

## 14. 既知の限界

- 復号中にXSSや悪意ある拡張機能が動作すると、平文が読まれる可能性がある
- 正当に閲覧した共同利用者が保存したコピーを、共有解除後に消すことはできない
- 共有パスワードを忘れた場合、運営者は復旧できない
- 初期版は同時編集を自動マージしない
- 共有パスワードを安全に伝える責任は利用者にもある

これらは利用開始前の説明とプライバシーポリシーに明記します。

## 15. 実装段階

### 第2段階: D1とWorkerの非公開基盤

- [x] 新規テーブルのマイグレーション
- [x] `HOUSEHOLD_SHARING_MODE=disabled`を既定値にする
- [x] membershipと招待のAPI
- [x] 契約者本人のProと共同世帯内だけのProを分離する
- [x] 異なる利用者、期限切れ、二重受諾、人数上限のテスト
- [x] 解除後の即時アクセス拒否と鍵世代更新
- [ ] リモートD1へのマイグレーション適用
- [ ] Cloudflare Secret `HOUSEHOLD_INVITE_PEPPER`の設定

### 第3段階: 共同プラン暗号化

- 共有暗号化形式v1
- 世帯ID、revision、keyEpochをAADへ含める
- 誤パスワード、改ざん、別世帯差し替えのテスト
- R2保存、取得、版管理、競合検知

### 第4段階: 運営者限定UI

- 世帯作成、招待、受諾
- 共有へ保存、共有から取得
- 更新者、更新日時、revision
- 共有解除、退出、世帯削除

### 第5段階: セキュリティ検証

- 他利用者、他世帯の全API否定テスト
- 招待総当たり、再利用、メール不一致
- 解除直後、アカウント削除、契約失効
- R2、D1の部分失敗と孤立データ回収
- CSP、ログ、Rate Limiting、サイズ上限
- PC、スマホE2E

### 第6段階: 本番有効化

- 法務ページとアプリ内説明の更新
- 保持期間の確定
- 運営者テスト
- バックアップと復旧手順の確認
- `preview`から`enforced`へ切替

## 16. 第1段階の完了条件

- 平文、鍵、認証、D1、R2の境界が明文化されている
- 計画上の世帯メンバーとログイン利用者を分離している
- ownerとeditorの権限表がある
- 招待、保存、競合、解除、削除の安全条件がある
- 未決定事項がある間は本番公開しない条件がある
- 次段階で追加するD1テーブルとAPIが定義されている

## 17. 現在実装されている非公開API

```text
GET    /api/shared-household
POST   /api/shared-household
DELETE /api/shared-household
POST   /api/shared-household/invitations
DELETE /api/shared-household/invitations/:id
POST   /api/shared-household/invitations/accept
DELETE /api/shared-household/members/:userId
POST   /api/shared-household/leave
```

現在は次の安全策を実装しています。

- 招待先はGoogle確認済みメールとHMACで照合する
- D1には招待メールの平文と招待トークンの平文を保存しない
- 招待トークンは256ビットのWeb Crypto乱数を使い、24時間、1回限りとする
- 招待URLはURLフラグメントにトークンを置き、通常のHTTPアクセスログへ送らない
- owner 1人、editor 1人、1アカウント1世帯をD1制約とWorkerの両方で制限する
- 状態変更は同一Origin、Googleログイン、操作別権限、本文サイズ上限を確認する
- ownerの契約状態をサーバーで再確認し、editorへは共同世帯内だけのPro権限を返す
- editorの解除または退出後はmembershipを即時無効化し、世帯を読取専用にして鍵世代を進める

共同プラン本文を保存するAPIとUIはまだ存在しません。`HOUSEHOLD_SHARING_MODE`を有効にしても、暗号化共同プラン保存まで完成したことにはなりません。

## 18. 非公開基盤の設定

リモート環境へ進める場合は、先にマイグレーションを適用し、その後で招待メールHMAC専用のSecretを設定します。Secretは他用途と共有せず、32バイト以上の暗号学的乱数から作成します。

```powershell
cd "C:\Users\rengo\Documents\Life Compass"
npx.cmd wrangler d1 migrations apply life-compass-auth --remote
npx.cmd wrangler secret put HOUSEHOLD_INVITE_PEPPER
```

この段階では`HOUSEHOLD_SHARING_MODE`を`disabled`のまま維持します。運営者限定テストを始めるときだけCloudflareの変数を`preview`へ変更します。
