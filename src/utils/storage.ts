import { defaultPlan } from "../data/defaultPlan";
import {
  createSuggestedHouseholdMembers,
  householdMemberRelationshipLabels
} from "../data/householdMembers";
import {
  CURRENT_PLAN_VERSION,
  MAX_DETAILED_CASHFLOW_ITEMS,
  MAX_HOUSEHOLD_MEMBERS,
  MAX_MONEY_AMOUNT,
  MAX_PLAN_AGE,
  MAX_PLAN_REVISIONS,
  MAX_PLAN_YEAR,
  MAX_PROJECTION_YEARS,
  MAX_RATE_PERCENT,
  MAX_RECOVERY_BACKUPS,
  RECOVERY_STORAGE_KEY,
  STORAGE_KEY
} from "../config";
import type {
  BudgetCategory,
  BudgetFrequency,
  BudgetItem,
  CashflowMode,
  CashflowPeriod,
  CashflowPeriodTarget,
  CashflowType,
  DetailedCashflowItem,
  EventOwner,
  FamilyType,
  FixedCostCategory,
  FixedCostItem,
  Goal,
  GoalType,
  HouseholdMember,
  HouseholdMemberRelationship,
  Housing,
  LifeEvent,
  LifeEventCategory,
  LifePlan,
  PlanRevision,
  PlanRevisionSnapshot,
  PlanRevisionSource,
  PlanScenario,
  Priority,
  RecurrenceInterval,
  RetirementPlanSettings,
  ReviewNote,
  ScenarioSnapshot,
  ScenarioTag,
  SimulationSettings,
  TimelineMemo,
  WorkStyle,
  WithdrawalPeriodSettings,
  WithdrawalPlanSettings
} from "../types";

export type RecoveryReason = "before-import" | "before-reset" | "load-error";

export type RecoveryBackup = {
  id: string;
  createdAt: string;
  reason: RecoveryReason;
  plan: LifePlan;
};
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
const familyTypes: FamilyType[] = ["single", "couple", "children", "care", "other"];
const workStyles: WorkStyle[] = ["employee", "freelance", "selfEmployed", "variable", "retired", "other"];
const housingTypes: Housing[] = ["rent", "owned", "mortgage", "family", "other"];
const goalTypes: GoalType[] = ["oneTime", "recurring"];
const recurrenceIntervals: RecurrenceInterval[] = ["monthly", "quarterly", "halfYearly", "yearly"];
const priorities: Priority[] = ["high", "medium", "low"];
const eventOwners: EventOwner[] = ["self", "spouse", "child", "parent", "household", "other"];
const householdMemberRelationships: HouseholdMemberRelationship[] = ["self", "spouse", "child", "parent", "other"];
const eventCategories: LifeEventCategory[] = [
  "career",
  "move",
  "marriage",
  "birth",
  "home",
  "car",
  "education",
  "care",
  "sideBusiness",
  "retirement",
  "travel",
  "qualification",
  "other"
];
const cashflowTypes: CashflowType[] = ["expense", "income", "neutral"];
const cashflowModes: CashflowMode[] = ["basic", "detailed"];
const cashflowPeriodTargets: CashflowPeriodTarget[] = [
  "monthlyIncome",
  "annualBonus",
  "sideIncome",
  "fixedCost",
  "variableCost",
  "annualSpecialCost"
];
const scenarioTags: ScenarioTag[] = ["current", "spending", "career", "sideBusiness", "home", "retirement", "custom"];
const planRevisionSources: PlanRevisionSource[] = ["manual", "review", "scenarioAdoption", "beforeRestore"];
const fixedCostCategories: FixedCostCategory[] = [
  "insurance",
  "communication",
  "rent",
  "car",
  "subscription",
  "utilities",
  "loan",
  "other"
];

const stringValue = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);

const nonEmptyString = (value: unknown, fallback: string) =>
  typeof value === "string" && value.trim() ? value : fallback;

const identifierValue = (value: unknown) =>
  typeof value === "string" && value.trim() ? value : createStorageId();

const finiteNumber = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const nonNegativeNumber = (value: unknown, fallback = 0) =>
  Math.min(MAX_MONEY_AMOUNT, Math.max(0, finiteNumber(value, fallback)));

const rateInRange = (value: unknown, fallback: number, min = -MAX_RATE_PERCENT) =>
  Math.min(MAX_RATE_PERCENT, Math.max(min, finiteNumber(value, fallback)));

