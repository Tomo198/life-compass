import { defaultPlan } from "../data/defaultPlan";
import type {
  BudgetCategory,
  BudgetFrequency,
  BudgetItem,
  FixedCostItem,
  Goal,
  LifeEvent,
  LifePlan,
  PlanScenario,
  RetirementPlanSettings,
  ReviewNote,
  ScenarioSnapshot,
  WithdrawalPeriodSettings,
  WithdrawalPlanSettings
} from "../types";

const STORAGE_KEY = "life-compass-plan-v1";
const budgetCategories: BudgetCategory[] = [
  "food",
  "daily",
  "housing",
  "utilities",
  "communication",
  "insurance",
  "car",
  "education",
  "medical",
  "travel",
  "subscription",
  "other"
];
const budgetFrequencies: BudgetFrequency[] = [
  "monthlyFixed",
  "monthlyVariable",
  "irregularFixed",
  "irregularVariable",
  "yearly",
  "oneTime"
];

export const loadPlan = (): LifePlan => {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return defaultPlan;

  try {
    const parsed = JSON.parse(saved) as LifePlan;
    if (!parsed.version || !parsed.profile || !parsed.household || !parsed.assets) {
      return defaultPlan;
    }
    return normalizePlan(parsed);
  } catch {
    return defaultPlan;
  }
};

