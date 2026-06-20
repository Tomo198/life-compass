# Life Compass アプリ仕様書

Life Compass は、投資を主軸にしない個人向けライフプランナーです。家計、仕事、住まい、家族、将来目標、ライフイベントを整理し、人生設計を作成・保存・見直し・比較できることを目的にします。

## 1. アプリ仕様

### 目的

- 自分のライフプランを1つ作成し、いつでも見返せる
- 状況が変わったときに収支、資産、目標、ライフイベントを修正できる
- 家計、資産、将来イベントの関係をグラフと年表で確認できる
- 支出見直し、転職、副業、住宅購入などの選択が将来に与える影響を比較できる設計にする
- 不安を煽らず、現状把握と見直しを支援する

### 初期版の保存方針

- 収入、支出、資産、家族情報などはサーバーに保存しない
- ブラウザ内保存 localStorage を基本にする
- JSONエクスポート/インポートでバックアップできる
- 将来のログイン、クラウド保存、Stripe/PayPal課金に備え、保存処理を `storage` 層に分離する

### 表現方針

- 使用する表現: `前提条件に基づく試算`、`見通し`、`比較`、`整理`、`参考情報`
- 避ける表現: `投資助言`、`最適化`、`おすすめ商品`、`高収益`、`必ず増える`、`保証`
- 個別の金融商品、銘柄、保険商品、暗号資産の推奨は行わない

## 2. 画面構成

### MVP画面

1. ダッシュボード
   - 現在の収支、貯蓄率、現在資産、生活防衛資金の状態
   - 主要目標、次のライフイベント
   - 将来見通しの簡易グラフ

2. ライフプラン作成/編集
   - 基本プロフィール、年齢、家族構成、働き方、住居形態
   - 現在資産、生活費

3. 家計入力
   - 月収、ボーナス、副業収入
   - 固定費、変動費、年間特別支出
   - 毎月貯蓄額、貯蓄率

4. 予算・実績プラン
   - 日別明細ではなく、月次レビューと将来見通しに使う予算・実績を整理
   - カテゴリ、頻度、予算額、月別実績、差額を確認
   - 年間換算した固定費、変動費、年間特別支出を家計入力へ反映

5. 資産入力
   - 現金、投資資産、その他資産、負債、純資産

6. 目標管理
   - 目標一覧、作成、期限、必要額、進捗、優先度、メモ

7. ライフイベント年表
   - 年齢/年ごとのイベント
   - 支出イベント、収入変化イベント
   - 住宅、教育、車、退職など

8. シミュレーション
   - 基本資産推移
   - 簡易積立
   - 生活防衛資金
   - 将来見通し
   - 積立、取り崩しのばらつき試算

9. 老後生活プラン
   - 退職年齢、試算終了年齢、退職金、退職後の利回り、物価上昇率を入力
   - 退職後生活費、住居費、医療費、介護・支援費、年間特別支出を入力
   - 公的年金、企業年金・個人年金、その他収入を入力
   - 国民健康保険、介護保険、税金を月額概算として入力
   - 年齢ごとの取り崩し額、年末資産、資産寿命の目安を表とグラフで確認
   - 年ごとの利回りが一定ではない前提のばらつき試算を確認

10. データ管理
   - ブラウザ内保存状態
   - JSONエクスポート、JSONインポート、初期化
   - 免責事項の表示

11. Pro機能紹介
   - Coming soon
   - 月500円程度を想定
   - 複数シナリオ比較、ライフプラン診断、世帯イベント管理、予算・実績レビュー、固定費見直しインパクト、見直し履歴、詳細積立、取り崩し、老後生活プラン

12. 法務ページ
   - 利用規約
   - プライバシーポリシー
   - 特定商取引法に基づく表記
   - 免責事項

### Pro予定画面

- シナリオ比較
- ライフプラン診断
- 世帯イベント管理
- 見直しメモ/レビュー
- 詳細積立シミュレーション
- 詳細取り崩しシミュレーション
- 退職後の生活費・年金・社会保険・税金・インフレを置いた老後生活プラン
- 家族/世帯モード

初期版ではロック表示または Coming soon とし、無料版との機能境界を画面上で明示する。

## 3. 無料版/Pro版の機能境界

