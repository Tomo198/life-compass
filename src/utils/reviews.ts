import { createScenarioSnapshot } from "../data/scenarios";
import type { Assets, Household, LifePlan, PlanScenario, ReviewNote, ScenarioSnapshot } from "../types";
import {
  getAssetSummary,
  getBudgetSummary,
  getCashflowSummary,
  getGoalAchievement,
  getPrimaryGoal,
  projectAssets
} from "./calculations";

export type ReviewScenarioOptions = {
  applyActualNetAssets: boolean;
  applyActualMonthlyExpenses: boolean;
};

const defaultReviewScenarioOptions: ReviewScenarioOptions = {
  applyActualNetAssets: false,
  applyActualMonthlyExpenses: false
};

const applyActualNetAssets = (assets: Assets, targetNetAssets: number): Assets => {
  const nextAssets = { ...assets };
  const currentNetAssets = getAssetSummary(nextAssets).netAssets;
  const difference = targetNetAssets - currentNetAssets;

  if (difference >= 0) {
    nextAssets.cash += difference;
    return nextAssets;
  }

  let amountToReduce = Math.abs(difference);
  (["cash", "investment", "other"] as const).forEach((key) => {
    const reduction = Math.min(nextAssets[key], amountToReduce);
    nextAssets[key] -= reduction;
    amountToReduce -= reduction;
  });
  if (amountToReduce > 0) nextAssets.debt += amountToReduce;

  return nextAssets;
};

const applyActualMonthlyExpenses = (household: Household, targetMonthlyExpenses: number): Household => {
  const nextHousehold = { ...household };
  const target = Math.max(0, targetMonthlyExpenses);
  const specialMonthly = nextHousehold.annualSpecialCost / 12;

  if (target <= specialMonthly) {
    nextHousehold.fixedCost = 0;
    nextHousehold.variableCost = 0;
    nextHousehold.annualSpecialCost = target * 12;
    return nextHousehold;
  }

  const recurringTarget = target - specialMonthly;
  const currentRecurring = nextHousehold.fixedCost + nextHousehold.variableCost;
  if (currentRecurring <= 0) {
    nextHousehold.variableCost = recurringTarget;
    return nextHousehold;
  }

  nextHousehold.fixedCost = Math.round(recurringTarget * (nextHousehold.fixedCost / currentRecurring));
  nextHousehold.variableCost = recurringTarget - nextHousehold.fixedCost;
  return nextHousehold;
};

export const createReviewScenarioSnapshot = (
  plan: LifePlan,
  review: ReviewNote,
  options: ReviewScenarioOptions
): ScenarioSnapshot => {
  const snapshot = createScenarioSnapshot(plan);

  if (options.applyActualNetAssets && review.actualNetAssets !== undefined) {
    snapshot.assets = applyActualNetAssets(snapshot.assets, review.actualNetAssets);
  }
  if (options.applyActualMonthlyExpenses && review.actualMonthlyExpenses !== undefined) {
    snapshot.household = applyActualMonthlyExpenses(snapshot.household, review.actualMonthlyExpenses);
  }

  return snapshot;
};

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
    actualMonthlyExpenses: cashflow.monthlyLivingCost,
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
  createdAt: string,
  options: ReviewScenarioOptions = defaultReviewScenarioOptions
): PlanScenario => {
  const netAssetGap = (review.actualNetAssets ?? 0) - (review.plannedNetAssets ?? 0);
  const savingsGap = (review.actualMonthlySavings ?? 0) - (review.plannedMonthlySavings ?? 0);
  const appliedItems = [
    options.applyActualNetAssets && review.actualNetAssets !== undefined ? "実際の純資産" : "",
    options.applyActualMonthlyExpenses && review.actualMonthlyExpenses !== undefined ? "実際の月間支出" : ""
  ].filter(Boolean);

  return {
    id,
    name: `${review.date.slice(0, 7).replace("-", "年")}月 見直し案`,
    description: `レビュー結果をもとに作成。純資産差 ${netAssetGap.toLocaleString("ja-JP")}円、通常月の家計余剰差 ${savingsGap.toLocaleString("ja-JP")}円。${appliedItems.length > 0 ? `${appliedItems.join("・")}を比較前提へ仮反映。` : "実績値は未反映。"}`,
    tag: "custom",
    createdAt,
    snapshot: createReviewScenarioSnapshot(plan, review, options)
  };
};
