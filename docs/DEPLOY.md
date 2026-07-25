# Life Compass デプロイ手順

## ローカル確認

```powershell
cd "C:\Users\rengo\Documents\Life Compass"
npm.cmd run build
npm.cmd run test:logic
```

## 通常の公開手順

Codex環境で作った `.git` はWindowsユーザーと所有者が異なる場合があります。
そのため、このプロジェクトでは公開用の補助スクリプトを使います。

```powershell
cd "C:\Users\rengo\Documents\Life Compass"
powershell -ExecutionPolicy Bypass -File ".\scripts\publish-main.ps1" -Message "Update Life Compass"
```

このスクリプトは以下を行います。

- `.deploy-push` をGitHubの `main` と同期
- 変更されたファイルと新規ファイルを自動検出
- `.deploy-push` へ反映
- `npm.cmd run test:logic`
- `npm.cmd run build`
- コミットと `git push origin main`

Cloudflare Pages はGitHubの `main` 更新を検知して自動デプロイします。

## 初回セットアップ時のGitHub + Cloudflare Pages

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

## 将来の推奨整理

所有者違いによる `dubious ownership` を根本的に避けるには、通常のPowerShellでユーザー所有の作業フォルダを作り直すのが最も安全です。

```powershell
cd "C:\Users\rengo\Documents"
git clone https://github.com/Tomo198/life-compass.git "Life Compass Clean"
```

その後、作業場所を `Life Compass Clean` に移せば、通常の `git add`、`git commit`、`git push` に戻せます。
ただし、現在の `.deploy-push` 方式でも公開作業は継続できます。

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

- 標準の入力データはユーザーのブラウザ内に保存されます。
- JSONエクスポート・インポートは無料版でも利用できます。
- 利用者が明示的に有効化した場合だけ、暗号化クラウドバックアップまたは共同世帯の暗号化自動同期を利用します。
- Cloudflare側には暗号化済みデータと必要最小限のメタ情報だけを保存し、家計・資産・家族情報を平文保存しません。
- 端末変更、ブラウザ変更、閲覧データ削除の前にはJSONエクスポートまたは暗号化バックアップを確認します。
