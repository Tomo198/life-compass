# Life Compass ログイン・課金・クラウド保存 設計方針

この文書は、Googleログイン、Square課金、Cloudflare上の暗号化クラウドバックアップの設計メモです。課金は本番設定と確認が終わるまで公開しません。

## 基本方針

- 初期コストを抑えるため、まずCloudflare無料枠で検証する
- Pro利用者が増え、無料枠の制限や運用リスクが見えてからCloudflare有料プランを検討する
- ライフプラン本体の標準保存先はブラウザ内のままにする
- クラウド保存は、Pro向けの任意バックアップ機能として扱う
- 収入、支出、資産、家族情報などをサーバー側で平文保存しない設計を優先する
- 実装前後の安全確認は `docs/SECURITY_CHECKLIST.md` を基準にする

## 保存する情報の分類

| 分類 | 例 | 保存先候補 | 方針 |
| --- | --- | --- | --- |
| アカウント情報 | Googleの利用者識別子、メール、作成日時 | D1 | 本人確認と問い合わせ対応に必要な最小限 |
| 課金情報 | Square顧客ID、契約ID、契約・支払い状態、更新期限 | D1 | Square webhookを正として同期 |
| ライフプラン本文 | 収入、支出、資産、家族、目標、イベント | ブラウザ内、将来R2 | クラウド保存時は暗号化済みJSONのみ |
| 保存メタ情報 | バックアップID、更新日時、サイズ、バージョン | D1 | 一覧表示と復元のため |
| 秘密情報 | Squareアクセストークン、webhook署名キー、Google設定 | Cloudflare Secrets | リポジトリには保存しない |

## Cloudflare構成案

- Workers: API、Googleログイン検証、Square webhook、権限チェック
- D1: ユーザー、契約状態、セッション、バックアップメタ情報
- R2: 暗号化済みバックアップJSON
- KV: 短期キャッシュ、機能フラグ、非重要な一時情報
- Secrets: Square、Google、署名検証用の秘密値

## Googleログイン

- Googleログインは本人確認とアカウント紐づけに使う
- ユーザーIDはメールではなくGoogle IDトークンの `sub` を使う
- メールアドレスは連絡、表示、Square顧客との照合に使う
- ログインしただけでライフプラン本文をサーバー保存しない
- 実装と管理画面設定の手順は `docs/GOOGLE_LOGIN_SETUP.md` を使う
- セッションCookieの生値はD1へ保存せず、SHA-256ハッシュだけを保存する
- 利用者は設定画面からD1上のアカウント情報を削除できる
- 期限切れ・失効済みセッションはCloudflare Cronで毎日削除する
- 公開環境は課金開始前から `ACCESS_MODE=enforced` とし、一般利用者は無料版として扱う
- 運営者本人はGoogleの固定識別子 `sub` を `OWNER_GOOGLE_SUB` Secretへ1度だけ登録し、課金なしでPro機能をテストする

## Square課金

- Squareの継続課金リンクで申込み、Square側の契約管理機能で解約・支払い方法変更を行う
- Pro判定はSquare webhookでD1へ反映する
- アプリ起動時はWorkers APIから現在の権限を取得する
- webhookで最低限扱うイベント:
  - `subscription.created`
  - `subscription.updated`
  - `invoice.payment_made`
  - `invoice.scheduled_charge_failed`
- `ACTIVE`だけではProを開放せず、初回を含む支払い成功を確認する
- Google確認済みメールとSquare顧客メールが一致した契約だけを利用者へ紐づける

## クラウドバックアップ

- 利用者が明示的に有効化した場合だけ使う
- ローカル保存とJSONエクスポートは無料版にも残す
- バックアップは暗号化済みJSONとして保存する
- サーバー側ではバックアップ内容を読めない前提にする
- 復元用パスワードや復元キーを忘れた場合、運営者は復元できない可能性があることを明示する
- 暗号化仕様と脅威モデルは `docs/CLOUD_BACKUP_THREAT_MODEL.md` を基準にする
- `CLOUD_BACKUP_MODE` は初期値 `disabled`、運営者テストは `preview`、Square契約同期の確認後は `enforced` とする
- `preview` は `OWNER_GOOGLE_SUB` と一致する運営者本人だけを許可する
- `enforced` では新しいバックアップの保存だけを有効なPro契約に限定する
- 契約終了後も、ログイン済み本人は自分の保存済みバックアップを一覧・復元・削除できる

