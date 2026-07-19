# R2暗号化バックアップ設定手順

この手順は、Life Compassの暗号化クラウドバックアップを運営者本人だけで限定テストするためのものです。Squareの契約判定が完成するまで一般利用者へ開放しません。

## 安全な作業順序

1. クラウドバックアップが無効な状態で、実装とテストをコミットする
2. 非公開R2バケットを作る
3. `BACKUPS` Bindingをコードへ追加してデプロイする
4. D1マイグレーションを本番へ適用する
5. 最後にSecretで限定テストを有効にする

`CLOUD_BACKUP_MODE` が未設定または `disabled` の間、Workerはバックアップの保存を拒否します。R2やD1を接続しただけでは保存を開始しません。

## 1. 実装を安全な無効状態で公開する

PowerShellで次を実行します。

```powershell
cd "C:\Users\rengo\Documents\Life Compass"
npm.cmd run test:logic
npm.cmd run test:worker-api
npm.cmd run build
git status
git add .
git commit -m "Add encrypted cloud backup foundation"
git push origin main
```

この時点ではR2 Bindingと有効化Secretがないため、公開画面は「準備中」のままです。

## 2. 非公開R2バケットを作る

### Cloudflare画面から作る場合

1. Cloudflare Dashboardへログインする
2. `R2 Object Storage` を開く
3. `Create bucket` を選ぶ
4. Bucket nameに `life-compass-backups` を入力する
5. LocationはAsia-Pacific、Storage classはStandardを選ぶ
6. 作成後、バケットの`Settings`を開く
7. `Public Development URL`が無効、`Custom Domains`が未設定であることを確認する

### PowerShellから作る場合

```powershell
cd "C:\Users\rengo\Documents\Life Compass"
npx.cmd wrangler r2 bucket create life-compass-backups --location apac
npx.cmd wrangler r2 bucket list
```

バケットにはPublic Development URLやカスタムドメインを設定しません。Worker Bindingからだけアクセスします。

## 3. WranglerへR2 Bindingを追加する

バケット作成後、`wrangler.jsonc`へ次を追加します。

```jsonc
"r2_buckets": [
  {
    "binding": "BACKUPS",
    "bucket_name": "life-compass-backups"
  }
]
```

追加後に構成を確認します。

```powershell
npx.cmd wrangler deploy --dry-run
```

問題がなければBindingの変更をコミット・プッシュします。この段階でも`CLOUD_BACKUP_MODE`が未設定なら保存は無効です。

## 4. D1マイグレーションを適用する

最初に未適用ファイルを確認します。

```powershell
npx.cmd wrangler d1 migrations list life-compass-auth --remote
```

`0003_cloud_backup_encryption_version.sql`だけが未適用であることを確認してから実行します。`0001`や`0002`まで未適用と表示された場合は、その場で中止して状況を確認します。

```powershell
npx.cmd wrangler d1 migrations apply life-compass-auth --remote
npx.cmd wrangler d1 migrations list life-compass-auth --remote
```

## 5. 運営者本人だけ限定テストを有効にする

コード、R2 Binding、D1の準備がすべて終わってから設定します。

1. Cloudflare Dashboardで`Workers & Pages`を開く
2. `life-compass` Workerを選ぶ
3. `Settings`から`Variables and Secrets`を開く
4. Secret `CLOUD_BACKUP_MODE`を追加し、値を`preview`にする
5. Secret `OWNER_GOOGLE_SUB`へ、運営者Googleアカウントの固定識別子を登録する
6. 変更をデプロイする

`OWNER_GOOGLE_SUB`はD1の`users.google_sub`で確認します。メールアドレスと違って変更されないGoogleアカウント識別子で、運営者本人の1件だけを登録します。値はリポジトリ、通常の環境変数、チャットへ記載しません。

PowerShellでも設定できますが、`wrangler secret put`は新しいWorker版を作成してデプロイします。必ず手順4まで完了してから実行します。

```powershell
npx.cmd wrangler secret put CLOUD_BACKUP_MODE
# 入力値: preview

npx.cmd wrangler secret put OWNER_GOOGLE_SUB
# 入力値: D1で確認した運営者本人のgoogle_sub
```

## 6. 限定テスト

1. JSONエクスポートで現在のプランを手元へ退避する
2. `OWNER_GOOGLE_SUB`に登録したGoogleアカウントでログインする
3. データ管理画面で12文字以上の復旧パスワードを設定する
4. 暗号化バックアップを1件保存する
5. R2内のオブジェクトが`users/{利用者ID}/backups/{バックアップID}.json`になっていることを確認する
6. R2内に目標名、収入、支出などの平文が含まれないことを確認する
7. 画面上の値を一つ変更し、バックアップから復元できることを確認する
8. 間違った復旧パスワードでは復元できないことを確認する
9. バックアップを削除し、画面一覧とR2の両方から消えることを確認する
10. 運営者以外のアカウントでは利用できないことを確認する

復旧パスワードはLife Compassへ送信されません。忘れた場合は運営者も復元できないため、Googleパスワードとは別にパスワード管理アプリなどへ保管します。

## 7. D1メタ情報の確認

D1には暗号化本文を保存せず、所有者、サイズ、バージョン、日時などだけを保存します。

```powershell
npx.cmd wrangler d1 execute life-compass-auth --remote --command "SELECT id, user_id, plan_version, encryption_version, size_bytes, created_at FROM cloud_backups ORDER BY created_at DESC LIMIT 5;"
```

## 8. テスト後の状態

運営者本人だけ継続利用する場合は`preview`と`OWNER_GOOGLE_SUB`を維持します。いったん停止する場合は`CLOUD_BACKUP_MODE`を`disabled`へ変更します。

Square webhookとD1の契約判定が完成するまで`enforced`へ変更しません。完成後に`CLOUD_BACKUP_MODE`を`enforced`へ変更すると、新しいバックアップの保存はD1上で支払い確認済みの有効なPro契約を持つ利用者だけが行えます。保存済みデータの一覧・復元・削除は、契約終了後もログイン済み本人が行えます。

## セキュリティ上の禁止事項

- R2のPublic Development URLを有効にしない
- R2へカスタムドメインを設定しない
- Google固定識別子や復旧パスワードを`wrangler.jsonc`へ書かない
- 復旧パスワードをログへ出さない
- `CLOUD_BACKUP_MODE=enforced`をSquare契約判定完成前に設定しない
- 本番D1へ手動SQLを直接追加せず、マイグレーションで管理する