| 機能 | 無料版 | Pro版予定 |
| --- | --- | --- |
| ライフプラン保存 | 1プラン | 複数シナリオ保存 |
| 家計入力 | 基本収支 | 詳細収入変化、固定費見直し |
| 予算・実績 | 月次の予算、実績、差額整理 | レビュー履歴、シナリオ、診断との詳細連携 |
| 資産推移 | 10年/30年の基本見通し | 複数シナリオ比較、詳細積立、取り崩し、退職後設計 |
| 老後生活プラン | 簡易取り崩しの確認 | 年金、国民健康保険、介護保険、税金を含む詳細見通し |
| 生活防衛資金 | 基本チェック | 世帯/働き方別の詳細レビュー |
| 目標管理 | 目標一覧と進捗 | 達成予定変化、レビュー履歴 |
| ライフイベント | 年表作成 | シナリオごとの差分管理 |
| 世帯イベント | 1つの年表で管理 | 本人、配偶者、子ども、親、世帯全体で対象者別に整理 |
| 診断 | 入力完了度の案内 | 家計、資産、目標、イベント、レビューの確認ポイント整理 |
| データ保存 | ブラウザ内保存、JSON | クラウド保存予定 |
| 課金 | なし | 月500円程度を想定 |

## 4. データ構造

```ts
type LifePlan = {
  version: number;
  profile: Profile;
  household: Household;
  assets: Assets;
  goals: Goal[];
  events: LifeEvent[];
  simulation: SimulationSettings;
  retirementPlan: RetirementPlanSettings;
  reviews: ReviewNote[];
  scenarios: PlanScenario[];
  fixedCostItems: FixedCostItem[];
  budgetItems: BudgetItem[];
  updatedAt: string;
};

type Profile = {
  name: string;
  age: number;
  familyType: "single" | "couple" | "children" | "care" | "other";
  workStyle: "employee" | "freelance" | "selfEmployed" | "variable" | "retired" | "other";
  housing: "rent" | "owned" | "mortgage" | "family" | "other";
};

type Household = {
  monthlyIncome: number;
  annualBonus: number;
  sideIncome: number;
  fixedCost: number;
  variableCost: number;
  annualSpecialCost: number;
};

type Assets = {
  cash: number;
  investment: number;
  other: number;
  debt: number;
};

type Goal = {
  id: string;
  title: string;
  dueYear: number;
  requiredAmount: number;
  priority: "high" | "medium" | "low";
  progress: number;
  memo: string;
};

type LifeEvent = {
  id: string;
  title: string;
  category: LifeEventCategory;
  year: number;
  age: number;
  amount: number;
  cashflowType: "expense" | "income" | "neutral";
  memo: string;
};

type SimulationSettings = {
  monthlyContribution: number;
  bonusContribution: number;
  annualReturnRate: number;
  years: number;
};

type BudgetItem = {
  id: string;
  name: string;
  category: BudgetCategory;
  frequency: "monthlyFixed" | "monthlyVariable" | "irregularFixed" | "irregularVariable" | "yearly" | "oneTime";
  budgetAmount: number;
  actuals: Record<string, number>;
  memo: string;
};

type RetirementPlanSettings = {
  retirementAge: number;
  planUntilAge: number;
  monthlyLivingCost: number;
  monthlyHousingCost: number;
  monthlyMedicalCost: number;
  monthlyCareCost: number;
  monthlyPublicPension: number;
  monthlyPrivatePension: number;
  monthlyOtherIncome: number;
  monthlyHealthInsurance: number;
  monthlyLongTermCareInsurance: number;
  monthlyTaxes: number;
  annualExtraExpense: number;
  retirementLumpSum: number;
  annualReturnRate: number;
  inflationRate: number;
};
```

### 将来拡張用

- `scenarioId` を各入力データに追加すると、複数シナリオ保存へ移行できる
- `userId` と `planId` を追加すると、クラウド保存へ移行できる
- `subscriptionTier` を追加すると、課金状態に応じた機能制御へ移行できる

## 5. 主要な計算ロジック

### 基本収支

- 月間収入 = 月収 + 副業収入
- 月間生活費 = 固定費 + 変動費 + 年間特別支出 / 12
- 毎月貯蓄額 = 月間収入 - 月間生活費
- 貯蓄率 = 毎月貯蓄額 / 月間収入

### 予算・実績

- 毎月・固定 = 家計入力の固定費に反映
- 毎月・変動 = 家計入力の変動費に反映
- 不定期、年1回 = 年間特別支出に反映
- 1回だけの支出 = 予算・実績では確認用に残し、将来見通しへの反映はライフイベント年表で扱う
- 月平均予算 = 年間換算した予算額 / 12
- 選択月の差額 = 選択月の実績 - 月平均予算
- 日別明細、店舗別分析、カード明細の自動取込は扱わない

### 純資産

- 総資産 = 現金 + 投資資産 + その他資産
- 純資産 = 総資産 - 負債

### 生活防衛資金