const integerInRange = (value: unknown, fallback: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(finiteNumber(value, fallback))));

const enumValue = <T extends string>(value: unknown, values: readonly T[], fallback: T): T =>
  typeof value === "string" && values.includes(value as T) ? (value as T) : fallback;

const normalizeTimestamp = (value: unknown) => {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return new Date().toISOString();
  return value;
};

const normalizeProfile = (profile: LifePlan["profile"] | undefined): LifePlan["profile"] => ({
  name: stringValue(profile?.name, defaultPlan.profile.name),
  age: integerInRange(profile?.age, defaultPlan.profile.age, 0, MAX_PLAN_AGE),
  familyType: enumValue(profile?.familyType, familyTypes, defaultPlan.profile.familyType),
  workStyle: enumValue(profile?.workStyle, workStyles, defaultPlan.profile.workStyle),
  housing: enumValue(profile?.housing, housingTypes, defaultPlan.profile.housing)
});

const normalizeHouseholdMembers = (
  value: HouseholdMember[] | undefined,
  profile: LifePlan["profile"],
  fallbackMembers: HouseholdMember[] = []
): HouseholdMember[] => {
  const source = Array.isArray(value) && value.length > 0
    ? value
    : fallbackMembers.length > 0
      ? fallbackMembers
      : createSuggestedHouseholdMembers(profile);
  const usedIds = new Set<string>();
  let hasPrimaryMember = false;

  const members = source.slice(0, MAX_HOUSEHOLD_MEMBERS).map((member) => {
    const relationship = enumValue(member?.relationship, householdMemberRelationships, "other");
    const normalizedRelationship = relationship === "self" && hasPrimaryMember ? "other" : relationship;
    if (normalizedRelationship === "self") hasPrimaryMember = true;

    let id = identifierValue(member?.id);
    if (usedIds.has(id)) id = createStorageId();
    usedIds.add(id);

    return {
      id,
      displayName: nonEmptyString(
        member?.displayName,
        householdMemberRelationshipLabels[normalizedRelationship]
      ),
      relationship: normalizedRelationship,
      birthYear:
        member?.birthYear === null || member?.birthYear === undefined
          ? null
          : integerInRange(member.birthYear, new Date().getFullYear(), 1900, MAX_PLAN_YEAR),
      birthMonth:
        member?.birthMonth === null || member?.birthMonth === undefined
          ? null
          : integerInRange(member.birthMonth, 1, 1, 12)
    };
  });

  if (!hasPrimaryMember) {
    const primary = createSuggestedHouseholdMembers(profile)[0];
    members.unshift({
      ...primary,
      id: usedIds.has(primary.id) ? createStorageId() : primary.id
    });
  }

  return members.slice(0, MAX_HOUSEHOLD_MEMBERS);
};

const normalizeHousehold = (household: LifePlan["household"] | undefined): LifePlan["household"] => ({
  monthlyIncome: nonNegativeNumber(household?.monthlyIncome),
  annualBonus: nonNegativeNumber(household?.annualBonus),
  sideIncome: nonNegativeNumber(household?.sideIncome),
  fixedCost: nonNegativeNumber(household?.fixedCost),
  variableCost: nonNegativeNumber(household?.variableCost),
  annualSpecialCost: nonNegativeNumber(household?.annualSpecialCost)
});

const normalizeAssets = (assets: LifePlan["assets"] | undefined): LifePlan["assets"] => ({
  cash: nonNegativeNumber(assets?.cash),
  investment: nonNegativeNumber(assets?.investment),
  other: nonNegativeNumber(assets?.other),
  debt: nonNegativeNumber(assets?.debt)
});

const normalizeSimulation = (settings: SimulationSettings | undefined): SimulationSettings => ({
  monthlyInvestmentAmount: nonNegativeNumber(settings?.monthlyInvestmentAmount),
  annualBonusInvestmentAmount: nonNegativeNumber(settings?.annualBonusInvestmentAmount),
  monthlyContribution: nonNegativeNumber(settings?.monthlyContribution, defaultPlan.simulation.monthlyContribution),
  bonusContribution: nonNegativeNumber(settings?.bonusContribution, defaultPlan.simulation.bonusContribution),
  annualReturnRate: rateInRange(settings?.annualReturnRate, defaultPlan.simulation.annualReturnRate),
  years: integerInRange(settings?.years, defaultPlan.simulation.years, 1, MAX_PROJECTION_YEARS)
});

