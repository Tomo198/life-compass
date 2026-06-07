import type {
  Assets,
  Goal,
  Household,
  LifeEvent,
  LifePlan,
  Profile,
  RecurrenceInterval,
  SimulationSettings,
  ViewKey
} from "../types";

export type CashflowSummary = {
  monthlyIncome: number;
  annualIncome: number;
  monthlyLivingCost: number;
  annualLivingCost: number;
  monthlySavings: number;
  savingsRate: number;
};

export type EmergencyFundResult = {
  lowerMonths: number;
  upperMonths: number;
  lowerAmount: number;
  upperAmount: number;
  shortageToLower: number;
  monthsToLower: number | null;
  status: "within" | "short" | "above";
  note: string;
};

export type ProjectionPoint = {
  year: number;
  age: number;
  value: number;
};

export type AnnualProjectionRow = ProjectionPoint & {
  annualSavings: number;
  eventImpact: number;
  eventTitles: string[];
};

export type ContributionResult = {
  finalValue: number;
  totalContribution: number;
  noReturnValue: number;
  increasedByTenThousand: number;
  rateComparisons: { rate: number; value: number }[];
};

export type GoalAchievement = {
  goalId: string;
  status: "achieved" | "reachable" | "unreachable" | "recurring";
  targetAge: number | null;
  targetYear: number | null;
  shortfall: number;
  annualRequiredAmount: number;
  monthlyRequiredAmount: number;
  monthsToTarget: number | null;
  note: string;
};

export const yen = (value: number) =>
  new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0
  }).format(Math.round(value || 0));

export const manYen = (value: number) => {
  const rounded = Math.round((value || 0) / 10000);
  return `${new Intl.NumberFormat("ja-JP").format(rounded)}万円`;
};

export const percent = (value: number) => `${Math.round((value || 0) * 10) / 10}%`;

export const getCashflowSummary = (household: Household): CashflowSummary => {
  const monthlyIncome = household.monthlyIncome + household.sideIncome;
  const annualIncome = monthlyIncome * 12 + household.annualBonus;
  const monthlyLivingCost = household.fixedCost + household.variableCost + household.annualSpecialCost / 12;
  const annualLivingCost = monthlyLivingCost * 12;
  const monthlySavings = monthlyIncome - monthlyLivingCost;
  const savingsRate = monthlyIncome > 0 ? (monthlySavings / monthlyIncome) * 100 : 0;

  return {
    monthlyIncome,
    annualIncome,
    monthlyLivingCost,
    annualLivingCost,
    monthlySavings,
    savingsRate
  };
};

export const getAssetSummary = (assets: Assets) => {
  const grossAssets = assets.cash + assets.investment + assets.other;
  const netAssets = grossAssets - assets.debt;
  return { grossAssets, netAssets };
};

const isFamilyHousehold = (profile: Profile) =>
  profile.familyType === "couple" || profile.familyType === "children" || profile.familyType === "care";

export const getEmergencyFundMonths = (profile: Profile): { lower: number; upper: number; note: string } => {
  if (profile.workStyle === "freelance" || profile.workStyle === "selfEmployed" || profile.workStyle === "variable") {
    return { lower: 12, upper: 12, note: "収入変動が大きい働き方のため、12ヶ月分を目安にしています。" };
  }

  if (profile.housing === "mortgage") {
    return { lower: 9, upper: 12, note: "住宅ローンがある前提として、9〜12ヶ月分を目安にしています。" };
  }

  if (profile.workStyle === "employee" && isFamilyHousehold(profile)) {
    return { lower: 9, upper: 9, note: "会社員で家族ありの前提として、9ヶ月分を目安にしています。" };
  }

  if (profile.workStyle === "employee" && profile.familyType === "single") {
    return { lower: 6, upper: 6, note: "会社員・単身の前提として、6ヶ月分を目安にしています。" };
  }

  return { lower: 6, upper: 12, note: "家族構成と働き方から、6〜12ヶ月分を目安にしています。" };
};

