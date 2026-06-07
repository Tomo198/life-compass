# Life Compass デプロイ手順

## ローカル確認

```powershell
cd "C:\Users\rengo\Documents\Life Compass"
npm.cmd run build
npm.cmd run test:logic
```

## GitHub + Cloudflare Pages

1. GitHubで `life-compass` リポジトリを作成します。
2. PowerShellで以下を実行します。

```powershell
cd "C:\Users\rengo\Documents\Life Compass"
git status
git add .
git commit -m "Initial Life Compass MVP"
git branch -M main
git remote add origin https://github.com/Tomo198/life-compass.git
git push -u origin main
```

3. Cloudflare Pagesで `Create a project` を選び、GitHubの `life-compass` リポジトリを接続します。
4. ビルド設定は以下にします。

```text
Framework preset: Vite
Build command: npm run build
Build output directory: dist
Root directory: /
```

5. デプロイが完了すると `https://life-compass.pages.dev` のようなURLが発行されます。

## Cloudflare Pages Direct Upload

GitHub連携を使わずに直接アップロードする場合は、Cloudflare APIトークンが必要です。

```powershell
cd "C:\Users\rengo\Documents\Life Compass"
$env:CLOUDFLARE_API_TOKEN="取得したAPIトークン"
$env:XDG_CONFIG_HOME="C:\Users\rengo\Documents\Life Compass\.wrangler"
npx.cmd --cache .npm-cache wrangler pages deploy dist --project-name life-compass
```

Codex環境ではAPIトークンが未設定だと直接デプロイできません。通常運用はGitHub + Cloudflare Pages連携の方が簡単です。

## 公開時の保存方針

- 入力データはCloudflare側には保存されません。
- データはユーザーのブラウザ内に保存されます。
- 端末変更、ブラウザ変更、閲覧データ削除の前にはJSONエクスポートが必要です。
