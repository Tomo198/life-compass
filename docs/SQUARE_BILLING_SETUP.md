# Square継続課金の設定手順

この手順は、Life CompassのPro契約をSquareの月額継続課金と連携するためのものです。設定とテストが完了するまで料金画面は`Coming soon`のままにし、公開環境は`ACCESS_MODE=enforced`で一般利用者を無料版として扱います。運営者本人だけは`OWNER_GOOGLE_SUB`により課金なしでPro機能をテストできます。

## 1. 現在の安全な状態

- Squareの設定が不足している場合、課金APIは安全に拒否します。
- Pro権限は、契約が有効で、支払い成功が確認され、支払済み期間内の場合だけ付与します。
- Google確認済みメールとSquare顧客メールが一致する契約だけを紐づけます。
- カード番号、セキュリティコード、Webhook本文はD1やログへ保存しません。
- ライフプラン本文は決済処理へ送信しません。

## 2. Squareで確認する値

Square Developer ConsoleとSquare管理画面で、次の値を確認します。

| 値 | 用途 | 取り扱い |
| --- | --- | --- |
| Production access token | Square顧客・契約の照会 | Cloudflare Secret |
| Webhook signature key | Webhook署名検証 | Cloudflare Secret |
| Merchant ID | 自分の加盟店からの通知だけを許可 | Cloudflare変数 |
| Subscription plan variation ID | Life Compass Proの契約だけを許可 | Cloudflare変数 |
| Payment link URL | ログイン後の購入導線 | Cloudflare変数 |

アクセストークンと署名キーは、この文書、GitHub、チャット、スクリーンショットへ貼り付けません。

## 3. Webhookの作成

Square Developer Consoleで本番用アプリを開き、Webhook通知先を次のURLで作成します。

```text
https://life.raotomo.com/api/billing/square/webhook
```

購読するイベント:

- `subscription.created`
- `subscription.updated`
- `invoice.payment_made`
- `invoice.scheduled_charge_failed`

Squareへ登録した通知URLと`SQUARE_WEBHOOK_NOTIFICATION_URL`は、文字列として完全に一致させます。

## 4. D1マイグレーション

PowerShellでプロジェクトへ移動し、適用予定を確認してから本番D1へ適用します。

```powershell
cd "C:\Users\rengo\Documents\Life Compass"
npx.cmd wrangler d1 migrations list life-compass-auth --remote
npx.cmd wrangler d1 migrations apply life-compass-auth --remote
```

`0004_provider_neutral_billing.sql`が適用対象です。既存の利用者、セッション、暗号化バックアップは削除しません。

## 5. Cloudflare Secrets

PowerShellで1項目ずつ実行し、表示された入力欄へ値を貼り付けます。値はコマンド行へ直接書きません。

```powershell
cd "C:\Users\rengo\Documents\Life Compass"
npx.cmd wrangler secret put SQUARE_ACCESS_TOKEN
npx.cmd wrangler secret put SQUARE_WEBHOOK_SIGNATURE_KEY
```

## 6. Cloudflare変数

次の値をCloudflare Workersの「設定 > 変数とシークレット」へ追加します。

| 変数 | 値の例 |
| --- | --- |
| `SQUARE_ENVIRONMENT` | `production` |
| `SQUARE_WEBHOOK_NOTIFICATION_URL` | `https://life.raotomo.com/api/billing/square/webhook` |
| `SQUARE_MERCHANT_ID` | Squareが発行したMerchant ID |
| `SQUARE_PLAN_VARIATION_ID` | 月額590円プランのvariation ID |
| `SQUARE_PAYMENT_LINK_URL` | Squareが発行した`https://square.link/...` |

`SQUARE_API_VERSION`は通常設定不要です。コード側で検証済みのバージョンへ固定しています。

## 7. 公開前テスト

1. `ACCESS_MODE=enforced`のままデプロイする
2. Googleログインできることを確認する
3. Googleログインと同じメールアドレスをSquare決済でも使用する
4. SquareのWebhookログで署名検証済みの`200`応答を確認する
5. 初回決済前はPro契約として扱われないことを確認する
6. `invoice.payment_made`後にPro権限が反映されることを確認する
7. 解約予約後も支払済み期限まではProとして扱われることを確認する
8. 支払い失敗時にPro権限が停止することを確認する
9. 同じWebhookを再送しても二重処理されないことを確認する

## 8. 本番開放

すべてのテスト、料金表示、利用規約、特定商取引法表記、解約・返金方針が一致した後に課金導線を一般公開します。`ACCESS_MODE=enforced`は変更しません。暗号化クラウドバックアップの一般開放は、別途`CLOUD_BACKUP_MODE=enforced`へ変更します。

問題が起きた場合も`ACCESS_MODE=enforced`を維持して無料版へ閉じます。Squareの契約を勝手に削除せず、WebhookログとD1の契約状態を確認してから対応します。