export const savePlan = (plan: LifePlan) => {
  const payload = { ...plan, updatedAt: new Date().toISOString() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  return payload;
};

export const clearPlan = () => {
  localStorage.removeItem(STORAGE_KEY);
};

export const exportPlan = (plan: LifePlan) => {
  const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `life-compass-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
};

export const validateImportedPlan = (value: unknown): LifePlan => {
  const plan = value as LifePlan;
  if (!plan || typeof plan !== "object") throw new Error("JSONの形式を確認してください。");
  if (!plan.profile || !plan.household || !plan.assets || !Array.isArray(plan.goals) || !Array.isArray(plan.events)) {
    throw new Error("Life Compass のバックアップJSONではありません。");
  }
  return normalizePlan(plan);
};

const normalizePlan = (plan: LifePlan): LifePlan => {
  return {
    ...plan,
    version: plan.version || 1,
    goals: Array.isArray(plan.goals) ? plan.goals.map(normalizeGoal) : [],
    events: Array.isArray(plan.events) ? plan.events.map(normalizeEvent) : [],
    simulation: plan.simulation || defaultPlan.simulation,
    withdrawalPlan: normalizeWithdrawalPlan(plan.withdrawalPlan),
    notes: {
      general: plan.notes?.general || "",
      spendingReview: plan.notes?.spendingReview || ""
    },
    retirementPlan: normalizeRetirementPlan(plan.retirementPlan),
    reviews: Array.isArray(plan.reviews) ? plan.reviews.map(normalizeReview) : [],
    scenarios: Array.isArray(plan.scenarios) ? plan.scenarios.map(normalizeScenario) : [],
    fixedCostItems: Array.isArray(plan.fixedCostItems) ? plan.fixedCostItems.map(normalizeFixedCostItem) : [],
    budgetItems: Array.isArray(plan.budgetItems) ? plan.budgetItems.map(normalizeBudgetItem) : [],
    updatedAt: new Date().toISOString()
  };
};

const normalizeMonth = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(12, Math.round(value)));
};

const normalizeEvent = (event: LifeEvent): LifeEvent => ({
  ...event,
  owner: event.owner || "household",
  month: normalizeMonth(event.month)
});

const normalizeGoal = (goal: Goal): Goal => {
  const progress = Number.isFinite(goal.progress) ? goal.progress : 0;
  const requiredAmount = Number.isFinite(goal.requiredAmount) ? goal.requiredAmount : 0;

  return {
    ...goal,
    goalType: goal.goalType || "oneTime",
    requiredAmount,
    savedAmount:
      typeof goal.savedAmount === "number" && Number.isFinite(goal.savedAmount)
        ? goal.savedAmount
        : Math.round((requiredAmount * progress) / 100),
    monthlyAllocation:
      typeof goal.monthlyAllocation === "number" && Number.isFinite(goal.monthlyAllocation) ? goal.monthlyAllocation : 0,
    recurrence: goal.recurrence || "yearly",
    progress
  };
};

const finiteOptionalNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

const finiteNumber = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const normalizeRetirementPlan = (settings: RetirementPlanSettings | undefined): RetirementPlanSettings => {
  const defaults = defaultPlan.retirementPlan;
  const retirementAge = Math.max(0, Math.round(finiteNumber(settings?.retirementAge, defaults.retirementAge)));
  const planUntilAge = Math.max(retirementAge, Math.round(finiteNumber(settings?.planUntilAge, defaults.planUntilAge)));

  return {
    retirementAge,
    planUntilAge,
    monthlyLivingCost: finiteNumber(settings?.monthlyLivingCost, defaults.monthlyLivingCost),
    monthlyHousingCost: finiteNumber(settings?.monthlyHousingCost, defaults.monthlyHousingCost),
    monthlyMedicalCost: finiteNumber(settings?.monthlyMedicalCost, defaults.monthlyMedicalCost),
    monthlyCareCost: finiteNumber(settings?.monthlyCareCost, defaults.monthlyCareCost),
    monthlyPublicPension: finiteNumber(settings?.monthlyPublicPension, defaults.monthlyPublicPension),
    monthlyPrivatePension: finiteNumber(settings?.monthlyPrivatePension, defaults.monthlyPrivatePension),
    monthlyOtherIncome: finiteNumber(settings?.monthlyOtherIncome, defaults.monthlyOtherIncome),
    monthlyHealthInsurance: finiteNumber(settings?.monthlyHealthInsurance, defaults.monthlyHealthInsurance),
    monthlyLongTermCareInsurance: finiteNumber(
      settings?.monthlyLongTermCareInsurance,
      defaults.monthlyLongTermCareInsurance
    ),
    monthlyTaxes: finiteNumber(settings?.monthlyTaxes, defaults.monthlyTaxes),
    annualExtraExpense: finiteNumber(settings?.annualExtraExpense, defaults.annualExtraExpense),
    retirementLumpSum: finiteNumber(settings?.retirementLumpSum, defaults.retirementLumpSum),
    annualReturnRate: finiteNumber(settings?.annualReturnRate, defaults.annualReturnRate),
    inflationRate: finiteNumber(settings?.inflationRate, defaults.inflationRate)
  };
};

const normalizeWithdrawalPeriod = (period: WithdrawalPeriodSettings | undefined, fallback: WithdrawalPeriodSettings): WithdrawalPeriodSettings => {
  const startAge = Math.max(0, Math.round(finiteNumber(period?.startAge, fallback.startAge)));
  const endAge = Math.max(startAge, Math.round(finiteNumber(period?.endAge, fallback.endAge)));

  return {
    id: period?.id || crypto.randomUUID(),
    label: period?.label || fallback.label || "期間",
    startAge,
    endAge,
    monthlyIncome: finiteNumber(period?.monthlyIncome, fallback.monthlyIncome),
    monthlyLivingCost: finiteNumber(period?.monthlyLivingCost, fallback.monthlyLivingCost),
    annualExtraExpense: finiteNumber(period?.annualExtraExpense, fallback.annualExtraExpense)
  };
};

const normalizeWithdrawalPlan = (settings: WithdrawalPlanSettings | undefined): WithdrawalPlanSettings => {
  const defaults = defaultPlan.withdrawalPlan;
  const startAge = Math.max(0, Math.round(finiteNumber(settings?.startAge, defaults.startAge)));
  const years = Math.max(1, Math.min(80, Math.round(finiteNumber(settings?.years, defaults.years))));
  const fallbackPeriod = defaults.periods[0];
  const periods =
    Array.isArray(settings?.periods) && settings.periods.length > 0
      ? settings.periods.map((period) => normalizeWithdrawalPeriod(period, fallbackPeriod))
      : defaults.periods.map((period) => normalizeWithdrawalPeriod(period, period));

  return {
    startAge,
    startingAssets: finiteNumber(settings?.startingAssets, defaults.startingAssets),
    years,
    annualReturnRate: finiteNumber(settings?.annualReturnRate, defaults.annualReturnRate),
    inflationRate: finiteNumber(settings?.inflationRate, defaults.inflationRate),
    periods
  };
};

const normalizeReview = (review: ReviewNote): ReviewNote => ({
  id: review.id || crypto.randomUUID(),
  date: review.date || new Date().toISOString().slice(0, 10),
  reviewType: review.reviewType === "quarterly" ? "quarterly" : "monthly",
  plannedNetAssets: finiteOptionalNumber(review.plannedNetAssets),
  plannedMonthlySavings: finiteOptionalNumber(review.plannedMonthlySavings),
  actualNetAssets: finiteOptionalNumber(review.actualNetAssets),
  actualMonthlySavings: finiteOptionalNumber(review.actualMonthlySavings),
  todo: review.todo || "",
  todoDone: Boolean(review.todoDone),
  memo: review.memo || ""
});

const normalizeScenarioSnapshot = (snapshot: ScenarioSnapshot | undefined): ScenarioSnapshot => ({
  household: snapshot?.household || defaultPlan.household,
  assets: snapshot?.assets || defaultPlan.assets,
  goals: Array.isArray(snapshot?.goals) ? snapshot.goals.map(normalizeGoal) : [],
  events: Array.isArray(snapshot?.events) ? snapshot.events.map(normalizeEvent) : [],
  simulation: snapshot?.simulation || defaultPlan.simulation
});

const normalizeScenario = (scenario: PlanScenario): PlanScenario => ({
  id: scenario.id || crypto.randomUUID(),
  name: scenario.name || "シナリオ",
  description: scenario.description || "",
  tag: scenario.tag || "custom",
  createdAt: scenario.createdAt || new Date().toISOString(),
  snapshot: normalizeScenarioSnapshot(scenario.snapshot)
});

const normalizeFixedCostItem = (item: FixedCostItem): FixedCostItem => ({
  id: item.id || crypto.randomUUID(),
  name: item.name || "見直し項目",
  category: item.category || "other",
  currentMonthlyCost: typeof item.currentMonthlyCost === "number" && Number.isFinite(item.currentMonthlyCost) ? item.currentMonthlyCost : 0,
  revisedMonthlyCost: typeof item.revisedMonthlyCost === "number" && Number.isFinite(item.revisedMonthlyCost) ? item.revisedMonthlyCost : 0,
  memo: item.memo || ""
});

const normalizeActuals = (actuals: unknown) => {
  if (!actuals || typeof actuals !== "object" || Array.isArray(actuals)) return {};
  return Object.entries(actuals as Record<string, unknown>).reduce<Record<string, number>>((result, [key, value]) => {
    if (/^\d{4}-\d{2}$/.test(key) && typeof value === "number" && Number.isFinite(value)) {
      result[key] = value;
    }
    return result;
  }, {});
};

const normalizeBudgetCategory = (category: unknown): BudgetCategory =>
  typeof category === "string" && budgetCategories.includes(category as BudgetCategory) ? (category as BudgetCategory) : "other";

const normalizeBudgetFrequency = (frequency: unknown): BudgetFrequency =>
  typeof frequency === "string" && budgetFrequencies.includes(frequency as BudgetFrequency)
    ? (frequency as BudgetFrequency)
    : "monthlyVariable";

const normalizeBudgetItem = (item: BudgetItem): BudgetItem => ({
  id: item.id || crypto.randomUUID(),
  name: item.name || "予算項目",
  category: normalizeBudgetCategory(item.category),
  frequency: normalizeBudgetFrequency(item.frequency),
  budgetAmount: typeof item.budgetAmount === "number" && Number.isFinite(item.budgetAmount) ? item.budgetAmount : 0,
  actuals: normalizeActuals(item.actuals),
  memo: item.memo || ""
});
