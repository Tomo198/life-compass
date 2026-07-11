# Googleログイン・D1設定手順

この手順は、Life CompassのGoogleログインを本番で有効にするための管理画面設定です。コードは設定が不足している場合にログインを拒否し、無料版はログインなしで利用できます。

## 保存する情報

D1へ保存するのは次の情報だけです。

- Googleの安定した利用者識別子 `sub`
- メールアドレスとGoogle上の確認状態
- Life Compass内部の利用者ID
- ハッシュ化したログインセッションと有効期限
- 将来のStripe契約状態

収入、支出、資産、家族、目標、イベント、メモ、JSONバックアップ本文は保存しません。

## 1. Google CloudでOAuthクライアントを作る

1. Google Cloud ConsoleでLife Compass専用プロジェクトを作成します。
2. Google Auth Platformのブランディングを設定します。
3. アプリ名を `Life Compass` にします。
4. サポートメールを設定します。
5. ホームページを `https://life.raotomo.com/` にします。
6. プライバシーポリシーを `https://life.raotomo.com/privacy` にします。
7. 利用規約を `https://life.raotomo.com/terms` にします。
8. データアクセスは標準の `openid`、`email`、`profile` だけにし、追加のGoogle API権限は要求しません。
9. 種類が「ウェブアプリケーション」のOAuthクライアントを作成します。
10. 承認済みJavaScript生成元へ次を登録します。
   - `https://life.raotomo.com`
   - `https://life-compass.tomo198.workers.dev`
   - ローカル確認時だけ `http://localhost:8787`

JavaScriptコールバック方式を使うため、リダイレクトURIは使用しません。

## 2. Cloudflare D1を作る

PowerShellでプロジェクトフォルダへ移動し、次を実行します。

```powershell
cd "C:\Users\rengo\Documents\Life Compass"
npx.cmd wrangler d1 create life-compass-auth
```

表示された `database_id` を `wrangler.jsonc` のD1バインディングへ設定します。バインディング名は必ず `DB` にします。

```json
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "life-compass-auth",
    "database_id": "Cloudflareが発行したID",
    "migrations_dir": "migrations"
  }
]
```

マイグレーションを適用します。

```powershell
npx.cmd wrangler d1 migrations apply life-compass-auth --remote
```

## 3. Workerの環境変数を設定する

`GOOGLE_CLIENT_ID` はGoogleが発行したウェブクライアントIDです。ブラウザへ公開される識別子であり秘密鍵ではありません。`ACCESS_MODE` はStripe導入まで `preview` のままにします。

```json
"vars": {
  "GOOGLE_CLIENT_ID": "発行されたクライアントID.apps.googleusercontent.com",
  "ACCESS_MODE": "preview"
}
```

Googleクライアントシークレットは、このログイン方式では使用しません。リポジトリやVite環境変数へ登録しないでください。

## 4. デプロイ前確認

```powershell
npm.cmd run test:worker-api
npm.cmd run test:logic
npm.cmd run test:e2e
npm.cmd run build
npx.cmd wrangler deploy --dry-run
```

デプロイ後、次を確認します。

- `/api/auth/config` が `configured: true` を返す
- 設定画面にGoogle公式ログインボタンが表示される
- ログイン後に `/api/me` が最小限の利用者情報だけを返す
- ログアウト後に同じセッションで `/api/me` が未ログインになる
- ログアウト後にGoogleログインボタンが再表示される
- 設定画面からアカウント情報を削除してもブラウザ内データは残る
- Cloudflare Cronが期限切れ・失効済みセッションを削除する
- ログインしてもブラウザ内のライフプラン本文がD1へ保存されない

## 本番化しない条件

次のいずれかが残る場合は、Googleログインを本番有効化しません。

- Googleの承認済み生成元が実際のドメインと一致しない
- D1マイグレーションが未適用
- Cloudflare、Google、GitHubの多要素認証が未設定
- Cookieに本番HTTPSで `__Host-` 接頭辞、`HttpOnly`、`Secure`、`SameSite` が付かない
- 認証APIテストまたはブラウザ確認が失敗する
