import type {
  Assets,
  BudgetCategory,
  BudgetFrequency,
  BudgetItem,
  FixedCostItem,
  Goal,
  Household,
  LifeEvent,
  LifePlan,
  PlanScenario,
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
  returnImpact: number;
  eventTitles: string[];
};

export type MonthlyProjectionRow = ProjectionPoint & {
  month: number;
  monthIndex: number;
  label: string;
  monthlySavings: number;
  eventImpact: number;
  returnImpact: number;
  eventTitles: string[];
};

export type ContributionResult = {
  finalValue: number;
  totalContribution: number;
  noReturnValue: number;
  increasedByTenThousand: number;
  rateComparisons: { rate: number; value: number }[];
};

export type ContributionProjectionRow = {
  year: number;
  contribution: number;
  value: number;
  returnImpact: number;
};

export type VariabilityProjectionRow = {
  yearIndex: number;
  label: string;
  lower: number;
  median: number;
  upper: number;
};

export type VariabilityResult = {
  rows: VariabilityProjectionRow[];
  lowerFinal: number;
  medianFinal: number;
  upperFinal: number;
  depletionRate: number;
  medianDepletedAge: number | null;
};

export type WithdrawalPhase = {
  label: string;
  startAge: number;
  endAge: number;
  monthlyIncome: number;
  monthlyLivingCost: number;
  annualExtraExpense: number;
};

export type WithdrawalSettings = {
  startAge: number;
  currentAssets: number;
  monthlyLivingCost: number;
  monthlyPension: number;
  annualReturnRate: number;
  inflationRate: number;
  years: number;
  phases?: WithdrawalPhase[];
};

export type WithdrawalProjectionRow = {
  age: number;
  yearIndex: number;
  phaseLabel?: string;
  assets: number;
  annualLivingCost: number;
  annualPension: number;
  withdrawalAmount: number;
  returnImpact: number;
};

export type WithdrawalResult = {
  rows: WithdrawalProjectionRow[];
  depletedAge: number | null;
  finalAssets: number;
};

export type RetirementProjectionRow = {
  age: number;
  year: number;
  yearIndex: number;
  assets: number;
  annualLivingCost: number;
  annualSocialInsuranceAndTax: number;
  annualRetirementIncome: number;
  withdrawalAmount: number;
  returnImpact: number;
};

export type RetirementPlanResult = {
  startAge: number;
  retirementStartAssets: number;
  firstYearTotalCost: number;
  firstYearIncome: number;
  firstYearWithdrawal: number;
  depletedAge: number | null;
  finalAssets: number;
  rows: RetirementProjectionRow[];
};

export type BudgetCategorySummary = {
  category: BudgetCategory;
  plannedMonthlyAverage: number;
  actual: number;
  variance: number;
};

export type BudgetSummary = {
  plannedMonthlyAverage: number;
  actual: number;
  variance: number;
  annualPlan: number;
  fixedCost: number;
  variableCost: number;
  annualSpecialCost: number;
  categoryRows: BudgetCategorySummary[];
};

