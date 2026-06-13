import { defaultPlan } from "../data/defaultPlan";
import type { Goal, LifeEvent, LifePlan, ReviewNote } from "../types";

const STORAGE_KEY = "life-compass-plan-v1";

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
    notes: {
      general: plan.notes?.general || "",
      spendingReview: plan.notes?.spendingReview || ""
    },
    reviews: Array.isArray(plan.reviews) ? plan.reviews.map(normalizeReview) : [],
    updatedAt: new Date().toISOString()
  };
};

const normalizeMonth = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(12, Math.round(value)));
};

const normalizeEvent = (event: LifeEvent): LifeEvent => ({
  ...event,
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

const normalizeReview = (review: ReviewNote): ReviewNote => ({
  id: review.id || crypto.randomUUID(),
  date: review.date || new Date().toISOString().slice(0, 10),
  plannedNetAssets: finiteOptionalNumber(review.plannedNetAssets),
  plannedMonthlySavings: finiteOptionalNumber(review.plannedMonthlySavings),
  actualNetAssets: finiteOptionalNumber(review.actualNetAssets),
  actualMonthlySavings: finiteOptionalNumber(review.actualMonthlySavings),
  memo: review.memo || ""
});