export const loadPlan = (): LifePlan => {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return defaultPlan;

  try {
    const parsed = JSON.parse(saved) as LifePlan;
    if (!parsed.profile || !parsed.household || !parsed.assets) return defaultPlan;
    return normalizePlan(parsed);
  } catch {
    preserveUnreadablePlan(saved);
    return defaultPlan;
  }
};

export const savePlan = (plan: LifePlan) => {
  const payload = { ...plan, updatedAt: new Date().toISOString() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    throw new Error("ブラウザ内に保存できませんでした。JSONをエクスポートし、ブラウザの空き容量や保存設定を確認してください。");
  }
  return payload;
};

export const clearPlan = () => {
  localStorage.removeItem(STORAGE_KEY);
};

export const createRecoveryBackup = (plan: LifePlan, reason: Exclude<RecoveryReason, "load-error">) => {
  const backup: RecoveryBackup = {
    id: createStorageId(),
    createdAt: new Date().toISOString(),
    reason,
    plan: normalizePlan(plan)
  };
  const next = [backup, ...getRecoveryBackups()].slice(0, MAX_RECOVERY_BACKUPS);
  try {
    localStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    throw new Error("復旧用コピーを保存できないため、操作を中止しました。先にJSONをエクスポートしてください。");
  }
  return backup;
};

export const getRecoveryBackups = (): RecoveryBackup[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECOVERY_STORAGE_KEY) || "[]") as RecoveryBackup[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === "object" && item.plan)
      .map((item) => ({ ...item, plan: normalizePlan(item.plan) }))
      .slice(0, MAX_RECOVERY_BACKUPS);
  } catch {
    return [];
  }
};

export const removeRecoveryBackup = (id: string) => {
  const next = getRecoveryBackups().filter((backup) => backup.id !== id);
  try {
    localStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    throw new Error("復旧用コピーを削除できませんでした。");
  }
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
  if (plan.version !== undefined && (typeof plan.version !== "number" || !Number.isFinite(plan.version) || plan.version < 0)) {
    throw new Error("JSONのバージョン情報が正しくありません。");
  }
  if (typeof plan.version === "number" && plan.version > CURRENT_PLAN_VERSION) {
    throw new Error("このJSONは新しいバージョンのLife Compassで作成されています。アプリを更新してから読み込んでください。");
  }
  return normalizePlan(plan);
};

const normalizePlan = (plan: LifePlan): LifePlan => {
  const profile = normalizeProfile(plan.profile);
  const householdMembers = normalizeHouseholdMembers(plan.householdMembers, profile);

  return {
    version: CURRENT_PLAN_VERSION,
    profile,
    householdMembers,
    household: normalizeHousehold(plan.household),
    cashflowMode: enumValue(plan.cashflowMode, cashflowModes, "basic"),
    detailedCashflowItems: normalizeDetailedCashflowItems(plan.detailedCashflowItems, householdMembers),
    cashflowPeriods: Array.isArray(plan.cashflowPeriods) ? plan.cashflowPeriods.map(normalizeCashflowPeriod) : [],
    assets: normalizeAssets(plan.assets),
    goals: Array.isArray(plan.goals) ? plan.goals.map(normalizeGoal) : [],
    events: Array.isArray(plan.events) ? plan.events.map(normalizeEvent) : [],
    timelineMemos: Array.isArray(plan.timelineMemos) ? plan.timelineMemos.map(normalizeTimelineMemo) : [],
    simulation: normalizeSimulation(plan.simulation),
    withdrawalPlan: normalizeWithdrawalPlan(plan.withdrawalPlan),
    notes: {
      general: stringValue(plan.notes?.general),
      spendingReview: stringValue(plan.notes?.spendingReview)
    },
    retirementPlan: normalizeRetirementPlan(plan.retirementPlan),
    reviews: Array.isArray(plan.reviews) ? plan.reviews.map(normalizeReview) : [],
    scenarios: Array.isArray(plan.scenarios)
      ? plan.scenarios.map((scenario) => normalizeScenario(scenario, householdMembers))
      : [],
    planRevisions: Array.isArray(plan.planRevisions)
      ? plan.planRevisions
          .map((revision) => normalizePlanRevision(revision, householdMembers))
          .slice(0, MAX_PLAN_REVISIONS)
      : [],
    activeScenario: normalizeActiveScenario(plan.activeScenario),
    fixedCostItems: Array.isArray(plan.fixedCostItems) ? plan.fixedCostItems.map(normalizeFixedCostItem) : [],
    budgetItems: Array.isArray(plan.budgetItems) ? plan.budgetItems.map(normalizeBudgetItem) : [],
    updatedAt: normalizeTimestamp(plan.updatedAt)
  };
};