export type FixedCostImpact = {
  monthlyImprovement: number;
  annualImprovement: number;
  tenYearSimpleImpact: number;
  thirtyYearSimpleImpact: number;
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

export const buildPlanFromScenario = (basePlan: LifePlan, scenario: PlanScenario): LifePlan => ({
  ...basePlan,
  household: scenario.snapshot.household,
  assets: scenario.snapshot.assets,
  goals: scenario.snapshot.goals,
  events: scenario.snapshot.events,
  simulation: scenario.snapshot.simulation
});

export const getFixedCostImpact = (items: FixedCostItem[]): FixedCostImpact => {
  const monthlyImprovement = items.reduce(
    (total, item) => total + Math.max(0, item.currentMonthlyCost - item.revisedMonthlyCost),
    0
  );
  const annualImprovement = monthlyImprovement * 12;

  return {
    monthlyImprovement,
    annualImprovement,
    tenYearSimpleImpact: annualImprovement * 10,
    thirtyYearSimpleImpact: annualImprovement * 30
  };
};

export const getBudgetAnnualPlan = (item: BudgetItem) => {
  if (item.frequency === "monthlyFixed" || item.frequency === "monthlyVariable") return item.budgetAmount * 12;
  return item.budgetAmount;
};

export const getBudgetMonthlyAverage = (item: BudgetItem) => getBudgetAnnualPlan(item) / 12;

export const getBudgetHouseholdInputs = (items: BudgetItem[]) => {
  const fixedCost = items
    .filter((item) => item.frequency === "monthlyFixed")
    .reduce((total, item) => total + item.budgetAmount, 0);
  const variableCost = items
    .filter((item) => item.frequency === "monthlyVariable")
    .reduce((total, item) => total + item.budgetAmount, 0);
  const annualSpecialCost = items
    .filter(
      (item) =>
        item.frequency !== "monthlyFixed" && item.frequency !== "monthlyVariable" && item.frequency !== "oneTime"
    )
    .reduce((total, item) => total + getBudgetAnnualPlan(item), 0);

  return { fixedCost, variableCost, annualSpecialCost };
};

export const getBudgetSummary = (items: BudgetItem[], monthKey: string): BudgetSummary => {
  const categoryMap = new Map<BudgetCategory, BudgetCategorySummary>();
  const householdInputs = getBudgetHouseholdInputs(items);

  items.forEach((item) => {
    const plannedMonthlyAverage = getBudgetMonthlyAverage(item);
    const actual = item.actuals?.[monthKey] || 0;
    const current = categoryMap.get(item.category) || {
      category: item.category,
      plannedMonthlyAverage: 0,
      actual: 0,
      variance: 0
    };
    current.plannedMonthlyAverage += plannedMonthlyAverage;
    current.actual += actual;
    current.variance = current.actual - current.plannedMonthlyAverage;
    categoryMap.set(item.category, current);
  });

  const plannedMonthlyAverage = items.reduce((total, item) => total + getBudgetMonthlyAverage(item), 0);
  const actual = items.reduce((total, item) => total + (item.actuals?.[monthKey] || 0), 0);

  return {
    plannedMonthlyAverage,
    actual,
    variance: actual - plannedMonthlyAverage,
    annualPlan: items.reduce((total, item) => total + getBudgetAnnualPlan(item), 0),
    ...householdInputs,
    categoryRows: [...categoryMap.values()].sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))
  };
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

const eventImpactForMonth = (events: LifeEvent[], year: number, month: number) =>
  events
    .filter((event) => event.year === year && event.month === month)
    .reduce((total, event) => {
      if (event.cashflowType === "income") return total + event.amount;
      if (event.cashflowType === "expense") return total - event.amount;
      return total;
    }, 0);

const eventsForMonth = (events: LifeEvent[], year: number, month: number) =>
  events.filter((event) => event.year === year && event.month === month);

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
    const annualSavings = index === 0 ? 0 : cashflow.monthlySavings * 12;
    const eventImpact = index === 0 ? 0 : eventImpactForYear(plan.events, point.year);
    const previousValue = projection[index - 1]?.value ?? point.value;
    const returnImpact = index === 0 ? 0 : point.value - previousValue - annualSavings - eventImpact;
    return {
      ...point,
      annualSavings,
      eventImpact,
      returnImpact,
      eventTitles: yearEvents.map((event) => event.title)
    };
  });
};

export const getMonthlyProjectionRows = (plan: LifePlan, months: number): MonthlyProjectionRow[] => {
  const cashflow = getCashflowSummary(plan.household);
  const { netAssets } = getAssetSummary(plan.assets);
  const monthlyRate = plan.simulation.annualReturnRate / 100 / 12;
  const startDate = new Date();
  let value = netAssets;

  const rows: MonthlyProjectionRow[] = [];

  for (let monthOffset = 0; monthOffset <= months; monthOffset += 1) {
    const targetDate = new Date(startDate.getFullYear(), startDate.getMonth() + monthOffset, 1);
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth() + 1;
    const age = plan.profile.age + Math.floor(monthOffset / 12);
    const previousValue = rows[monthOffset - 1]?.value ?? value;
    const eventImpact = monthOffset === 0 ? 0 : eventImpactForMonth(plan.events, year, month);
    const monthEvents = monthOffset === 0 ? [] : eventsForMonth(plan.events, year, month);
    const monthlySavings = monthOffset === 0 ? 0 : cashflow.monthlySavings;

    if (monthOffset > 0) {
      value = value * (1 + monthlyRate) + cashflow.monthlySavings + eventImpact;
    }

    rows.push({
      year,
      month,
      monthIndex: monthOffset,
      label: `${year}/${String(month).padStart(2, "0")}`,
      age,
      value,
      monthlySavings,
      eventImpact,
      returnImpact: monthOffset === 0 ? 0 : value - previousValue - monthlySavings - eventImpact,
      eventTitles: monthEvents.map((event) => event.title)
    });
  }

  return rows;
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export const getGoalPreparedPercent = (goal: Goal) => {
  if (goal.goalType === "recurring") {
    const annualRequiredAmount = goal.requiredAmount * getRecurrenceCountPerYear(goal.recurrence);
    if (annualRequiredAmount <= 0) return 0;
    return clampPercent(((goal.monthlyAllocation * 12) / annualRequiredAmount) * 100);
  }

  if (goal.requiredAmount <= 0) return goal.savedAmount > 0 ? 100 : 0;
  return clampPercent((goal.savedAmount / goal.requiredAmount) * 100);
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

export const getContributionProjectionRows = (settings: SimulationSettings): ContributionProjectionRow[] => {
  const rows: ContributionProjectionRow[] = [];
  const monthlyRate = settings.annualReturnRate / 100 / 12;
  let value = 0;
  let totalContribution = 0;

  for (let year = 1; year <= settings.years; year += 1) {
    const previousValue = value;
    const annualContribution = settings.monthlyContribution * 12 + settings.bonusContribution;
    for (let month = 1; month <= 12; month += 1) {
      value = value * (1 + monthlyRate) + settings.monthlyContribution;
      if (month === 12) value += settings.bonusContribution;
    }
    totalContribution += annualContribution;
    rows.push({
      year,
      contribution: totalContribution,
      value,
      returnImpact: value - previousValue - annualContribution
    });
  }

  return rows;
};

const percentile = (values: number[], ratio: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)));
  return sorted[index];
};

