# Life Compass ログイン・課金・クラウド保存 設計方針

この文書は、Googleログイン、Stripe課金、Cloudflare上のクラウドバックアップを導入する場合の設計メモです。実装前提を整理するためのもので、現時点ではクラウド保存や課金は提供していません。

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
| 課金情報 | Stripe顧客ID、契約ID、契約状態、更新期限 | D1 | Stripe webhookを正として同期 |
| ライフプラン本文 | 収入、支出、資産、家族、目標、イベント | ブラウザ内、将来R2 | クラウド保存時は暗号化済みJSONのみ |
| 保存メタ情報 | バックアップID、更新日時、サイズ、バージョン | D1 | 一覧表示と復元のため |
| 秘密情報 | Stripe秘密鍵、webhook署名シークレット、Google設定 | Cloudflare Secrets | リポジトリには保存しない |

## Cloudflare構成案

- Workers: API、Googleログイン検証、Stripe webhook、権限チェック
- D1: ユーザー、契約状態、セッション、バックアップメタ情報
- R2: 暗号化済みバックアップJSON
- KV: 短期キャッシュ、機能フラグ、非重要な一時情報
- Secrets: Stripe、Google、署名検証用の秘密値

## Googleログイン

- Googleログインは本人確認とアカウント紐づけに使う
- ユーザーIDはメールではなくGoogle IDトークンの `sub` を使う
- メールアドレスは連絡、表示、Stripe顧客作成の補助情報として扱う
- ログインしただけでライフプラン本文をサーバー保存しない
- 実装と管理画面設定の手順は `docs/GOOGLE_LOGIN_SETUP.md` を使う
- セッションCookieの生値はD1へ保存せず、SHA-256ハッシュだけを保存する
- 利用者は設定画面からD1上のアカウント情報を削除できる
- 期限切れ・失効済みセッションはCloudflare Cronで毎日削除する
- 課金開始前は `ACCESS_MODE=preview` を維持する

## Stripe課金

- Checkoutで申込み、Customer Portalで解約・支払い方法変更を行う
- Pro判定はStripe webhookでD1へ反映する
- アプリ起動時はWorkers APIから現在の権限を取得する
- webhookで最低限扱うイベント:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_failed`

## クラウドバックアップ

- 利用者が明示的に有効化した場合だけ使う
- ローカル保存とJSONエクスポートは無料版にも残す
- バックアップは暗号化済みJSONとして保存する
- サーバー側ではバックアップ内容を読めない前提にする
- 復元用パスワードや復元キーを忘れた場合、運営者は復元できない可能性があることを明示する
- 暗号化仕様と脅威モデルは `docs/CLOUD_BACKUP_THREAT_MODEL.md` を基準にする
- `CLOUD_BACKUP_MODE` は初期値 `disabled`、限定テストは `preview`、Stripe接続後は `enforced` とする
- `preview` は `CLOUD_BACKUP_TEST_USERS` に登録した利用者だけを許可する

## 導入順序

1. 画面上の説明と法務文言を整える
2. Workers APIの空実装とD1スキーマを作る
3. Googleログインを導入する
4. Stripe test modeでCheckoutとwebhookを確認する
5. Pro権限チェックを本番仕様へ切り替える
6. 暗号化クラウドバックアップを任意機能として追加する

## 現在用意しているAPI骨組み

認証APIのコードは実装済みですが、GoogleクライアントIDとD1バインディングを設定するまではログインを拒否します。Stripe、R2への実接続はまだ行いません。

| API | 現在の挙動 | 将来の用途 |
| --- | --- | --- |
| `GET /api/health` | API骨組みの稼働確認 | 監視、疎通確認 |
| `GET /api/me` | CookieとD1からログイン状態を確認 | Googleログイン後のユーザー確認 |
| `GET /api/entitlement` | D1契約状態を確認、初期値はfree / preview | Pro契約状態の判定 |
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
| `POST /api/stripe/webhook` | 未設定として拒否 | Stripe webhook受信 |

## D1スキーマ

初期スキーマは `migrations/0001_auth_billing_backup.sql`、セッションは `migrations/0002_auth_sessions.sql`、暗号化形式バージョンは `migrations/0003_cloud_backup_encryption_version.sql` に置きます。

主なテーブル:

- `users`: Googleログイン後の最小アカウント情報
- `subscriptions`: Stripe契約状態とPro判定
- `cloud_backups`: R2に置く暗号化バックアップのメタ情報
- `webhook_events`: Stripe webhookの二重処理防止
- `sessions`: ハッシュ化セッション、有効期限、失効日時

## 今は実装しないこと

- 決済情報の自前保存
- ライフプラン本文の平文クラウド保存
- Google Driveへのライフプラン保存
- 自動同期を前提にしたデータ上書き
- Googleログイン必須化
- Cloudflare有料プラン前提の運用
