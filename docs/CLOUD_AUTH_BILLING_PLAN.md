# Life Compass ログイン・課金・クラウド保存 設計方針

この文書は、Googleログイン、Stripe課金、Cloudflare上のクラウドバックアップを導入する場合の設計メモです。実装前提を整理するためのもので、現時点ではクラウド保存や課金は提供していません。

## 基本方針

- 初期コストを抑えるため、まずCloudflare無料枠で検証する
- Pro利用者が増え、無料枠の制限や運用リスクが見えてからCloudflare有料プランを検討する
- ライフプラン本体の標準保存先はブラウザ内のままにする
- クラウド保存は、Pro向けの任意バックアップ機能として扱う
- 収入、支出、資産、家族情報などをサーバー側で平文保存しない設計を優先する

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
- D1: ユーザー、契約状態、バックアップメタ情報
- R2: 暗号化済みバックアップJSON
- KV: 短期キャッシュ、機能フラグ、非重要な一時情報
- Secrets: Stripe、Google、署名検証用の秘密値

## Googleログイン

- Googleログインは本人確認とアカウント紐づけに使う
- ユーザーIDはメールではなくGoogle IDトークンの `sub` を使う
- メールアドレスは連絡、表示、Stripe顧客作成の補助情報として扱う
- ログインしただけでライフプラン本文をサーバー保存しない

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

## 導入順序

1. 画面上の説明と法務文言を整える
2. Workers APIの空実装とD1スキーマを作る
3. Googleログインを導入する
4. Stripe test modeでCheckoutとwebhookを確認する
5. Pro権限チェックを本番仕様へ切り替える
6. 暗号化クラウドバックアップを任意機能として追加する

## 今は実装しないこと

- 決済情報の自前保存
- ライフプラン本文の平文クラウド保存
- 自動同期を前提にしたデータ上書き
- Googleログイン必須化
- Cloudflare有料プラン前提の運用