const createSeededRandom = (seed: number) => {
  let state = seed || 1;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
};

const sampleNormal = (random: () => number) => {
  const first = Math.max(random(), 0.000001);
  const second = Math.max(random(), 0.000001);
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
};

export const simulateContributionVariability = (
  settings: SimulationSettings,
  annualVolatilityRate = 12,
  trials = 300
): VariabilityResult => {
  const yearlyValues: number[][] = Array.from({ length: settings.years }, () => []);

  for (let trial = 0; trial < trials; trial += 1) {
    const random = createSeededRandom(1000 + trial * 37 + Math.round(settings.annualReturnRate * 100));
    let value = 0;

    for (let year = 1; year <= settings.years; year += 1) {
      const sampledAnnualRate = (settings.annualReturnRate + sampleNormal(random) * annualVolatilityRate) / 100;
      const monthlyRate = sampledAnnualRate / 12;
      for (let month = 1; month <= 12; month += 1) {
        value = value * (1 + monthlyRate) + settings.monthlyContribution;
        if (month === 12) value += settings.bonusContribution;
      }
      yearlyValues[year - 1].push(value);
    }
  }

  const rows = yearlyValues.map((values, index) => ({
    yearIndex: index + 1,
    label: `${index + 1}年目`,
    lower: percentile(values, 0.1),
    median: percentile(values, 0.5),
    upper: percentile(values, 0.9)
  }));

  return {
    rows,
    lowerFinal: rows[rows.length - 1]?.lower ?? 0,
    medianFinal: rows[rows.length - 1]?.median ?? 0,
    upperFinal: rows[rows.length - 1]?.upper ?? 0,
    depletionRate: 0,
    medianDepletedAge: null
  };
};

const normalizeWithdrawalPhases = (settings: WithdrawalSettings): WithdrawalPhase[] => {
  if (!settings.phases || settings.phases.length === 0) {
    return [
      {
        label: "基本期間",
        startAge: settings.startAge,
        endAge: settings.startAge + settings.years - 1,
        monthlyIncome: settings.monthlyPension,
        monthlyLivingCost: settings.monthlyLivingCost,
        annualExtraExpense: 0
      }
    ];
  }

  return settings.phases
    .map((phase) => ({
      ...phase,
      startAge: Math.min(phase.startAge, phase.endAge),
      endAge: Math.max(phase.startAge, phase.endAge),
      monthlyIncome: Math.max(0, phase.monthlyIncome),
      monthlyLivingCost: Math.max(0, phase.monthlyLivingCost),
      annualExtraExpense: Math.max(0, phase.annualExtraExpense)
    }))
    .sort((a, b) => a.startAge - b.startAge);
};

const getWithdrawalPhaseForAge = (settings: WithdrawalSettings, age: number) => {
  const phases = normalizeWithdrawalPhases(settings);
  return phases.find((phase) => age >= phase.startAge && age <= phase.endAge) ?? phases[phases.length - 1];
};

