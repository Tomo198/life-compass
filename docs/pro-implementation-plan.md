# Life Compass Pro機能 一般課金前実装計画

更新日: 2026-07-29
前提: `docs/pro-hardening-audit.md` と `docs/pro-entitlement-matrix.md` の人間承認後に開始する。

## 共通原則

- Freeを家計・資産・目標・イベント・予算実績・基本試算に使える状態で維持する。
- 家計、資産、家族情報の平文をサーバーへ送らない。
- Free降格、課金失敗、アプリ更新で既存データを削除しない。
- 上限超過や不正データを黙って切り捨てない。
- 個人Proと共同世帯内Proを分離する。
- 1タスク1目的を原則とし、各タスク完了時に `npm.cmd run verify` を通す。
- Square本番を有効にする変更はPhase 5の承認まで行わない。

## Phase 0: 権限、データ形式、契約状態、暗号方針の固定

### P0-1 権限状態契約を型とテストデータで固定

- 目的: Free、個人Pro、世帯role、read/write、支払い状態を単一の明示契約で表現する。
- 対象ファイル: `src/features.ts`, `worker/access.js`, `worker/index.js`, 新規の共有型またはcontract fixture、関連テスト
- 変更内容: `currentPeriodEnd`, `cancelAtPeriodEnd`, `paymentStatus`, `household.role/status/readAllowed/writeAllowed/retentionUntil` を保持する。未知状態はfail closed。
- 変更しない範囲: 画面デザイン、価格、Square API処理。
- 依存タスク: なし。`pro-entitlement-matrix.md` の承認が開始条件。
- 受入条件: 全状態をfixtureで列挙し、クライアントがサーバー応答を欠落なく解釈する。
- 自動テスト: 状態別のtier、read、write、個人/世帯scope、未知値の拒否。
- 手動確認: 料金・設定画面で表示する日本語状態名を確認。
- ロールバック方法: contract追加コミットを単独revertし、旧`AccessState`へ戻す。

#### P0-1 実装記録（2026-07-29、ローカル・未コミット）

- `shared/entitlement-policy.js`をクライアントとWorkerの共通判定とし、型宣言を`shared/entitlement-policy.d.ts`へ分離した。
- 個人契約は`none / pending_payment / active / past_due / cancel_at_period_end / expired / revoked`、共同世帯は`owner / editor / viewer / none`を表現する。
- Squareの支払済み最終日は、そのUTC日を含むため翌日00:00 UTCを排他的な`validUntil`とする。期限と同一時刻は失効後として扱う。
- `past_due`では、直近の処理済みSquare支払い成功後に最初の失敗イベントをWorkerが受信したUTC時刻を`validUntil`（猶予起点）とし、`graceUntil`をその7日後に固定して同一時刻からFreeへ降格する。同じ失敗期間中の再請求失敗では猶予を延長せず、失敗イベント時刻が欠落・不正ならfail closedとする。Square Webhook処理、DB schema、Square設定はこのタスクでは変更していない。
- Free降格後の保存済みProデータ・版履歴の閲覧、個人JSON入出力、既存クラウドバックアップの復元・削除を許可し、新規生成・編集・比較・採用・詳細再計算・新規クラウドバックアップを拒否する契約をunit testで固定した。
- 共同世帯の閲覧・編集・メンバー管理はroleとサーバー算出済みread/write状態の両方で判定し、個人Proと共同世帯権限は相互に昇格させない。
- 既発行の招待を受諾する直前にも、世帯ownerの`manage_household_members`をWorkerで再判定し、失効後の新規参加を拒否する。
- 旧`tier`とfeature matrixは既存UIの互換アダプターとして残すが、個人tierは新snapshotの個人契約だけから導出する。共同世帯の互換開放は対象世帯の詳細収支・固定費編集に限定する。
- `ACCESS_MODE=preview`は表示・開発確認用のmodeだけとし、個人Proへ昇格させない。manual snapshotはpreviewから独立し、verified emailかつWorker sessionのGoogle subが`OWNER_GOOGLE_SUB`と完全一致する運営者だけにWorkerが発行する。
- viewerは型・純粋判定・fail-closedテストまでを実装した。D1のrole制約、招待、role変更、viewer向け読取専用UIは後続タスクとし、今回変更していない。
- 画面単位の旧gateを操作単位へ全面置換するUI作業、権限変更のリアルタイム反映、Squareイベント順序・返金・定期照合は未実装のまま残す。
- 検証: `npm.cmd run verify`（logic 116件、Worker API 30件、E2E 58件）、`npm.cmd run build`、`npm.cmd audit --audit-level=high`（脆弱性0件）、`git diff --check`を通過した。