const createStorageId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const preserveUnreadablePlan = (raw: string) => {
  try {
    localStorage.setItem(`${RECOVERY_STORAGE_KEY}-unreadable`, raw);
  } catch {
    // 保存容量不足などの場合も、既定プランで起動を継続します。
  }
};

const normalizeMonth = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(12, Math.round(value)));
};

const normalizeCashflowPeriod = (period: CashflowPeriod | null | undefined): CashflowPeriod => {
  const startYear = integerInRange(period?.startYear, new Date().getFullYear(), 1900, MAX_PLAN_YEAR);
  return {
    id: identifierValue(period?.id),
    title: nonEmptyString(period?.title, "将来の収支変更"),
    owner: enumValue(period?.owner, eventOwners, "household"),
    target: enumValue(period?.target, cashflowPeriodTargets, "monthlyIncome"),
    startYear,
    endYear: integerInRange(period?.endYear, startYear, startYear, MAX_PLAN_YEAR),
    amount: nonNegativeNumber(period?.amount),
    memo: stringValue(period?.memo)
  };
};

const normalizeDetailedCashflowItems = (
  items: DetailedCashflowItem[] | undefined,
  householdMembers: HouseholdMember[]
): DetailedCashflowItem[] => {
  if (!Array.isArray(items)) return [];
  const memberIds = new Set(householdMembers.map((member) => member.id));

  return items.slice(0, MAX_DETAILED_CASHFLOW_ITEMS).map((item) => {
    const startYear = integerInRange(item?.startYear, new Date().getFullYear(), 1900, MAX_PLAN_YEAR);
    const memberId = typeof item?.memberId === "string" && memberIds.has(item.memberId) ? item.memberId : null;

    return {
      id: identifierValue(item?.id),
      title: nonEmptyString(item?.title, "収支項目"),
      memberId,
      target: enumValue(item?.target, cashflowPeriodTargets, "monthlyIncome"),
      startYear,
      endYear: integerInRange(item?.endYear, startYear, startYear, MAX_PLAN_YEAR),
      amount: nonNegativeNumber(item?.amount),
      memo: stringValue(item?.memo)
    };
  });
};

const normalizeEvent = (event: LifeEvent | null | undefined): LifeEvent => ({
  id: identifierValue(event?.id),
  title: stringValue(event?.title, "ライフイベント"),
  owner: enumValue(event?.owner, eventOwners, "household"),
  category: enumValue(event?.category, eventCategories, "other"),
  year: integerInRange(event?.year, new Date().getFullYear(), 1900, MAX_PLAN_YEAR),
  month: normalizeMonth(event?.month),
  age: integerInRange(event?.age, 0, 0, MAX_PLAN_AGE),
  amount: nonNegativeNumber(event?.amount),
  cashflowType: enumValue(event?.cashflowType, cashflowTypes, "neutral"),
  memo: stringValue(event?.memo)
});

const normalizeTimelineMemo = (memo: TimelineMemo | null | undefined): TimelineMemo => ({
  id: identifierValue(memo?.id),
  title: stringValue(memo?.title, "予定メモ"),
  year: integerInRange(memo?.year, new Date().getFullYear(), 1900, MAX_PLAN_YEAR),
  month: normalizeMonth(memo?.month),
  owner: enumValue(memo?.owner, eventOwners, "self"),
  memo: stringValue(memo?.memo),
  showOnTimeline: memo?.showOnTimeline !== false
});

