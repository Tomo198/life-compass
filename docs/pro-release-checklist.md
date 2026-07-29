### P0-1 権限状態契約の自動検証記録

- [x] 個人契約と共同世帯roleを別scopeの型として定義した
- [x] active、解約予約、支払い失敗7日猶予、期限終了、pending、expired、revokedの境界をunit testで固定した
- [x] Free降格後の許可操作と禁止操作をunit testで固定した
- [x] owner、editor、viewer、noneと個人・共同世帯の非波及をunit testで固定した
- [x] 未知状態、不正UTC日時、欠落期限、矛盾した猶予、世帯ID・role・revision不整合をfail closedにした
- [x] Square以外のprovider、支払い失敗時刻の欠落、欠落・不正snapshot（previewを含む）をfail closedにした
- [x] `ACCESS_MODE=preview`単独ではmanual、`effectiveTier=pro`、個人Pro操作を付与せず、verified owner manualはpreviewから独立させた
- [x] 同じ支払い失敗期間中の再請求失敗で7日猶予が延長されないことをWorker API testで固定した
- [x] 新規クラウドバックアップ、共同世帯データ、共同世帯同期、メンバー管理はWorkerでも共通判定を行う
- [x] 招待受諾直前にownerのメンバー管理権限をWorkerで再確認し、失効後の新規参加を拒否する
- [ ] 保存済み結果の閲覧と編集・復元を画面内の操作単位へ完全分離する
- [ ] viewerをD1、招待、role変更、読取専用UIへ実装する
- [ ] 開いている画面への契約・role変更のリアルタイム反映を実装する

自動証拠: `shared/entitlement-policy.js`、`tests/entitlements.test.ts`、`scripts/run-worker-api-tests.mjs`、`npm.cmd run verify`（116 + 30 + E2E 56件）、`npm.cmd run build`、`npm.cmd audit --audit-level=high`（0件）、`git diff --check`
確認者/日: ________
