import { createScenarioSnapshot } from "../data/scenarios";
import type { LifePlan, PlanScenario, ReviewNote } from "../types";
import {
  getAssetSummary,
  getBudgetSummary,
  getCashflowSummary,
  getGoalAchievement,
  getPrimaryGoal,
  projectAssets
} from "./calculations";

export const createPlanReview = (plan: LifePlan, id: string, date: string): ReviewNote => {
  const assets = getAssetSummary(plan.assets);
  const cashflow = getCashflowSummary(plan.household);
  const projection = projectAssets(plan, 30);
  const primaryGoal = getPrimaryGoal(plan);
  const goalAchievement = primaryGoal ? getGoalAchievement(plan, primaryGoal) : null;

  return {
    id,
    date,
    reviewType: "monthly",
    scenarioName: plan.activeScenario?.name || "基本プラン",
    scenarioAdoptedAt: plan.activeScenario?.adoptedAt,
    plannedNetAssets: assets.netAssets,
    plannedMonthlySavings: cashflow.monthlySavings,
    plannedTenYearAssets: projection[10]?.value ?? assets.netAssets,
    plannedThirtyYearAssets: projection[30]?.value ?? assets.netAssets,
    plannedGoalTitle: primaryGoal?.title,
    plannedGoalTargetAge: goalAchievement?.targetAge ?? null,
    actualNetAssets: assets.netAssets,
    actualMonthlySavings: cashflow.monthlySavings,
    todo: "",
    todoDone: false,
    memo: ""
  };
};

export const applyBudgetActualsToReview = (plan: LifePlan, review: ReviewNote): ReviewNote | null => {
  const budgetItems = plan.budgetItems || [];
  if (budgetItems.length === 0) return null;

  const monthKey = review.date.slice(0, 7);
  const summary = getBudgetSummary(budgetItems, monthKey);
  if (summary.actualEntryCount !== budgetItems.length) return null;

  const monthlyIncome = getCashflowSummary(plan.household).monthlyIncome;
  return {
    ...review,
    actualMonthlyExpenses: summary.actual,
    actualMonthlySavings: monthlyIncome - summary.actual
  };
};

export const createScenarioFromReview = (
  plan: LifePlan,
  review: ReviewNote,
  id: string,
  createdAt: string
): PlanScenario => {
  const netAssetGap = (review.actualNetAssets ?? 0) - (review.plannedNetAssets ?? 0);
  const savingsGap = (review.actualMonthlySavings ?? 0) - (review.plannedMonthlySavings ?? 0);

  return {
    id,
    name: `${review.date.slice(0, 7).replace("-", "年")}月 見直し案`,
    description: `レビュー結果をもとに作成。純資産差 ${netAssetGap.toLocaleString("ja-JP")}円、通常月の家計余剰差 ${savingsGap.toLocaleString("ja-JP")}円。`,
    tag: "custom",
    createdAt,
    snapshot: createScenarioSnapshot(plan)
  };
};