export const simulateWithdrawal = (settings: WithdrawalSettings): WithdrawalResult => {
  const rows: WithdrawalProjectionRow[] = [];
  const annualReturnRate = settings.annualReturnRate / 100;
  const inflationRate = settings.inflationRate / 100;
  let assets = settings.currentAssets;
  let depletedAge: number | null = null;

  for (let yearIndex = 1; yearIndex <= settings.years; yearIndex += 1) {
    const age = settings.startAge + yearIndex - 1;
    const phase = getWithdrawalPhaseForAge(settings, age);
    const annualLivingCost =
      (phase.monthlyLivingCost * 12 + phase.annualExtraExpense) * (1 + inflationRate) ** (yearIndex - 1);
    const annualPension = phase.monthlyIncome * 12;
    const withdrawalAmount = Math.max(0, annualLivingCost - annualPension);
    const beforeReturn = assets - withdrawalAmount;
    const returnImpact = beforeReturn * annualReturnRate;
    assets = beforeReturn + returnImpact;

    if (assets <= 0 && depletedAge === null) {
      depletedAge = age;
    }

    rows.push({
      age,
      yearIndex,
      phaseLabel: phase.label,
      assets,
      annualLivingCost,
      annualPension,
      withdrawalAmount,
      returnImpact
    });
  }

  return {
    rows,
    depletedAge,
    finalAssets: rows[rows.length - 1]?.assets ?? settings.currentAssets
  };
};

export const simulateWithdrawalVariability = (
  settings: WithdrawalSettings,
  annualVolatilityRate = 12,
  trials = 300
): VariabilityResult => {
  const yearlyValues: number[][] = Array.from({ length: settings.years }, () => []);
  const depletedAges: number[] = [];
  const inflationRate = settings.inflationRate / 100;

  for (let trial = 0; trial < trials; trial += 1) {
    const random = createSeededRandom(2000 + trial * 53 + Math.round(settings.annualReturnRate * 100));
    let assets = settings.currentAssets;
    let depletedAge: number | null = null;

    for (let yearIndex = 1; yearIndex <= settings.years; yearIndex += 1) {
      const age = settings.startAge + yearIndex - 1;
      const phase = getWithdrawalPhaseForAge(settings, age);
      const annualLivingCost =
        (phase.monthlyLivingCost * 12 + phase.annualExtraExpense) * (1 + inflationRate) ** (yearIndex - 1);
      const annualPension = phase.monthlyIncome * 12;
      const withdrawalAmount = Math.max(0, annualLivingCost - annualPension);
      const sampledAnnualRate = (settings.annualReturnRate + sampleNormal(random) * annualVolatilityRate) / 100;
      assets = (assets - withdrawalAmount) * (1 + sampledAnnualRate);

      if (assets <= 0 && depletedAge === null) {
        depletedAge = age;
      }
      yearlyValues[yearIndex - 1].push(assets);
    }

    if (depletedAge !== null) depletedAges.push(depletedAge);
  }

  const rows = yearlyValues.map((values, index) => ({
    yearIndex: index + 1,
    label: `${settings.startAge + index}歳`,
    lower: percentile(values, 0.1),
    median: percentile(values, 0.5),
    upper: percentile(values, 0.9)
  }));

  return {
    rows,
    lowerFinal: rows[rows.length - 1]?.lower ?? settings.currentAssets,
    medianFinal: rows[rows.length - 1]?.median ?? settings.currentAssets,
    upperFinal: rows[rows.length - 1]?.upper ?? settings.currentAssets,
    depletionRate: trials > 0 ? (depletedAges.length / trials) * 100 : 0,
    medianDepletedAge: depletedAges.length > 0 ? percentile(depletedAges, 0.5) : null
  };
};

