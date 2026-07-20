export type FamilyType = "single" | "couple" | "children" | "care" | "other";
export type WorkStyle = "employee" | "freelance" | "selfEmployed" | "variable" | "retired" | "other";
export type Housing = "rent" | "owned" | "mortgage" | "family" | "other";
export type Priority = "high" | "medium" | "low";
export type CashflowType = "expense" | "income" | "neutral";
export type GoalType = "oneTime" | "recurring";
export type RecurrenceInterval = "monthly" | "quarterly" | "halfYearly" | "yearly";
export type ScenarioTag = "current" | "spending" | "career" | "sideBusiness" | "home" | "retirement" | "custom";
export type EventOwner = "self" | "spouse" | "child" | "parent" | "household" | "other";
export type BudgetCategory =
  | "food"
  | "daily"
  | "housing"
  | "utilities"
  | "communication"
  | "insurance"
  | "car"
  | "education"
  | "medical"
  | "travel"
  | "subscription"
  | "other";
export type BudgetFrequency = "monthlyFixed" | "monthlyVariable" | "irregularFixed" | "irregularVariable" | "yearly" | "oneTime";
export type FixedCostCategory =
  | "insurance"
  | "communication"
  | "rent"
  | "car"
  | "subscription"
  | "utilities"
  | "loan"
  | "other";
export type ReviewType = "monthly" | "quarterly";
export type PlanRevisionSource = "manual" | "review" | "scenarioAdoption" | "beforeRestore";
export type CashflowPeriodTarget =
  | "monthlyIncome"
  | "annualBonus"
  | "sideIncome"
  | "fixedCost"
  | "variableCost"
  | "annualSpecialCost";

export type LifeEventCategory =
  | "career"
  | "move"
  | "marriage"
  | "birth"
  | "home"
  | "car"
  | "education"
  | "care"
  | "sideBusiness"
  | "retirement"
  | "travel"
  | "qualification"
  | "other";

export type Profile = {
  name: string;
  age: number;
  familyType: FamilyType;
  workStyle: WorkStyle;
  housing: Housing;
};

export type Household = {
  monthlyIncome: number;
  annualBonus: number;
  sideIncome: number;
  fixedCost: number;
  variableCost: number;
  annualSpecialCost: number;
};

export type CashflowPeriod = {
  id: string;
  title: string;
  owner: EventOwner;
  target: CashflowPeriodTarget;
  startYear: number;
  endYear: number;
  amount: number;
  memo: string;
};

export type Assets = {
  cash: number;
  investment: number;
  other: number;
  debt: number;
};

export type Goal = {
  id: string;
  title: string;
  goalType: GoalType;
  dueYear: number;
  dueMonth: number;
  requiredAmount: number;
  savedAmount: number;
  monthlyAllocation: number;
  recurrence: RecurrenceInterval;
  priority: Priority;
  progress: number;
  memo: string;
};

export type LifeEvent = {
  id: string;
  title: string;
  owner?: EventOwner;
  category: LifeEventCategory;
  year: number;
  month: number;
  age: number;
  amount: number;
  cashflowType: CashflowType;
  memo: string;
};

export type SimulationSettings = {
  monthlyInvestmentAmount: number;
  annualBonusInvestmentAmount: number;
  monthlyContribution: number;
  bonusContribution: number;
  annualReturnRate: number;
  years: number;
};

export type TimelineMemo = {
  id: string;
  title: string;
  year: number;
  month: number;
  owner: EventOwner;
  memo: string;
  showOnTimeline: boolean;
};

export type WithdrawalPeriodSettings = {
  id: string;
  label: string;
  startAge: number;
  endAge: number;
  monthlyIncome: number;
  monthlyLivingCost: number;
  annualExtraExpense: number;
};

export type WithdrawalPlanSettings = {
  startAge: number;
  startingAssets: number;
  years: number;
  withdrawalMode: "monthlyAmount" | "annualRate";
  monthlyWithdrawalAmount: number;
  annualWithdrawalRate: number;
  annualReturnRate: number;
  inflationRate: number;
  periods: WithdrawalPeriodSettings[];
};