export const getEmergencyFundResult = (plan: LifePlan): EmergencyFundResult => {
  const cashflow = getCashflowSummary(plan.household);
  const months = getEmergencyFundMonths(plan.profile);
  const lowerAmount = cashflow.monthlyLivingCost * months.lower;
  const upperAmount = cashflow.monthlyLivingCost * months.upper;
  const shortageToLower = Math.max(0, lowerAmount - plan.assets.cash);
  const monthsToLower =
    shortageToLower > 0 && cashflow.monthlySavings > 0 ? Math.ceil(shortageToLower / cashflow.monthlySavings) : null;
  const status = plan.assets.cash < lowerAmount ? "short" : plan.assets.cash > upperAmount ? "above" : "within";

  return {
    lowerMonths: months.lower,
    upperMonths: months.upper,
    lowerAmount,
    upperAmount,
    shortageToLower,
    monthsToLower,
    status,
    note: months.note
  };
};

const eventImpactForYear = (events: LifeEvent[], year: number) =>
  events
    .filter((event) => event.year === year)
    .reduce((total, event) => {
      if (event.cashflowType === "income") return total + event.amount;
      if (event.cashflowType === "expense") return total - event.amount;
      return total;
    }, 0);

const eventsForYear = (events: LifeEvent[], year: number) => events.filter((event) => event.year === year);

export const projectAssets = (plan: LifePlan, years: number): ProjectionPoint[] => {
  const cashflow = getCashflowSummary(plan.household);
  const { netAssets } = getAssetSummary(plan.assets);
  const monthlyRate = plan.simulation.annualReturnRate / 100 / 12;
  const startYear = new Date().getFullYear();
  let value = netAssets;
  const points: ProjectionPoint[] = [{ year: startYear, age: plan.profile.age, value }];

  for (let yearOffset = 1; yearOffset <= years; yearOffset += 1) {
    const year = startYear + yearOffset;
    for (let month = 0; month < 12; month += 1) {
      value = value * (1 + monthlyRate) + cashflow.monthlySavings;
    }
    value += eventImpactForYear(plan.events, year);
    points.push({ year, age: plan.profile.age + yearOffset, value });
  }

  return points;
};

export const getAnnualProjectionRows = (plan: LifePlan, years: number): AnnualProjectionRow[] => {
  const cashflow = getCashflowSummary(plan.household);
  const projection = projectAssets(plan, years);

  return projection.map((point, index) => {
    const yearEvents = eventsForYear(plan.events, point.year);
    return {
      ...point,
      annualSavings: index === 0 ? 0 : cashflow.monthlySavings * 12,
      eventImpact: index === 0 ? 0 : eventImpactForYear(plan.events, point.year),
      eventTitles: yearEvents.map((event) => event.title)
    };
  });
};

export const getGoalAchievement = (plan: LifePlan, goal: Goal): GoalAchievement => {
  if (goal.goalType === "recurring") {
    const occurrences = getRecurrenceCountPerYear(goal.recurrence);
    const annualRequiredAmount = goal.requiredAmount * occurrences;
    return {
      goalId: goal.id,
      status: "recurring",
      targetAge: plan.profile.age + Math.max(0, goal.dueYear - new Date().getFullYear()),
      targetYear: goal.dueYear,
      shortfall: Math.max(0, goal.requiredAmount - goal.savedAmount),
      annualRequiredAmount,
      monthlyRequiredAmount: Math.ceil(annualRequiredAmount / 12),
      monthsToTarget: null,
      note: `1回あたり${manYen(goal.requiredAmount)}を${getRecurrenceLabel(goal.recurrence)}の目標として整理します。`
    };
  }

  const shortfall = Math.max(0, goal.requiredAmount - goal.savedAmount);

  if (shortfall === 0) {
    return {
      goalId: goal.id,
      status: "achieved",
      targetAge: plan.profile.age,
      targetYear: new Date().getFullYear(),
      shortfall: 0,
      annualRequiredAmount: 0,
      monthlyRequiredAmount: 0,
      monthsToTarget: 0,
      note: "達成済み額が目標額に達しています。"
    };
  }

  if (goal.monthlyAllocation <= 0) {
    return {
      goalId: goal.id,
      status: "unreachable",
      targetAge: null,
      targetYear: null,
      shortfall,
      annualRequiredAmount: 0,
      monthlyRequiredAmount: 0,
      monthsToTarget: null,
      note: "毎月この目標に回す額を入力すると達成目安を表示できます。"
    };
  }

  const monthsToTarget = Math.ceil(shortfall / goal.monthlyAllocation);
  const yearsToTarget = Math.ceil(monthsToTarget / 12);
  const targetAge = plan.profile.age + yearsToTarget;
  const targetYear = new Date().getFullYear() + yearsToTarget;

  return {
    goalId: goal.id,
    status: "reachable",
    targetAge,
    targetYear,
    shortfall,
    annualRequiredAmount: 0,
    monthlyRequiredAmount: goal.monthlyAllocation,
    monthsToTarget,
    note: `達成済み額と毎月${manYen(goal.monthlyAllocation)}をこの目標に回す前提の目安です。`
  };
};