export const simulateRetirementPlan = (plan: LifePlan): RetirementPlanResult => {
  const settings = plan.retirementPlan;
  const startAge = Math.max(plan.profile.age, settings.retirementAge);
  const yearsToStart = Math.max(0, startAge - plan.profile.age);
  const projectedAssets = projectAssets(plan, yearsToStart);
  const retirementStartAssets = (projectedAssets[yearsToStart]?.value ?? getAssetSummary(plan.assets).netAssets) + settings.retirementLumpSum;
  const simulationYears = Math.max(1, settings.planUntilAge - startAge + 1);
  const startYear = new Date().getFullYear() + yearsToStart;
  const annualReturnRate = settings.annualReturnRate / 100;
  const inflationRate = settings.inflationRate / 100;
  const rows: RetirementProjectionRow[] = [];
  let assets = retirementStartAssets;
  let depletedAge: number | null = null;

  for (let index = 0; index < simulationYears; index += 1) {
    const inflationFactor = (1 + inflationRate) ** index;
    const annualLivingCost =
      (settings.monthlyLivingCost + settings.monthlyHousingCost + settings.monthlyMedicalCost + settings.monthlyCareCost) *
        12 *
        inflationFactor +
      settings.annualExtraExpense * inflationFactor;
    const annualSocialInsuranceAndTax =
      (settings.monthlyHealthInsurance + settings.monthlyLongTermCareInsurance + settings.monthlyTaxes) *
      12 *
      inflationFactor;
    const annualRetirementIncome =
      (settings.monthlyPublicPension + settings.monthlyPrivatePension + settings.monthlyOtherIncome) * 12;
    const withdrawalAmount = Math.max(0, annualLivingCost + annualSocialInsuranceAndTax - annualRetirementIncome);
    const beforeReturn = assets - withdrawalAmount;
    const returnImpact = beforeReturn * annualReturnRate;
    assets = beforeReturn + returnImpact;

    if (assets <= 0 && depletedAge === null) {
      depletedAge = startAge + index;
    }

    rows.push({
      age: startAge + index,
      year: startYear + index,
      yearIndex: index + 1,
      assets,
      annualLivingCost,
      annualSocialInsuranceAndTax,
      annualRetirementIncome,
      withdrawalAmount,
      returnImpact
    });
  }

  return {
    startAge,
    retirementStartAssets,
    firstYearTotalCost: (rows[0]?.annualLivingCost ?? 0) + (rows[0]?.annualSocialInsuranceAndTax ?? 0),
    firstYearIncome: rows[0]?.annualRetirementIncome ?? 0,
    firstYearWithdrawal: rows[0]?.withdrawalAmount ?? 0,
    depletedAge,
    finalAssets: rows[rows.length - 1]?.assets ?? retirementStartAssets,
    rows
  };
};

export const simulateRetirementPlanVariability = (
  plan: LifePlan,
  annualVolatilityRate = 10,
  trials = 300
): VariabilityResult => {
  const settings = plan.retirementPlan;
  const startAge = Math.max(plan.profile.age, settings.retirementAge);
  const yearsToStart = Math.max(0, startAge - plan.profile.age);
  const projectedAssets = projectAssets(plan, yearsToStart);
  const retirementStartAssets = (projectedAssets[yearsToStart]?.value ?? getAssetSummary(plan.assets).netAssets) + settings.retirementLumpSum;
  const simulationYears = Math.max(1, settings.planUntilAge - startAge + 1);
  const yearlyValues: number[][] = Array.from({ length: simulationYears }, () => []);
  const depletedAges: number[] = [];
  const inflationRate = settings.inflationRate / 100;

  for (let trial = 0; trial < trials; trial += 1) {
    const random = createSeededRandom(3000 + trial * 71 + Math.round(settings.annualReturnRate * 100));
    let assets = retirementStartAssets;
    let depletedAge: number | null = null;

    for (let index = 0; index < simulationYears; index += 1) {
      const age = startAge + index;
      const inflationFactor = (1 + inflationRate) ** index;
      const annualLivingCost =
        (settings.monthlyLivingCost + settings.monthlyHousingCost + settings.monthlyMedicalCost + settings.monthlyCareCost) *
          12 *
          inflationFactor +
        settings.annualExtraExpense * inflationFactor;
      const annualSocialInsuranceAndTax =
        (settings.monthlyHealthInsurance + settings.monthlyLongTermCareInsurance + settings.monthlyTaxes) *
        12 *
        inflationFactor;
      const annualRetirementIncome =
        (settings.monthlyPublicPension + settings.monthlyPrivatePension + settings.monthlyOtherIncome) * 12;
      const withdrawalAmount = Math.max(0, annualLivingCost + annualSocialInsuranceAndTax - annualRetirementIncome);
      const sampledAnnualRate = (settings.annualReturnRate + sampleNormal(random) * annualVolatilityRate) / 100;
      assets = (assets - withdrawalAmount) * (1 + sampledAnnualRate);

      if (assets <= 0 && depletedAge === null) {
        depletedAge = age;
      }
      yearlyValues[index].push(assets);
    }

    if (depletedAge !== null) depletedAges.push(depletedAge);
  }

  const rows = yearlyValues.map((values, index) => ({
    yearIndex: index + 1,
    label: `${startAge + index}歳`,
    lower: percentile(values, 0.1),
    median: percentile(values, 0.5),
    upper: percentile(values, 0.9)
  }));

  return {
    rows,
    lowerFinal: rows[rows.length - 1]?.lower ?? retirementStartAssets,
    medianFinal: rows[rows.length - 1]?.median ?? retirementStartAssets,
    upperFinal: rows[rows.length - 1]?.upper ?? retirementStartAssets,
    depletionRate: trials > 0 ? (depletedAges.length / trials) * 100 : 0,
    medianDepletedAge: depletedAges.length > 0 ? percentile(depletedAges, 0.5) : null
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
