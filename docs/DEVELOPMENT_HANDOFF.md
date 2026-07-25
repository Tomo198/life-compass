# Life Compass 開発引き継ぎ

更新日: 2026-07-26  
機能チェックポイント: `a6528ee Add trusted-device household auto sync`

## 1. この文書の目的

長期化した開発タスクから新しいタスクへ移る際の基準文書です。新しいタスクでは、過去の会話よりも、現在のコード、テスト、この文書、関連設計文書を優先してください。

## 2. 製品の位置づけ

Life Compassは、家計、仕事、住まい、家族、目標、ライフイベントを整理し、人生設計を作成・保存・見直し・比較する個人向けライフプランナーです。

- 主軸は投資ではなく、ライフプラン管理と複数案の比較
- 表示結果は入力条件に基づく参考試算
- 個別の金融商品、銘柄、保険商品を推奨しない
- 投資、税務、法律、保険の個別助言を行わない
- 無料版だけでも継続利用できる価値を残す
- Proは見直し、比較、詳細試算、暗号化保存、世帯共有を中心にする

## 3. 現在の構成

| 領域 | 実装 |
| --- | --- |
| フロントエンド | React 19 + TypeScript + Viteの静的SPA |
| API・配信 | Cloudflare Worker |
| アカウント | Googleログイン、HttpOnlyセッションCookie |
| D1 | 利用者、セッション、契約状態、バックアップメタ情報、共同世帯 |
| R2 | 暗号化クラウドバックアップ、暗号化共同世帯プラン |
| 通常保存 | ブラウザ内保存、JSONエクスポート・インポート |
| 課金候補 | Square。API骨組みはあるが一般課金は未公開 |

`wrangler.jsonc`では、GoogleログインとD1/R2を設定し、`ACCESS_MODE=enforced`、`HOUSEHOLD_SHARING_MODE=preview`にしています。秘密値はCloudflare Secretsで管理し、リポジトリへ保存しません。

## 4. 現在のアクセス境界

- 無料版はGoogleログインなしで利用可能
- Googleログインだけではライフプランを自動送信しない
- 運営者は`OWNER_GOOGLE_SUB`でPro機能を課金なし確認
- 一般利用者のPro課金は未公開
- 共同世帯共有は運営者プレビュー
- 共同世帯は1契約につき契約者本人と共同利用者1人
- 暗号化クラウドバックアップと共同世帯同期は任意

## 5. 共同世帯の自動同期

`a6528ee`で、手動保存中心だった共同世帯機能へ、信頼済み端末の暗号化自動同期を追加しました。

- 端末ごとに共有パスワードを入力して明示的に有効化
- 通常入力は先にブラウザへ保存
- 操作が10秒落ち着いた後に暗号化して共有へ保存
- 30秒間隔、オンライン復帰時、画面復帰時に別端末の更新を確認
- `expectedRevision`による楽観的ロックを使用
- 同時編集は自動上書きせず、利用者が残す内容を選択
- 選ばなかった内容はブラウザの復旧用コピーへ保存
- 共有鍵更新、世帯退出、世帯削除、参加解除時は端末設定を無効化

共有パスワードは平文で永続化せず、取り出せないAES-GCM端末鍵で暗号化してIndexedDBへ保存します。localStorageへ置くのは共同世帯IDの非秘密マーカーだけです。

重要な制約:

- 自分専用かつ画面ロック済みの端末だけで自動同期を有効にする
- 共有・公共端末では有効にしない
- 同一OriginでXSSが成立すると、正規アプリと同様に端末鍵を利用される可能性がある
- ブラウザ内の通常プランは現在も平文のローカル保存であり、解除済み端末の既取得データを遠隔消去できない
- 参加解除後の将来データは共有パスワード更新で保護する

## 6. セキュリティ上の不変条件

今後の変更でも次を崩さないでください。

1. 家計、資産、家族情報をサーバーへ平文保存しない
2. 共有パスワード、復旧パスワード、カード情報をログへ残さない
3. Googleの`sub`を利用者識別子とし、メールだけで本人判定しない
4. セッションCookieの生値をD1へ保存しない
5. APIで認証、所有者確認、Pro権限、Origin、レート制限を検証する
6. 共有保存はリビジョン競合を検知し、黙って上書きしない
7. Squareの秘密鍵やWebhook署名鍵をクライアントへ渡さない
8. セキュリティを「完全」「万全」と表現せず、残る制約を明記する

詳細は以下を参照します。

- `docs/THREAT_MODEL.md`
- `docs/SECURITY_CHECKLIST.md`
- `docs/ACCOUNT_SECURITY.md`
- `docs/CLOUD_BACKUP_THREAT_MODEL.md`
- `docs/HOUSEHOLD_SHARING_SECURITY_DESIGN.md`