- 推奨生活防衛資金 = 月間生活費 × 目安月数

目安月数:

| 条件 | 目安 |
| --- | --- |
| 会社員・単身 | 6ヶ月 |
| 会社員・家族あり | 9ヶ月 |
| 自営業/フリーランス | 12ヶ月 |
| 収入変動が大きい | 12ヶ月 |
| 住宅ローンあり | 9〜12ヶ月 |

判定:

- 現金が下限以上なら「目安範囲内」
- 現金が下限未満なら「下限まであといくら」
- 毎月貯蓄額が正なら「到達までの目安月数」

### 基本資産推移

月次複利で試算する。

- 初期資産 = 現金 + 投資資産 + その他資産 - 負債
- 月利 = 想定利回り / 12
- 各月末資産 = 前月資産 × (1 + 月利) + 毎月貯蓄額
- 年末値を10年/30年グラフに表示

### 老後生活プラン

- 退職時点の試算資産 = 現在資産を退職年齢まで基本資産推移で試算した額 + 退職金・一時金
- 年間生活費 = 退職後生活費、住居費、医療費、介護・支援費の月額合計 × 12 + 年間特別支出
- 年間社会保険・税金 = 国民健康保険、介護保険、税金の月額概算合計 × 12
- 年間年金等 = 公的年金、企業年金・個人年金、その他収入の月額合計 × 12
- 年間取り崩し額 = max(0, 年間生活費 + 年間社会保険・税金 - 年間年金等)
- 年末資産 = (前年資産 - 年間取り崩し額) × (1 + 退職後の想定利回り)
- 生活費、社会保険・税金、年間特別支出には物価上昇率を反映する
- 年金等は入力額を固定して扱う
- 国民健康保険、介護保険、税金の正式な制度計算は行わず、ユーザー入力の概算前提として扱う

### ばらつき試算

- 積立、取り崩し、老後生活プランでは、平均利回りに対して年ごとのばらつき幅を置いた参考試算を表示する
- 疑似乱数で複数ケースを作り、下位10%、中央値、上位90%の範囲を表示する
- 取り崩しと老後生活プランでは、試算期間内に資産が尽きるケース割合も表示する
- 結果は将来予測ではなく、入力した前提条件に基づく参考情報として扱う

### 簡易積立シミュレーション

- 毎月積立額、ボーナス積立、想定利回り、積立期間から将来額を試算
- 積立しない場合との差
- 月1万円増やした場合との差
- 利回り別 0%、2%、4%、6% の比較

表示では必ず `前提条件に基づく試算` と明記する。

## 6. MVPの実装順序

1. Vite + React + TypeScript の静的SPA土台
2. 型定義、初期データ、計算ロジック
3. localStorage保存、JSONエクスポート/インポート
4. ダッシュボード
5. 基本プロフィール、家計、資産入力
6. 目標管理、ライフイベント年表
7. 生活防衛資金、資産推移、積立シミュレーション
8. Pro Coming soon、法務ページ
9. スマホ表示とビルド確認

## 7. 将来的な課金導入を見越した設計方針

### 機能制御

- `features.ts` に無料版/Pro版の機能フラグを集約する
- UI上はPro機能を表示しつつ、操作は Coming soon で止める
- 将来 `subscriptionTier: "free" | "pro"` に差し替える

### 保存設計

- 初期版: localStorage
- 将来: `storage` インターフェースをクラウドAPI実装へ差し替える
- JSON形式はバージョン番号を持たせ、将来のマイグレーションに対応する

### 課金設計

- 初期版では課金処理を実装しない
- 将来、Stripe/PayPalのCheckout後に `subscriptionTier` を更新する
- 課金状態はアプリ本体の表示制御と保存制限に使う

### クラウド保存

- 認証導入後は `userId` ごとに複数 `planId` を保存する
- 収入、資産、家族情報は機微情報として扱い、暗号化、削除、エクスポート導線を設ける

## 8. 法務・表現面で注意すべき点

アプリ内に以下を明記する。

- このアプリは教育・参考目的のライフプラン管理ツールです
- 表示される結果は入力条件に基づく試算です
- 投資助言、税務助言、法律助言、保険助言ではありません
- 個別の金融商品、銘柄、保険商品等を推奨しません
- 実際の判断は必要に応じて専門家に相談してください
- 将来の収益や資産形成を保証するものではありません

### UI文言のルール

- OK: `見通し`, `比較`, `整理`, `参考情報`, `前提条件に基づく試算`
- NG: `最適化`, `絶対`, `保証`, `高利回り`, `おすすめ商品`, `儲かる`, `買うべき`
