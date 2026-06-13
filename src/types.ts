export type FamilyType = "single" | "couple" | "children" | "care" | "other";
export type WorkStyle = "employee" | "freelance" | "selfEmployed" | "variable" | "retired" | "other";
export type Housing = "rent" | "owned" | "mortgage" | "family" | "other";
export type Priority = "high" | "medium" | "low";
export type CashflowType = "expense" | "income" | "neutral";
export type GoalType = "oneTime" | "recurring";
export type RecurrenceInterval = "monthly" | "quarterly" | "halfYearly" | "yearly";
export type ScenarioTag = "current" | "spending" | "career" | "sideBusiness" | "home" | "retirement" | "custom";
export type EventOwner = "self" | "spouse" | "child" | "parent" | "household" | "other";
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
  monthlyContribution: number;
  bonusContribution: number;
  annualReturnRate: number;
  years: number;
};

export type ReviewNote = {
  id: string;
  date: string;
  reviewType: ReviewType;
  plannedNetAssets?: number;
  plannedMonthlySavings?: number;
  actualNetAssets?: number;
  actualMonthlySavings?: number;
  todo: string;
  todoDone: boolean;
  memo: string;
};

export type ScenarioSnapshot = {
  household: Household;
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

export type PlanNotes = {
  general: string;
  spendingReview: string;
};

export type LifePlan = {
  version: number;
  profile: Profile;
  household: Household;
  assets: Assets;
  goals: Goal[];
  events: LifeEvent[];
  simulation: SimulationSettings;
  notes: PlanNotes;
  reviews: ReviewNote[];
  scenarios: PlanScenario[];
  fixedCostItems: FixedCostItem[];
  updatedAt: string;
};

export type ViewKey =
  | "dashboard"
  | "profile"
  | "household"
  | "assets"
  | "goals"
  | "timeline"
  | "simulation"
  | "scenarios"
  | "diagnosis"
  | "notes"
  | "reviews"
  | "data"
  | "pricing"
  | "pro"
  | "settings"
  | "legal";
