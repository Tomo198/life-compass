export type AccessTier = "free" | "pro";

export type FeatureKey =
  | "singlePlan"
  | "basicPlanning"
  | "budgetPlanning"
  | "basicSimulation"
  | "jsonBackup"
  | "scenarioComparison"
  | "reviewHistory"
  | "fixedCostImpact"
  | "advancedBudgetReview"
  | "lifePlanDiagnosis"
  | "householdEventOwners"
  | "detailedWithdrawal"
  | "retirementPlanning";

export const featureTiers = {
  free: {
    planLimit: 1,
    scenarioLimit: 0,
    scenarioComparison: false,
    reviewHistory: false,
    fixedCostImpact: false,
    budgetPlanning: true,
    advancedBudgetReview: false,
    lifePlanDiagnosis: false,
    householdEventOwners: false,
    detailedWithdrawal: false,
    retirementPlanning: false
  },
  pro: {
    planLimit: 20,
    scenarioLimit: 20,
    scenarioComparison: true,
    reviewHistory: true,
    fixedCostImpact: true,
    budgetPlanning: true,
    advancedBudgetReview: true,
    lifePlanDiagnosis: true,
    householdEventOwners: true,
    detailedWithdrawal: true,
    retirementPlanning: true
  }
};

export const proPriceLabel = "月500円程度を想定";

export const featureComparison: Array<{
  key: FeatureKey;
  label: string;
  free: string;
  pro: string;
}> = [
  { key: "singlePlan", label: "ライフプラン", free: "1プラン", pro: "最大20シナリオ" },
  { key: "basicPlanning", label: "基本機能", free: "家計・資産・目標・年表・メモ", pro: "無料版の全機能" },
  { key: "budgetPlanning", label: "予算・実績", free: "月次の予算と実績", pro: "履歴・前年差・レビュー連携" },
  { key: "basicSimulation", label: "見通し", free: "基本資産推移・積立・基本取り崩し", pro: "詳細条件・ばらつき・老後設計" },
  { key: "jsonBackup", label: "データ保存", free: "ブラウザ内保存・JSONバックアップ", pro: "無料版と同じ" },
  { key: "scenarioComparison", label: "シナリオ比較", free: "プレビュー", pro: "保存・比較・差分確認" },
  { key: "reviewHistory", label: "見直し履歴", free: "現在のメモ", pro: "月次・四半期履歴とTODO" },
  { key: "householdEventOwners", label: "家族・世帯", free: "世帯全体の予定", pro: "本人・配偶者・子・親ごとの管理" },
  { key: "lifePlanDiagnosis", label: "ライフプラン診断", free: "入力完了度", pro: "確認ポイントと改善履歴" }
];

// 課金導入前はPro画面を試用できる状態にし、境界はバッジと料金表で明示します。
export const proPreviewEnabled = true;