## 導入順序

1. 画面上の説明と法務文言を整える
2. Workers APIの空実装とD1スキーマを作る
3. Googleログインを導入する
4. Square Sandboxで継続課金とwebhookを確認する
5. Pro権限チェックを本番仕様へ切り替える
6. 暗号化クラウドバックアップを任意機能として追加する

## 現在用意しているAPI骨組み

認証APIと暗号化R2バックアップは実装済みです。Square課金APIは必要なSecretsとD1マイグレーションが揃うまで安全に拒否します。

| API | 現在の挙動 | 将来の用途 |
| --- | --- | --- |
| `GET /api/health` | API骨組みの稼働確認 | 監視、疎通確認 |
| `GET /api/me` | CookieとD1からログイン状態を確認 | Googleログイン後のユーザー確認 |
| `GET /api/entitlement` | D1契約状態と運営者IDを確認、初期値はfree / enforced | Pro契約状態の判定 |
| `GET /api/billing/config` | Square設定状態だけを公開 | 購入導線の有効判定 |
| `POST /api/billing/checkout` | 確認済みGoogleログインと同一オリジンを検証 | Square継続課金リンクの取得 |
| `POST /api/billing/square/webhook` | HMAC署名・加盟店・イベント重複を検証 | Square契約と支払い状態の同期 |
| `GET /api/backups` | R2未設定時は利用不可、設定後は本人分だけ一覧 | 暗号化バックアップ一覧 |
| `POST /api/backups` | ログイン・利用権・形式・件数・サイズを検証 | 暗号化バックアップ保存 |
| `GET /api/backups/:id` | 所有者照合とチェックサム検証 | 暗号化バックアップ取得 |
| `DELETE /api/backups/:id` | R2削除後にD1メタ情報を削除 | 暗号化バックアップ削除 |
| `POST /api/auth/google` | Google・D1設定後にIDトークン検証 | Google IDトークン検証 |
| `GET /api/auth/config` | Google・D1設定状態 | Google公式ボタンの初期化 |
| `GET /api/auth/nonce` | 10分有効のnonce発行 | CSRF・リプレイ対策 |
| `POST /api/auth/logout` | セッション失効 | ログアウト |
| `POST /api/auth/logout-all` | 本人の全セッションを失効 | 全端末ログアウト |
| `DELETE /api/account` | D1上の利用者情報と関連セッションを削除 | アカウント削除 |

## D1スキーマ

初期スキーマは `migrations/0001_auth_billing_backup.sql`、セッションは `migrations/0002_auth_sessions.sql`、暗号化形式バージョンは `migrations/0003_cloud_backup_encryption_version.sql`、決済事業者共通列は `migrations/0004_provider_neutral_billing.sql`、世帯共有は `migrations/0005_household_sharing_foundation.sql`、共有保存の削除再試行管理は `migrations/0006_shared_plan_cleanup.sql` に置きます。

主なテーブル:

- `users`: Googleログイン後の最小アカウント情報
- `subscriptions`: Squareを含む決済事業者共通の契約・支払い状態とPro判定
- `cloud_backups`: R2に置く暗号化バックアップのメタ情報
- `billing_webhook_events`: Square webhookの二重処理防止。本文やカード情報は保存しない
- `sessions`: ハッシュ化セッション、有効期限、失効日時

## 今は実装しないこと

- 決済情報の自前保存
- ライフプラン本文の平文クラウド保存
- Google Driveへのライフプラン保存
- 自動同期を前提にしたデータ上書き
- Googleログイン必須化
- Cloudflare有料プラン前提の運用