const normalizeGoal = (goal: Goal | null | undefined): Goal => {
  const progress = finiteNumber(goal?.progress, 0);
  const requiredAmount = nonNegativeNumber(goal?.requiredAmount);

  return {
    id: identifierValue(goal?.id),
    title: stringValue(goal?.title, "目標"),
    goalType: enumValue(goal?.goalType, goalTypes, "oneTime"),
    dueYear: integerInRange(goal?.dueYear, new Date().getFullYear(), 1900, MAX_PLAN_YEAR),
    dueMonth: normalizeMonth(goal?.dueMonth ?? 12),
    requiredAmount,
    savedAmount:
      typeof goal?.savedAmount === "number" && Number.isFinite(goal.savedAmount)
        ? nonNegativeNumber(goal.savedAmount)
        : Math.round((requiredAmount * progress) / 100),
    monthlyAllocation:
      typeof goal?.monthlyAllocation === "number" && Number.isFinite(goal.monthlyAllocation)
        ? nonNegativeNumber(goal.monthlyAllocation)
        : 0,
    recurrence: enumValue(goal?.recurrence, recurrenceIntervals, "yearly"),
    priority: enumValue(goal?.priority, priorities, "medium"),
    progress: Math.min(100, Math.max(0, progress)),
    memo: stringValue(goal?.memo)
  };
};

const finiteOptionalNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

const normalizeRetirementPlan = (settings: RetirementPlanSettings | undefined): RetirementPlanSettings => {
  const defaults = defaultPlan.retirementPlan;
  const retirementAge = integerInRange(settings?.retirementAge, defaults.retirementAge, 0, MAX_PLAN_AGE);
  const planUntilAge = integerInRange(settings?.planUntilAge, defaults.planUntilAge, retirementAge, MAX_PLAN_AGE);

  return {
    retirementAge,
    planUntilAge,
    monthlyLivingCost: nonNegativeNumber(settings?.monthlyLivingCost, defaults.monthlyLivingCost),
    monthlyHousingCost: nonNegativeNumber(settings?.monthlyHousingCost, defaults.monthlyHousingCost),
    monthlyMedicalCost: nonNegativeNumber(settings?.monthlyMedicalCost, defaults.monthlyMedicalCost),
    monthlyCareCost: nonNegativeNumber(settings?.monthlyCareCost, defaults.monthlyCareCost),
    monthlyPublicPension: nonNegativeNumber(settings?.monthlyPublicPension, defaults.monthlyPublicPension),
    monthlyPrivatePension: nonNegativeNumber(settings?.monthlyPrivatePension, defaults.monthlyPrivatePension),
    monthlyOtherIncome: nonNegativeNumber(settings?.monthlyOtherIncome, defaults.monthlyOtherIncome),
    monthlyHealthInsurance: nonNegativeNumber(settings?.monthlyHealthInsurance, defaults.monthlyHealthInsurance),
    monthlyLongTermCareInsurance: nonNegativeNumber(
      settings?.monthlyLongTermCareInsurance,
      defaults.monthlyLongTermCareInsurance
    ),
    monthlyTaxes: nonNegativeNumber(settings?.monthlyTaxes, defaults.monthlyTaxes),
    annualExtraExpense: nonNegativeNumber(settings?.annualExtraExpense, defaults.annualExtraExpense),
    retirementLumpSum: nonNegativeNumber(settings?.retirementLumpSum, defaults.retirementLumpSum),
    annualReturnRate: rateInRange(settings?.annualReturnRate, defaults.annualReturnRate),
    inflationRate: rateInRange(settings?.inflationRate, defaults.inflationRate, 0)
  };
};

const normalizeWithdrawalPeriod = (period: WithdrawalPeriodSettings | undefined, fallback: WithdrawalPeriodSettings): WithdrawalPeriodSettings => {
  const startAge = integerInRange(period?.startAge, fallback.startAge, 0, MAX_PLAN_AGE);
  const endAge = integerInRange(period?.endAge, fallback.endAge, startAge, MAX_PLAN_AGE);

  return {
    id: identifierValue(period?.id),
    label: nonEmptyString(period?.label, fallback.label || "期間"),
    startAge,
    endAge,
    monthlyIncome: nonNegativeNumber(period?.monthlyIncome, fallback.monthlyIncome),
    monthlyLivingCost: nonNegativeNumber(period?.monthlyLivingCost, fallback.monthlyLivingCost),
    annualExtraExpense: nonNegativeNumber(period?.annualExtraExpense, fallback.annualExtraExpense)
  };
};