export type RetirementPlanSettings = {
  retirementAge: number;
  planUntilAge: number;
  monthlyLivingCost: number;
  monthlyHousingCost: number;
  monthlyMedicalCost: number;
  monthlyCareCost: number;
  monthlyPublicPension: number;
  monthlyPrivatePension: number;
  monthlyOtherIncome: number;
  monthlyHealthInsurance: number;
  monthlyLongTermCareInsurance: number;
  monthlyTaxes: number;
  annualExtraExpense: number;
  retirementLumpSum: number;
  annualReturnRate: number;
  inflationRate: number;
};

export type ReviewNote = {
  id: string;
  date: string;
  reviewType: ReviewType;
  scenarioName?: string;
  scenarioAdoptedAt?: string;
  plannedNetAssets?: number;
  plannedMonthlySavings?: number;
  plannedTenYearAssets?: number;
  plannedThirtyYearAssets?: number;
  plannedGoalTitle?: string;
  plannedGoalTargetAge?: number | null;
  actualNetAssets?: number;
  actualMonthlySavings?: number;
  actualMonthlyExpenses?: number;
  todo: string;
  todoDone: boolean;
  memo: string;
};

export type ActiveScenario = {
  name: string;
  adoptedAt: string;
};

export type ScenarioSnapshot = {
  household: Household;
  cashflowPeriods: CashflowPeriod[];
  assets: Assets;
  goals: Goal[];
  events: LifeEvent[];
  simulation: SimulationSettings;
};

export type PlanScenario = {
  id: string;
  name: string;
  description: string;
  tag: ScenarioTag;
  createdAt: string;
  snapshot: ScenarioSnapshot;
};

export type FixedCostItem = {
  id: string;
  name: string;
  category: FixedCostCategory;
  currentMonthlyCost: number;
  revisedMonthlyCost: number;
  memo: string;
};

export type BudgetItem = {
  id: string;
  name: string;
  category: BudgetCategory;
  frequency: BudgetFrequency;
  budgetAmount: number;
  actuals: Record<string, number>;
  memo: string;
};

export type PlanNotes = {
  general: string;
  spendingReview: string;
};

export type PlanRevisionSnapshot = {
  profile: Profile;
  household: Household;
  cashflowPeriods: CashflowPeriod[];
  assets: Assets;
  goals: Goal[];
  events: LifeEvent[];
  timelineMemos: TimelineMemo[];
  simulation: SimulationSettings;
  withdrawalPlan: WithdrawalPlanSettings;
  retirementPlan: RetirementPlanSettings;
  notes: PlanNotes;
  activeScenario?: ActiveScenario;
  fixedCostItems: FixedCostItem[];
  budgetItems: BudgetItem[];
};

export type PlanRevision = {
  id: string;
  title: string;
  createdAt: string;
  source: PlanRevisionSource;
  sourceReviewId?: string;
  snapshot: PlanRevisionSnapshot;
};

export type LifePlan = {
  version: number;
  profile: Profile;
  household: Household;
  cashflowPeriods: CashflowPeriod[];
  assets: Assets;
  goals: Goal[];
  events: LifeEvent[];
  timelineMemos: TimelineMemo[];
  simulation: SimulationSettings;
  withdrawalPlan: WithdrawalPlanSettings;
  retirementPlan: RetirementPlanSettings;
  notes: PlanNotes;
  reviews: ReviewNote[];
  scenarios: PlanScenario[];
  planRevisions: PlanRevision[];
  activeScenario?: ActiveScenario;
  fixedCostItems: FixedCostItem[];
  budgetItems: BudgetItem[];
  updatedAt: string;
};

export type ViewKey =
  | "dashboard"
  | "profile"
  | "household"
  | "assets"
  | "goals"
  | "events"
  | "timeline"
  | "simulation"
  | "retirement"
  | "scenarios"
  | "diagnosis"
  | "budget"
  | "notes"
  | "reviews"
  | "data"
  | "pricing"
  | "pro"
  | "settings"
  | "legal"
  | "terms"
  | "privacy"
  | "commercial"
  | "refund"
  | "contact"
  | "disclaimer";
