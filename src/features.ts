import type { ViewKey } from "./types";

export type AccessTier = "free" | "pro";
export type AccessMode = "preview" | "enforced";
export type AccessSource = "local-preview" | "operator" | "anonymous" | "subscription";

export type AccessState = {
  tier: AccessTier;
  mode: AccessMode;
  source: AccessSource;
};

export type FeatureKey =
  | "singlePlan"
  | "basicPlanning"
  | "budgetPlanning"
  | "basicSimulation"
  | "jsonBackup"
  | "encryptedCloudBackup"
  | "scenarioComparison"
  | "reviewHistory"
  | "fixedCostImpact"
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
    encryptedCloudBackup: false,
    lifePlanDiagnosis: false,
    simulationVariability: false,
    retirementPlanning: false
  },
  pro: {
    planLimit: 20,
    scenarioLimit: 20,
    scenarioComparison: true,
    reviewHistory: true,
    fixedCostImpact: true,
    budgetPlanning: true,
    encryptedCloudBackup: true,
    lifePlanDiagnosis: true,
    simulationVariability: true,
    retirementPlanning: true
  }
};

export type FeatureAccessKey = Exclude<keyof typeof featureTiers.free, "planLimit" | "scenarioLimit">;

export const defaultAccessState: AccessState = {
  tier: "free",
  mode: "enforced",
  source: "anonymous"
};

const proViewFeatures: Partial<Record<ViewKey, FeatureAccessKey>> = {
  retirement: "retirementPlanning",
  scenarios: "scenarioComparison",
  diagnosis: "lifePlanDiagnosis",
  reviews: "reviewHistory"
};

export const getEffectiveTier = (access: AccessState): AccessTier =>
  access.mode === "preview" ? "pro" : access.tier;

export const hasFeatureAccess = (access: AccessState, feature: FeatureAccessKey) =>
  Boolean(featureTiers[getEffectiveTier(access)][feature]);

export const canOpenView = (access: AccessState, view: ViewKey) => {
  const feature = proViewFeatures[view];
  return feature ? hasFeatureAccess(access, feature) : true;
};

export const getPlanLimit = (access: AccessState) => featureTiers[getEffectiveTier(access)].planLimit;
export const getScenarioLimit = (access: AccessState) => featureTiers[getEffectiveTier(access)].scenarioLimit;

export const featureComparison: Array<{
  key: FeatureKey;
  label: string;
  free: string;
  pro: string;
}> = [
  { key: "singlePlan", label: "ライフプラン", free: "基本プラン1件", pro: "基本プラン + 最大20シナリオ" },
  { key: "basicPlanning", label: "基本機能", free: "家計・資産・目標・年表・メモ", pro: "無料版の全機能" },
  { key: "budgetPlanning", label: "予算・実績", free: "月次入力・年間履歴・予算比較", pro: "レビューへの実績反映・計画差" },
  { key: "basicSimulation", label: "見通し", free: "基本資産推移・積立・取り崩し", pro: "1000回のばらつき試算・老後設計" },
  { key: "jsonBackup", label: "データ保存", free: "ブラウザ内保存・JSONバックアップ", pro: "無料版と同じ" },
  { key: "encryptedCloudBackup", label: "暗号化クラウドバックアップ", free: "JSONで手動保管", pro: "暗号化した手動保存・復元" },
  { key: "scenarioComparison", label: "シナリオ比較", free: "プレビュー", pro: "保存・比較・差分確認" },
  { key: "reviewHistory", label: "レビューセンター", free: "現在のメモ", pro: "計画差・前回差・将来見通し・TODO" },
  { key: "fixedCostImpact", label: "固定費見直し", free: "固定費の入力", pro: "年間・10年後・30年後への影響比較" },
  { key: "householdEventOwners", label: "家族・世帯", free: "本人・配偶者・子ども・親ごとの予定整理", pro: "家族の予定を含むシナリオ比較" },
  { key: "lifePlanDiagnosis", label: "ライフプラン診断", free: "入力完了度・未入力ガイド", pro: "家計・資産・目標等の横断確認" },
  { key: "detailedWithdrawal", label: "取り崩し・老後設計", free: "金額・年率による105歳までの試算", pro: "ばらつき・年金等を含む詳細見通し" }
];