const normalizeWithdrawalPlan = (settings: WithdrawalPlanSettings | undefined): WithdrawalPlanSettings => {
  const defaults = defaultPlan.withdrawalPlan;
  const startAge = integerInRange(settings?.startAge, defaults.startAge, 0, MAX_PLAN_AGE);
  const years = integerInRange(settings?.years, defaults.years, 1, MAX_PROJECTION_YEARS);
  const fallbackPeriod = defaults.periods[0];
  const periods =
    Array.isArray(settings?.periods) && settings.periods.length > 0
      ? settings.periods.map((period) => normalizeWithdrawalPeriod(period, fallbackPeriod))
      : defaults.periods.map((period) => normalizeWithdrawalPeriod(period, period));

  return {
    startAge,
    startingAssets: nonNegativeNumber(settings?.startingAssets, defaults.startingAssets),
    years,
    withdrawalMode: settings?.withdrawalMode === "annualRate" ? "annualRate" : "monthlyAmount",
    monthlyWithdrawalAmount: nonNegativeNumber(
      settings?.monthlyWithdrawalAmount,
      settings?.periods?.[0]
        ? Math.max(0, settings.periods[0].monthlyLivingCost - settings.periods[0].monthlyIncome)
        : defaults.monthlyWithdrawalAmount
    ),
    annualWithdrawalRate: rateInRange(settings?.annualWithdrawalRate, defaults.annualWithdrawalRate, 0),
    annualReturnRate: rateInRange(settings?.annualReturnRate, defaults.annualReturnRate),
    inflationRate: rateInRange(settings?.inflationRate, defaults.inflationRate, 0),
    periods
  };
};

const normalizeReview = (review: ReviewNote): ReviewNote => ({
  id: identifierValue(review?.id),
  date: /^\d{4}-\d{2}-\d{2}$/.test(stringValue(review?.date)) ? review.date : new Date().toISOString().slice(0, 10),
  reviewType: review.reviewType === "quarterly" ? "quarterly" : "monthly",
  scenarioName: stringValue(review?.scenarioName) || undefined,
  scenarioAdoptedAt:
    typeof review?.scenarioAdoptedAt === "string" && !Number.isNaN(Date.parse(review.scenarioAdoptedAt))
      ? review.scenarioAdoptedAt
      : undefined,
  plannedNetAssets: finiteOptionalNumber(review.plannedNetAssets),
  plannedMonthlySavings: finiteOptionalNumber(review.plannedMonthlySavings),
  plannedTenYearAssets: finiteOptionalNumber(review.plannedTenYearAssets),
  plannedThirtyYearAssets: finiteOptionalNumber(review.plannedThirtyYearAssets),
  plannedGoalTitle: stringValue(review?.plannedGoalTitle) || undefined,
  plannedGoalTargetAge:
    review?.plannedGoalTargetAge === null ? null : finiteOptionalNumber(review?.plannedGoalTargetAge),
  actualNetAssets: finiteOptionalNumber(review.actualNetAssets),
  actualMonthlySavings: finiteOptionalNumber(review.actualMonthlySavings),
  actualMonthlyExpenses: finiteOptionalNumber(review.actualMonthlyExpenses),
  todo: stringValue(review?.todo),
  todoDone: Boolean(review?.todoDone),
  memo: stringValue(review?.memo)
});

const normalizeScenarioSnapshot = (
  snapshot: ScenarioSnapshot | undefined,
  fallbackMembers: HouseholdMember[]
): ScenarioSnapshot => {
  const householdMembers = normalizeHouseholdMembers(
    snapshot?.householdMembers,
    defaultPlan.profile,
    fallbackMembers
  );

  return {
    householdMembers,
    household: normalizeHousehold(snapshot?.household),
    cashflowMode: enumValue(snapshot?.cashflowMode, cashflowModes, "basic"),
    detailedCashflowItems: normalizeDetailedCashflowItems(snapshot?.detailedCashflowItems, householdMembers),
    cashflowPeriods: Array.isArray(snapshot?.cashflowPeriods)
      ? snapshot.cashflowPeriods.map(normalizeCashflowPeriod)
      : [],
    assets: normalizeAssets(snapshot?.assets),
    goals: Array.isArray(snapshot?.goals) ? snapshot.goals.map(normalizeGoal) : [],
    events: Array.isArray(snapshot?.events) ? snapshot.events.map(normalizeEvent) : [],
    simulation: normalizeSimulation(snapshot?.simulation)
  };
};

const normalizeScenario = (scenario: PlanScenario, fallbackMembers: HouseholdMember[]): PlanScenario => ({
  id: identifierValue(scenario?.id),
  name: nonEmptyString(scenario?.name, "シナリオ"),
  description: stringValue(scenario?.description),
  tag: enumValue(scenario?.tag, scenarioTags, "custom"),
  createdAt: stringValue(scenario?.createdAt, new Date().toISOString()),
  snapshot: normalizeScenarioSnapshot(scenario?.snapshot, fallbackMembers)
});

