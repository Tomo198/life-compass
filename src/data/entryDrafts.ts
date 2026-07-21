import type { CashflowPeriodDraft, GoalDraft, Household, LifeEventDraft } from "../types";

export const createGoalDraft = (): GoalDraft => ({
  title: "",
  goalType: "oneTime",
  dueYear: new Date().getFullYear() + 3,
  dueMonth: 12,
  requiredAmount: 0,
  savedAmount: 0,
  monthlyAllocation: 0,
  recurrence: "yearly",
  priority: "medium",
  memo: ""
});

export const createEventDraft = (): LifeEventDraft => ({
  title: "",
  owner: "household",
  category: "other",
  year: new Date().getFullYear() + 1,
  month: new Date().getMonth() + 1,
  amount: 0,
  cashflowType: "neutral",
  memo: ""
});

export const createCashflowPeriodDraft = (household: Household): CashflowPeriodDraft => {
  const startYear = new Date().getFullYear() + 1;
  return {
    title: "将来の収支変更",
    owner: "household",
    target: "monthlyIncome",
    startYear,
    endYear: startYear,
    amount: household.monthlyIncome,
    memo: ""
  };
};