export const getGoalAchievements = (plan: LifePlan) =>
  plan.goals.map((goal) => ({
    goal,
    achievement: getGoalAchievement(plan, goal)
  }));

export const getInputCompletion = (plan: LifePlan) => {
  const items: { label: string; complete: boolean; view: ViewKey }[] = [
    { label: "基本プロフィール", complete: Boolean(plan.profile.name && plan.profile.age > 0), view: "profile" },
    { label: "家計", complete: plan.household.monthlyIncome > 0 || plan.household.sideIncome > 0, view: "household" },
    { label: "生活費", complete: plan.household.fixedCost > 0 || plan.household.variableCost > 0, view: "household" },
    { label: "資産", complete: plan.assets.cash > 0 || plan.assets.investment > 0 || plan.assets.other > 0, view: "assets" },
    { label: "目標", complete: plan.goals.length > 0, view: "goals" },
    { label: "ライフイベント", complete: plan.events.length > 0, view: "timeline" },
    { label: "メモ", complete: Boolean(plan.notes?.general || plan.notes?.spendingReview), view: "notes" }
  ];
  const completed = items.filter((item) => item.complete).length;

  return {
    items,
    completed,
    total: items.length,
    percentage: Math.round((completed / items.length) * 100)
  };
};

export const getRecurrenceCountPerYear = (recurrence: RecurrenceInterval) => {
  const counts: Record<RecurrenceInterval, number> = {
    monthly: 12,
    quarterly: 4,
    halfYearly: 2,
    yearly: 1
  };
  return counts[recurrence];
};

export const getRecurrenceLabel = (recurrence: RecurrenceInterval) => {
  const labels: Record<RecurrenceInterval, string> = {
    monthly: "毎月",
    quarterly: "3ヶ月に1回",
    halfYearly: "半年に1回",
    yearly: "年1回"
  };
  return labels[recurrence];
};

const futureContributionValue = (settings: SimulationSettings, rate: number, monthlyIncrease = 0) => {
  const monthlyRate = rate / 100 / 12;
  let value = 0;
  const months = settings.years * 12;
  for (let month = 1; month <= months; month += 1) {
    value = value * (1 + monthlyRate) + settings.monthlyContribution + monthlyIncrease;
    if (month % 12 === 0) {
      value += settings.bonusContribution;
    }
  }
  return value;
};

export const simulateContribution = (settings: SimulationSettings): ContributionResult => {
  const totalContribution = settings.monthlyContribution * settings.years * 12 + settings.bonusContribution * settings.years;
  const finalValue = futureContributionValue(settings, settings.annualReturnRate);
  const noReturnValue = futureContributionValue(settings, 0);
  const increasedByTenThousand = futureContributionValue(settings, settings.annualReturnRate, 10000);
  const rateComparisons = [0, 2, 4, 6].map((rate) => ({ rate, value: futureContributionValue(settings, rate) }));

  return {
    finalValue,
    totalContribution,
    noReturnValue,
    increasedByTenThousand,
    rateComparisons
  };
};

export const getNextEvent = (events: LifeEvent[]) => {
  const currentYear = new Date().getFullYear();
  return [...events].filter((event) => event.year >= currentYear).sort((a, b) => a.year - b.year)[0];
};

export const getPrimaryGoal = (plan: LifePlan) =>
  [...plan.goals].sort((a, b) => {
    const priorityWeight = { high: 0, medium: 1, low: 2 };
    return priorityWeight[a.priority] - priorityWeight[b.priority] || a.dueYear - b.dueYear;
  })[0];