const normalizeActiveScenario = (activeScenario: LifePlan["activeScenario"]): LifePlan["activeScenario"] => {
  if (!activeScenario || typeof activeScenario.name !== "string" || !activeScenario.name.trim()) return undefined;
  return {
    name: activeScenario.name,
    adoptedAt: normalizeTimestamp(activeScenario.adoptedAt)
  };
};

const normalizeFixedCostItem = (item: FixedCostItem): FixedCostItem => ({
  id: identifierValue(item?.id),
  name: nonEmptyString(item?.name, "見直し項目"),
  category: enumValue(item?.category, fixedCostCategories, "other"),
  currentMonthlyCost: nonNegativeNumber(item?.currentMonthlyCost),
  revisedMonthlyCost: nonNegativeNumber(item?.revisedMonthlyCost),
  memo: stringValue(item?.memo)
});

const normalizeActuals = (actuals: unknown) => {
  if (!actuals || typeof actuals !== "object" || Array.isArray(actuals)) return {};
  return Object.entries(actuals as Record<string, unknown>).reduce<Record<string, number>>((result, [key, value]) => {
    if (/^\d{4}-\d{2}$/.test(key) && typeof value === "number" && Number.isFinite(value)) {
      result[key] = Math.min(MAX_MONEY_AMOUNT, Math.max(0, value));
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
  id: identifierValue(item?.id),
  name: nonEmptyString(item?.name, "予算項目"),
  category: normalizeBudgetCategory(item?.category),
  frequency: normalizeBudgetFrequency(item?.frequency),
  budgetAmount: nonNegativeNumber(item?.budgetAmount),
  actuals: normalizeActuals(item?.actuals),
  memo: stringValue(item?.memo)
});

const normalizePlanRevisionSnapshot = (
  snapshot: PlanRevisionSnapshot | undefined,
  fallbackMembers: HouseholdMember[]
): PlanRevisionSnapshot => {
  const profile = normalizeProfile(snapshot?.profile);
  const householdMembers = normalizeHouseholdMembers(snapshot?.householdMembers, profile, fallbackMembers);

  return {
    profile,
    householdMembers,
    household: normalizeHousehold(snapshot?.household),
    cashflowMode: enumValue(snapshot?.cashflowMode, cashflowModes, "basic"),
    detailedCashflowItems: normalizeDetailedCashflowItems(snapshot?.detailedCashflowItems, householdMembers),
    cashflowPeriods: Array.isArray(snapshot?.cashflowPeriods)
      ? snapshot.cashflowPeriods.map(normalizeCashflowPeriod)
      : [],
    assets: normalizeAssets(snapshot?.assets),
    goals: Array.isArray(snapshot?.goals) ? snapshot.goals.map(normalizeGoal) : [],
    events: Array.isArray(snapshot?.events) ? snapshot.events.map(normalizeEvent) : [],
    timelineMemos: Array.isArray(snapshot?.timelineMemos) ? snapshot.timelineMemos.map(normalizeTimelineMemo) : [],
    simulation: normalizeSimulation(snapshot?.simulation),
    withdrawalPlan: normalizeWithdrawalPlan(snapshot?.withdrawalPlan),
    retirementPlan: normalizeRetirementPlan(snapshot?.retirementPlan),
    notes: {
      general: stringValue(snapshot?.notes?.general),
      spendingReview: stringValue(snapshot?.notes?.spendingReview)
    },
    activeScenario: normalizeActiveScenario(snapshot?.activeScenario),
    fixedCostItems: Array.isArray(snapshot?.fixedCostItems)
      ? snapshot.fixedCostItems.map(normalizeFixedCostItem)
      : [],
    budgetItems: Array.isArray(snapshot?.budgetItems) ? snapshot.budgetItems.map(normalizeBudgetItem) : []
  };
};

const normalizePlanRevision = (revision: PlanRevision, fallbackMembers: HouseholdMember[]): PlanRevision => ({
  id: identifierValue(revision?.id),
  title: nonEmptyString(revision?.title, "保存した計画"),
  createdAt: normalizeTimestamp(revision?.createdAt),
  source: enumValue(revision?.source, planRevisionSources, "manual"),
  sourceReviewId: stringValue(revision?.sourceReviewId) || undefined,
  snapshot: normalizePlanRevisionSnapshot(revision?.snapshot, fallbackMembers)
});