## 7. 主なコード

| ファイル | 役割 |
| --- | --- |
| `src/App.tsx` | 画面構成、プラン状態、共有同期の全体接続 |
| `src/hooks/useLifePlanEditor.ts` | ブラウザ内プラン更新 |
| `src/hooks/useHouseholdAutoSync.ts` | 共同世帯の自動同期、競合、復旧 |
| `src/utils/sharedPlanDeviceStore.ts` | 信頼済み端末の暗号化資格情報 |
| `src/utils/sharedPlanCrypto.ts` | 共同世帯プランの暗号化・復号 |
| `src/utils/storage.ts` | ブラウザ保存、JSON検証、復旧用コピー |
| `worker/auth.js` | Google認証とセッション |
| `worker/access.js` | Free、Pro、運営者、共有権限 |
| `worker/households.js` | 世帯、招待、参加者、鍵更新 |
| `worker/sharedPlans.js` | 暗号化共有プランのD1/R2処理 |
| `worker/backups.js` | 暗号化クラウドバックアップ |
| `worker/billing.js` | Square課金連携の骨組み |

## 8. 検証方法

PowerShell:

```powershell
cd "C:\Users\rengo\Documents\Life Compass"
npm.cmd install
npm.cmd run verify
npm.cmd run build
npm.cmd audit --audit-level=high
```

2026-07-26時点の結果:

- ロジックテスト: 101件成功
- Worker APIテスト: 30件成功
- PC・スマホE2E: 48件成功
- 本番ビルド: 成功
- npm監査の高・重大リスク: 0件

変更後は最低でも変更箇所のテストと`npm.cmd run build`を実行し、共有、認証、保存、計算ロジックに触れた場合は`npm.cmd run verify`を実行します。

## 9. デプロイ

- GitHub: `Tomo198/life-compass`
- 基準ブランチ: `main`
- Cloudflare Worker名: `life-compass`
- D1 binding: `DB`
- R2 bindings: `BACKUPS`、`SHARED_PLANS`
- 公開前にD1 migration、Secrets、R2 binding、Google OAuth設定を確認
- 詳細手順は`docs/DEPLOY.md`、`docs/GOOGLE_LOGIN_SETUP.md`、`docs/R2_BACKUP_SETUP.md`を参照

Cloudflare Secretsの値、Google固定ID、共有用pepper、Square秘密値を引き継ぎ文書や会話へ貼り付けないでください。

## 10. 次の実装順序

1. 現在のコミットをGitHubへプッシュ
2. 本番環境で契約者と別Googleアカウントによる2端末テスト
3. 自動保存、別端末反映、同時編集、オフライン復帰、参加解除、鍵更新を確認
4. 発見した不具合を修正し、共有機能の一般公開可否を再判定
5. Pro全体の価値、導線、スマホUIを最終確認
6. Square継続課金とPro権限の自動連携をSandbox相当で確認
7. 料金、解約、返金、プライバシー、特商法表記を最終確認
8. リリースチェックリストを完了してから一般課金を公開

## 11. 未完了・判断保留

- 共同世帯共有の実アカウント2人による本番検証
- 任意の強固なプライバシーロック
- Square課金状態とPro権限の本番自動連携
- Square webhook、支払い失敗、解約、再契約の本番相当テスト
- 一般利用者へ共同世帯共有を開放する時期
- Pro月額590円の最終価値評価
- 外部の専門家を含む最終的な法務・セキュリティ確認

## 12. 新しいタスクの開始文

```text
Life Compassの開発を引き継ぎます。

作業フォルダ:
C:\Users\rengo\Documents\Life Compass

最初に以下を確認してください。
- git statusとorigin/mainとの差
- docs/DEVELOPMENT_HANDOFF.md
- docs/HOUSEHOLD_SHARING_SECURITY_DESIGN.md
- docs/SECURITY_CHECKLIST.md
- docs/RELEASE_CHECKLIST.md

Life Compassは投資助言サービスではなく、家計・家族・目標・ライフイベントを整理し、複数の人生設計を比較・見直しするライフプランナーです。

現在の優先事項は、共同世帯の暗号化自動同期を本番環境で2つのGoogleアカウントから検証することです。既存のUI、計算ロジック、Free/Pro境界、平文をサーバーへ送らない設計を崩さないでください。

変更前に現状を確認し、変更後はnpm.cmd run verifyと本番ビルドを実行してください。大きくUIやデータ構造を変える場合は、実装前に影響範囲を説明してください。
```
