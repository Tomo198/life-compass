import test from "node:test";
import assert from "node:assert/strict";
import {
  CURRENT_PLAN_VERSION,
  MAX_DETAILED_CASHFLOW_ITEMS,
  MAX_MONEY_AMOUNT,
  MAX_PLAN_AGE,
  MAX_PLAN_REVISIONS,
  MAX_PLAN_YEAR,
  MAX_PROJECTION_YEARS,
  MAX_RATE_PERCENT,
  RECOVERY_STORAGE_KEY,
  STORAGE_KEY
} from "../src/config";
import {
  canOpenView,
  defaultAccessState,
  getEffectiveTier,
  getScenarioLimit,
  hasFeatureAccess,
  type AccessState
} from "../src/features";
import {
  getMobileNavKey,
  getPublicPath,
  getViewForPath,
  getViewTitle,
  isLegalDocumentView
} from "../src/navigation";
import { createEmptyPlan } from "../src/hooks/useLifePlanEditor";
import { createScenarioFromTemplate, scenarioTemplates } from "../src/data/scenarios";
import type { LifePlan } from "../src/types";
import { decryptCloudBackup, encryptCloudBackup } from "../src/utils/cloudBackupCrypto";
import { convertBasicCashflowToDetailedItems } from "../src/utils/detailedCashflow";
import {
  buildPlanFromScenario,
  emergencyMonthsLabel,
  formatMoney,
  getAssetSummary,
  getAnnualProjectionRows,
  getBasicProjectionAllocation,
  getBudgetHouseholdInputs,
  getBudgetSummary,
  getCashflowSummary,
  getCashflowStressYears,
  getCurrentCashflowSummary,
  getEmergencyFundMonths,
  getEmergencyFundResult,
  getFixedCostImpact,
  getContributionProjectionRows,
  getGoalAchievement,
  getGoalFundingSummary,
  getGoalPreparedPercent,
  getInputCompletion,
  getMonthlyProjectionRows,
  getNextEvent,
  getHouseholdForYear,
  getTargetAgeForYear,
  projectAssets,
  simulateContributionVariability,
  simulateRetirementPlan,
  simulateRetirementPlanVariability,
  simulateWithdrawalVariability,
  simulateWithdrawal,
  simulateContribution
} from "../src/utils/calculations";
import {
  createRecoveryBackup,
  getRecoveryBackups,
  loadPlan,
  removeRecoveryBackup,
  savePlan,
  validateImportedPlan
} from "../src/utils/storage";
import { adoptScenarioAsBase } from "../src/utils/scenarios";
import {
  applyBudgetActualsToReview,
  createPlanReview,
  createScenarioFromReview
} from "../src/utils/reviews";
import { defaultSettings, getAppReminders } from "../src/utils/settings";
import { getLifePlanDiagnosis } from "../src/utils/diagnosis";
import {
  addPlanRevision,
  createPlanRevision,
  restorePlanRevision
} from "../src/utils/planRevisions";

const currentYear = new Date().getFullYear();

test("shared age and emergency-fund labels keep existing display rules", () => {
  assert.equal(getTargetAgeForYear(35, currentYear + 5), 40);
  assert.equal(getTargetAgeForYear(35, currentYear - 1), 35);
  assert.equal(emergencyMonthsLabel(6, 6), "6ヶ月分");
  assert.equal(emergencyMonthsLabel(6, 12), "6〜12ヶ月分");
});

test("money labels keep small operational amounts exact and compact large amounts", () => {
  assert.equal(formatMoney(0), "0円");
  assert.equal(formatMoney(4000), "4,000円");
  assert.equal(formatMoney(5000), "5,000円");
  assert.equal(formatMoney(75000), "75,000円");
  assert.equal(formatMoney(-5000), "-5,000円");
  assert.equal(formatMoney(1000000), "100万円");
  assert.equal(formatMoney(1005000), "100.5万円");
});

test("default access fails closed as free until the Worker resolves entitlement", () => {
  assert.equal(defaultAccessState.tier, "free");
  assert.equal(defaultAccessState.mode, "enforced");
  assert.equal(getEffectiveTier(defaultAccessState), "free");
  assert.equal(hasFeatureAccess(defaultAccessState, "simulationVariability"), false);
  assert.equal(canOpenView(defaultAccessState, "scenarios"), false);
  assert.equal(getScenarioLimit(defaultAccessState), 0);
});

test("explicit preview access keeps Pro features available for automated testing", () => {
  const access: AccessState = { tier: "free", mode: "preview", source: "local-preview" };
  assert.equal(getEffectiveTier(access), "pro");
  assert.equal(hasFeatureAccess(access, "simulationVariability"), true);
  assert.equal(canOpenView(access, "scenarios"), true);
  assert.equal(getScenarioLimit(access), 20);
});

test("enforced free access blocks Pro views and capabilities", () => {
  const access: AccessState = { tier: "free", mode: "enforced", source: "anonymous" };
  assert.equal(getEffectiveTier(access), "free");
  assert.equal(hasFeatureAccess(access, "fixedCostImpact"), false);
  assert.equal(hasFeatureAccess(access, "budgetPlanning"), true);
  assert.equal(hasFeatureAccess(access, "planVersionHistory"), false);
  assert.equal(hasFeatureAccess(access, "simulationVariability"), false);
  assert.equal(canOpenView(access, "retirement"), false);
  assert.equal(canOpenView(access, "dashboard"), true);
});

test("enforced Pro access unlocks Pro views without preview mode", () => {
  const access: AccessState = { tier: "pro", mode: "enforced", source: "operator" };
  assert.equal(getEffectiveTier(access), "pro");
  assert.equal(hasFeatureAccess(access, "lifePlanDiagnosis"), true);
  assert.equal(hasFeatureAccess(access, "planVersionHistory"), true);
  assert.equal(canOpenView(access, "diagnosis"), true);
});

test("life plan diagnosis links a household deficit to an editable spending scenario", () => {
  const deficitPlan: LifePlan = {
    ...basePlan,
    household: {
      ...basePlan.household,
      monthlyIncome: 100000,
      sideIncome: 0,
      fixedCost: 180000,
      variableCost: 80000
    }
  };
  const deficitItem = getLifePlanDiagnosis(deficitPlan).find((item) => item.title === "通常月の収支がマイナスの前提です");
  assert.equal(deficitItem?.suggestedScenarioTag, "spending");

  const regularItem = getLifePlanDiagnosis(basePlan).find((item) => item.title === "通常月の家計余剰を確認できます");
  assert.equal(regularItem?.tone, "good");
  assert.equal(regularItem?.suggestedScenarioTag, undefined);
});

test("life plan diagnosis links a completed budget overrun to a spending scenario", () => {
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const plan: LifePlan = {
    ...basePlan,
    budgetItems: [
      {
        id: "budget-overrun",
        name: "食費",
        category: "food",
        frequency: "monthlyVariable",
        budgetAmount: 50000,
        actuals: { [currentMonthKey]: 65000 },
        memo: ""
      }
    ]
  };
  const budgetItem = getLifePlanDiagnosis(plan).find((item) => item.title === "予算を上回っているカテゴリがあります");
  assert.equal(budgetItem?.suggestedScenarioTag, "spending");
});

test("public routes and titles preserve direct legal-page navigation", () => {
  assert.equal(getViewForPath("/privacy"), "privacy");
  assert.equal(getViewForPath("/privacy/"), "privacy");
  assert.equal(getViewForPath("/unknown"), "dashboard");
  assert.equal(getPublicPath("commercial"), "/commercial-disclosure");
  assert.equal(getPublicPath("household"), "/");
  assert.equal(getViewTitle("commercial"), "特定商取引法に基づく表記");
  assert.equal(isLegalDocumentView("refund"), true);
  assert.equal(isLegalDocumentView("pricing"), false);
});

test("mobile navigation groups related planning views", () => {
  assert.equal(getMobileNavKey("dashboard"), "home");
  assert.equal(getMobileNavKey("budget"), "household");
  assert.equal(getMobileNavKey("timeline"), "goals");
  assert.equal(getMobileNavKey("retirement"), "forecast");
  assert.equal(getMobileNavKey("settings"), "menu");
});

test("empty plan starts without personal data and keeps complete simulation settings", () => {
  const plan = createEmptyPlan();

  assert.equal(plan.version, CURRENT_PLAN_VERSION);
  assert.equal(plan.profile.name, "新しいプラン");
  assert.equal(plan.householdMembers.length, 1);
  assert.equal(plan.householdMembers[0].relationship, "self");
  assert.equal(plan.householdMembers[0].birthYear, null);
  assert.deepEqual(plan.goals, []);
  assert.deepEqual(plan.events, []);
  assert.deepEqual(plan.budgetItems, []);
  assert.deepEqual(plan.planRevisions, []);
  assert.equal(plan.withdrawalPlan.years, 101);
  assert.equal(plan.withdrawalPlan.periods.length, 1);
  assert.equal(plan.simulation.years, 30);
});

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  clear() {
    this.values.clear();
  }
}

const installMemoryStorage = (storage: MemoryStorage = new MemoryStorage()) => {
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true
  });
};

const basePlan: LifePlan = {
  version: CURRENT_PLAN_VERSION,
  profile: {
    name: "test",
    age: 35,
    familyType: "single",
    workStyle: "employee",
    housing: "rent"
  },
  householdMembers: [
    {
      id: "member-self",
      displayName: "本人",
      relationship: "self",
      birthYear: currentYear - 35,
      birthMonth: null
    }
  ],
  household: {
    monthlyIncome: 320000,
    annualBonus: 600000,
    sideIncome: 30000,
    fixedCost: 130000,
    variableCost: 90000,
    annualSpecialCost: 300000
  },
  cashflowMode: "basic",
  detailedCashflowItems: [],
  cashflowPeriods: [],
  assets: {
    cash: 1200000,
    investment: 1500000,
    other: 200000,
    debt: 500000
  },
  goals: [],
  events: [],
  timelineMemos: [],
  simulation: {
    monthlyInvestmentAmount: 0,
    annualBonusInvestmentAmount: 0,
    monthlyContribution: 10000,
    bonusContribution: 20000,
    annualReturnRate: 0,
    years: 2
  },
  retirementPlan: {
    retirementAge: 65,
    planUntilAge: 95,
    monthlyLivingCost: 180000,
    monthlyHousingCost: 30000,
    monthlyMedicalCost: 15000,
    monthlyCareCost: 10000,
    monthlyPublicPension: 140000,
    monthlyPrivatePension: 0,
    monthlyOtherIncome: 0,
    monthlyHealthInsurance: 15000,
    monthlyLongTermCareInsurance: 8000,
    monthlyTaxes: 10000,
    annualExtraExpense: 300000,
    retirementLumpSum: 0,
    annualReturnRate: 0,
    inflationRate: 0
  },
  notes: {
    general: "",
    spendingReview: ""
  },
  reviews: [],
  scenarios: [],
  planRevisions: [],
  fixedCostItems: [],
  budgetItems: [],
  updatedAt: new Date().toISOString()
};

const assertAlmostEqual = (actual: number, expected: number, tolerance = 0.01) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
};

test("計画版は保存時点を複製し、上限件数を超えない", () => {
  const plan = createEmptyPlan();
  plan.household.monthlyIncome = 300000;
  plan.budgetItems = [
    {
      id: "budget-1",
      name: "食費",
      category: "food",
      frequency: "monthlyVariable",
      budgetAmount: 50000,
      actuals: { "2026-07": 48000 },
      memo: ""
    }
  ];
  plan.cashflowMode = "detailed";
  plan.detailedCashflowItems = [
    {
      id: "revision-income",
      title: "本人収入",
      memberId: plan.householdMembers[0].id,
      target: "monthlyIncome",
      startYear: currentYear,
      endYear: currentYear + 10,
      amount: 300000,
      memo: ""
    }
  ];

  const saved = createPlanRevision(plan, "revision-1", "保存時点", "manual", "2026-07-01T00:00:00.000Z");
  plan.household.monthlyIncome = 450000;
  plan.householdMembers[0].displayName = "変更後";
  plan.budgetItems[0].actuals["2026-07"] = 70000;
  plan.detailedCashflowItems[0].amount = 450000;

  assert.equal(saved.snapshot.household.monthlyIncome, 300000);
  assert.equal(saved.snapshot.householdMembers[0].displayName, "本人");
  assert.equal(saved.snapshot.budgetItems[0].actuals["2026-07"], 48000);
  assert.equal(saved.snapshot.cashflowMode, "detailed");
  assert.equal(saved.snapshot.detailedCashflowItems[0].amount, 300000);

  let revisions = [];
  for (let index = 0; index < MAX_PLAN_REVISIONS + 2; index += 1) {
    revisions = addPlanRevision(
      revisions,
      createPlanRevision(plan, `revision-${index + 2}`, `版${index + 2}`, "manual", `2026-07-${String(index + 2).padStart(2, "0")}T00:00:00.000Z`)
    );
  }

  assert.equal(revisions.length, MAX_PLAN_REVISIONS);
  assert.equal(revisions[0].id, `revision-${MAX_PLAN_REVISIONS + 3}`);
});

test("計画版の復元は現在の計画を退避し、レビューと比較案を残す", () => {
  const savedPlan = createEmptyPlan();
  savedPlan.household.monthlyIncome = 300000;
  const savedRevision = createPlanRevision(
    savedPlan,
    "saved-revision",
    "以前の計画",
    "manual",
    "2026-06-01T00:00:00.000Z"
  );

  const currentPlan = createEmptyPlan();
  currentPlan.household.monthlyIncome = 500000;
  const review = createPlanReview(currentPlan, "review-1", "2026-07-01");
  const scenario = createScenarioFromReview(currentPlan, review, "scenario-1", "2026-07-01T00:00:00.000Z");
  currentPlan.reviews = [review];
  currentPlan.scenarios = [scenario];
  currentPlan.planRevisions = [savedRevision];
  const beforeRestore = createPlanRevision(
    currentPlan,
    "before-restore",
    "復元前",
    "beforeRestore",
    "2026-07-02T00:00:00.000Z"
  );

  const restored = restorePlanRevision(currentPlan, savedRevision, beforeRestore);

  assert.equal(restored.household.monthlyIncome, 300000);
  assert.deepEqual(restored.reviews, [review]);
  assert.deepEqual(restored.scenarios, [scenario]);
  assert.equal(restored.planRevisions[0].source, "beforeRestore");
  assert.equal(restored.planRevisions[0].snapshot.household.monthlyIncome, 500000);
  assert.equal(restored.planRevisions[1].id, "saved-revision");
});

test("app reminders cover due actuals, reviews, goals, and upcoming events", () => {
  const now = new Date(2026, 6, 26);
  const plan: LifePlan = {
    ...basePlan,
    budgetItems: [
      {
        id: "budget-1",
        name: "食費",
        category: "food",
        frequency: "monthlyVariable",
        budgetAmount: 50000,
        actuals: {},
        memo: ""
      }
    ],
    goals: [
      {
        id: "goal-1",
        title: "期限目標",
        goalType: "oneTime",
        dueYear: 2026,
        dueMonth: 7,
        requiredAmount: 100000,
        savedAmount: 50000,
        monthlyAllocation: 10000,
        recurrence: "yearly",
        priority: "medium",
        progress: 50,
        memo: ""
      }
    ],
    events: [
      {
        id: "event-1",
        title: "近い予定",
        category: "other",
        year: 2026,
        month: 9,
        age: 35,
        amount: 0,
        cashflowType: "neutral",
        memo: ""
      }
    ]
  };

  const reminders = getAppReminders(plan, defaultSettings, now);

  assert.deepEqual(reminders.map((reminder) => reminder.view), ["budget", "reviews", "goals", "timeline"]);
});

test("disabled app reminders return no dashboard guidance", () => {
  const reminders = getAppReminders(
    basePlan,
    { ...defaultSettings, remindersEnabled: false },
    new Date(2026, 6, 26)
  );

  assert.deepEqual(reminders, []);
});

test("basic household cashflow is calculated from monthly and annual inputs", () => {
  const summary = getCashflowSummary(basePlan.household);

  assert.equal(summary.monthlyIncome, 350000);
  assert.equal(summary.annualIncome, 4800000);
  assert.equal(summary.monthlyLivingCost, 245000);
  assert.equal(summary.annualLivingCost, 2940000);
  assert.equal(summary.monthlySavings, 105000);
  assert.equal(summary.annualSavings, 1860000);
  assert.equal(summary.savingsRate, 30);
  assertAlmostEqual(summary.annualSavingsRate, 38.75);
});

test("gross assets and net assets subtract debt once", () => {
  const summary = getAssetSummary(basePlan.assets);

  assert.equal(summary.grossAssets, 2900000);
  assert.equal(summary.netAssets, 2400000);
});

test("net assets are cash plus investment plus other assets minus debt", () => {
  const summary = getAssetSummary({
    cash: 1200000,
    investment: 800000,
    other: 300000,
    debt: 900000
  });

  assert.equal(summary.grossAssets, 2300000);
  assert.equal(summary.netAssets, 1400000);
});

test("fixed cost impact uses positive monthly review differences only", () => {
  const impact = getFixedCostImpact([
    {
      id: "cost-1",
      name: "insurance",
      category: "insurance",
      currentMonthlyCost: 15000,
      revisedMonthlyCost: 10000,
      memo: ""
    },
    {
      id: "cost-2",
      name: "subscription",
      category: "subscription",
      currentMonthlyCost: 3000,
      revisedMonthlyCost: 5000,
      memo: ""
    }
  ]);

  assert.equal(impact.monthlyImprovement, 5000);
  assert.equal(impact.annualImprovement, 60000);
  assert.equal(impact.tenYearSimpleImpact, 600000);
  assert.equal(impact.thirtyYearSimpleImpact, 1800000);
});

test("scenario snapshots can be compared without mutating the base plan", () => {
  const scenarioPlan = buildPlanFromScenario(basePlan, {
    id: "scenario-1",
    name: "spending review",
    description: "",
    tag: "spending",
    createdAt: new Date().toISOString(),
    snapshot: {
      householdMembers: basePlan.householdMembers.map((member) => ({ ...member })),
      household: { ...basePlan.household, fixedCost: basePlan.household.fixedCost - 30000 },
      cashflowMode: "basic",
      detailedCashflowItems: [],
      cashflowPeriods: [],
      assets: { ...basePlan.assets },
      goals: [],
      events: [],
      simulation: { ...basePlan.simulation }
    }
  });

  assert.equal(getCashflowSummary(scenarioPlan.household).monthlySavings, getCashflowSummary(basePlan.household).monthlySavings + 30000);
  assert.equal(basePlan.household.fixedCost, 130000);
});

test("adopting a scenario replaces the base assumptions and preserves the previous plan", () => {
  const selectedScenario = {
    id: "scenario-selected",
    name: "spending review",
    description: "reduce fixed costs",
    tag: "spending" as const,
    createdAt: "2026-07-18T00:00:00.000Z",
    snapshot: {
      householdMembers: [
        ...basePlan.householdMembers.map((member) => ({ ...member })),
        {
          id: "member-spouse",
          displayName: "配偶者",
          relationship: "spouse" as const,
          birthYear: currentYear - 34,
          birthMonth: 6
        }
      ],
      household: { ...basePlan.household, fixedCost: 90000 },
      cashflowMode: "detailed" as const,
      detailedCashflowItems: [
        {
          id: "scenario-income",
          title: "scenario income",
          memberId: "member-self",
          target: "monthlyIncome" as const,
          startYear: currentYear,
          endYear: currentYear + 30,
          amount: 280000,
          memo: ""
        }
      ],
      cashflowPeriods: [
        {
          id: "scenario-income-period",
          title: "career transition",
          owner: "self" as const,
          target: "monthlyIncome" as const,
          startYear: currentYear + 1,
          endYear: currentYear + 1,
          amount: 280000,
          memo: ""
        }
      ],
      assets: { ...basePlan.assets, cash: 2500000 },
      goals: [
        ...basePlan.goals,
        { ...basePlan.goals[0], id: "scenario-goal", title: "scenario-specific goal" }
      ],
      events: [
        ...basePlan.events,
        { ...basePlan.events[0], id: "scenario-event", title: "scenario-specific event" }
      ],
      simulation: { ...basePlan.simulation, monthlyInvestmentAmount: 50000 }
    }
  };
  const otherScenario = {
    ...selectedScenario,
    id: "scenario-other",
    name: "career change"
  };
  const plan = {
    ...basePlan,
    scenarios: [selectedScenario, otherScenario]
  };

  const adopted = adoptScenarioAsBase(
    plan,
    selectedScenario,
    "scenario-previous",
    "2026-07-18T01:00:00.000Z"
  );

  assert.equal(adopted.household.fixedCost, 90000);
  assert.equal(adopted.householdMembers.length, 2);
  assert.equal(adopted.householdMembers[1].displayName, "配偶者");
  assert.equal(adopted.cashflowMode, "detailed");
  assert.equal(adopted.detailedCashflowItems[0].amount, 280000);
  assert.equal(adopted.cashflowPeriods[0].title, "career transition");
  assert.equal(adopted.assets.cash, 2500000);
  assert.equal(adopted.goals.some((goal) => goal.id === "scenario-goal"), true);
  assert.equal(adopted.events.some((event) => event.id === "scenario-event"), true);
  assert.equal(adopted.simulation.monthlyInvestmentAmount, 50000);
  assert.equal(adopted.scenarios[0].id, "scenario-previous");
  assert.equal(adopted.scenarios[0].name, "採用前: test");
  assert.equal(adopted.scenarios[0].snapshot.household.fixedCost, 130000);
  assert.equal(adopted.scenarios[0].snapshot.householdMembers.length, 1);
  assert.equal(adopted.scenarios[0].snapshot.cashflowMode, "basic");
  assert.deepEqual(adopted.scenarios[0].snapshot.detailedCashflowItems, []);
  assert.deepEqual(adopted.scenarios[0].snapshot.cashflowPeriods, []);
  assert.deepEqual(adopted.scenarios.map((scenario) => scenario.id), ["scenario-previous", "scenario-other"]);
  assert.deepEqual(adopted.activeScenario, {
    name: "spending review",
    adoptedAt: "2026-07-18T01:00:00.000Z"
  });
  assert.equal(plan.household.fixedCost, 130000);
  assert.equal(plan.goals.some((goal) => goal.id === "scenario-goal"), false);
  assert.equal(plan.events.some((event) => event.id === "scenario-event"), false);
  assert.equal(plan.scenarios[0].snapshot.household.fixedCost, 90000);
});

test("plan reviews preserve the active scenario and long-term outlook at creation time", () => {
  const plan = {
    ...basePlan,
    activeScenario: {
      name: "spending review",
      adoptedAt: "2026-07-18T01:00:00.000Z"
    }
  };

  const review = createPlanReview(plan, "review-1", "2026-07-19");

  assert.equal(review.scenarioName, "spending review");
  assert.equal(review.scenarioAdoptedAt, "2026-07-18T01:00:00.000Z");
  assert.equal(review.plannedNetAssets, getAssetSummary(basePlan.assets).netAssets);
  assert.equal(review.plannedMonthlySavings, getCashflowSummary(basePlan.household).monthlySavings);
  assert.equal(review.plannedTenYearAssets, projectAssets(basePlan, 30)[10].value);
  assert.equal(review.plannedThirtyYearAssets, projectAssets(basePlan, 30)[30].value);
  assert.equal(review.actualNetAssets, review.plannedNetAssets);
  assert.equal(review.actualMonthlyExpenses, getCashflowSummary(basePlan.household).monthlyLivingCost);
});

test("complete monthly budget actuals can be reflected in a review", () => {
  const review = createPlanReview(basePlan, "review-budget", "2026-07-19");
  const plan = {
    ...basePlan,
    budgetItems: [
      {
        id: "budget-actual",
        name: "living costs",
        category: "daily" as const,
        frequency: "monthlyVariable" as const,
        budgetAmount: 200000,
        actuals: { "2026-07": 210000 },
        memo: ""
      }
    ]
  };

  const updated = applyBudgetActualsToReview(plan, review);

  assert.equal(updated?.actualMonthlyExpenses, 210000);
  assert.equal(updated?.actualMonthlySavings, 140000);
  assert.equal(applyBudgetActualsToReview({ ...plan, budgetItems: [{ ...plan.budgetItems[0], actuals: {} }] }, review), null);
});

test("a review can create an editable scenario from the current plan", () => {
  const review = createPlanReview(basePlan, "review-scenario", "2026-07-19");
  const scenario = createScenarioFromReview(basePlan, review, "scenario-review", "2026-07-19T01:00:00.000Z");

  assert.equal(scenario.id, "scenario-review");
  assert.equal(scenario.name, "2026年07月 見直し案");
  assert.equal(scenario.tag, "custom");
  assert.equal(scenario.snapshot.household.fixedCost, basePlan.household.fixedCost);
  assert.match(scenario.description, /純資産差/);
});

test("a review scenario reflects only the selected actual values", () => {
  const review = {
    ...createPlanReview(basePlan, "review-reflect", "2026-07-19"),
    actualNetAssets: getAssetSummary(basePlan.assets).netAssets - 500000,
    actualMonthlyExpenses: getCashflowSummary(basePlan.household).monthlyLivingCost + 30000
  };
  const scenario = createScenarioFromReview(
    basePlan,
    review,
    "scenario-reflect",
    "2026-07-19T01:00:00.000Z",
    { applyActualNetAssets: true, applyActualMonthlyExpenses: true }
  );

  assert.equal(getAssetSummary(scenario.snapshot.assets).netAssets, review.actualNetAssets);
  assert.equal(getCashflowSummary(scenario.snapshot.household).monthlyLivingCost, review.actualMonthlyExpenses);
  assert.match(scenario.description, /実際の純資産・実際の月間支出を比較前提へ仮反映/);

  const expensesOnly = createScenarioFromReview(
    basePlan,
    review,
    "scenario-expenses",
    "2026-07-19T01:00:00.000Z",
    { applyActualNetAssets: false, applyActualMonthlyExpenses: true }
  );
  assert.equal(getAssetSummary(expensesOnly.snapshot.assets).netAssets, getAssetSummary(basePlan.assets).netAssets);
  assert.equal(getCashflowSummary(expensesOnly.snapshot.household).monthlyLivingCost, review.actualMonthlyExpenses);
});

test("scenario templates update the active detailed cashflow instead of ignored basic values", () => {
  const plan = createEmptyPlan();
  plan.cashflowMode = "detailed";
  plan.detailedCashflowItems = [
    {
      id: "detailed-income",
      title: "本人の給与",
      memberId: plan.householdMembers[0].id,
      target: "monthlyIncome",
      startYear: currentYear,
      endYear: currentYear + 20,
      amount: 350000,
      memo: ""
    },
    {
      id: "detailed-fixed",
      title: "固定費",
      memberId: null,
      target: "fixedCost",
      startYear: currentYear,
      endYear: currentYear + 20,
      amount: 120000,
      memo: ""
    }
  ];
  const template = scenarioTemplates.find((item) => item.tag === "spending");
  assert.ok(template);

  const scenario = createScenarioFromTemplate(plan, template);
  const scenarioPlan = buildPlanFromScenario(plan, scenario);

  assert.equal(scenario.snapshot.cashflowMode, "detailed");
  assert.equal(getHouseholdForYear(scenarioPlan, currentYear).fixedCost, 90000);
  assert.equal(getHouseholdForYear(plan, currentYear).fixedCost, 120000);
});

test("review expenses update detailed cashflow totals and preserve future-only items", () => {
  const plan = createEmptyPlan();
  plan.cashflowMode = "detailed";
  plan.detailedCashflowItems = [
    {
      id: "review-fixed",
      title: "住居費など",
      memberId: null,
      target: "fixedCost",
      startYear: currentYear,
      endYear: currentYear + 20,
      amount: 100000,
      memo: ""
    },
    {
      id: "review-variable",
      title: "生活費",
      memberId: null,
      target: "variableCost",
      startYear: currentYear,
      endYear: currentYear + 20,
      amount: 80000,
      memo: ""
    },
    {
      id: "review-special",
      title: "年間特別支出",
      memberId: null,
      target: "annualSpecialCost",
      startYear: currentYear,
      endYear: currentYear + 20,
      amount: 240000,
      memo: ""
    },
    {
      id: "future-education",
      title: "将来の教育費",
      memberId: null,
      target: "variableCost",
      startYear: currentYear + 5,
      endYear: currentYear + 8,
      amount: 50000,
      memo: ""
    }
  ];
  const review = {
    ...createPlanReview(plan, "review-detailed", `${currentYear}-07-19`),
    actualMonthlyExpenses: 230000
  };

  const scenario = createScenarioFromReview(
    plan,
    review,
    "scenario-detailed-review",
    `${currentYear}-07-19T01:00:00.000Z`,
    { applyActualNetAssets: false, applyActualMonthlyExpenses: true }
  );

  assert.equal(scenario.snapshot.cashflowMode, "detailed");
  assert.equal(getCurrentCashflowSummary(scenario.snapshot).monthlyLivingCost, 230000);
  assert.equal(
    scenario.snapshot.detailedCashflowItems.find((item) => item.id === "future-education")?.amount,
    50000
  );
});

test("budget summary converts frequency to monthly average and selected actuals", () => {
  const summary = getBudgetSummary(
    [
      {
        id: "budget-1",
        name: "rent",
        category: "housing",
        frequency: "monthlyFixed",
        budgetAmount: 80000,
        actuals: { "2026-06": 80000 },
        memo: ""
      },
      {
        id: "budget-2",
        name: "travel",
        category: "travel",
        frequency: "yearly",
        budgetAmount: 240000,
        actuals: { "2026-06": 30000 },
        memo: ""
      }
    ],
    "2026-06"
  );

  assert.equal(summary.plannedMonthlyAverage, 100000);
  assert.equal(summary.actual, 110000);
  assert.equal(summary.variance, 10000);
  assert.equal(summary.actualEntryCount, 2);
  assert.equal(summary.annualPlan, 1200000);
  assert.equal(summary.categoryRows.find((row) => row.category === "travel")?.plannedMonthlyAverage, 20000);
  assert.equal(summary.categoryRows.find((row) => row.category === "travel")?.itemCount, 1);
});

test("budget category summary exposes incomplete actual entry counts", () => {
  const summary = getBudgetSummary(
    [
      {
        id: "food-1",
        name: "groceries",
        category: "food",
        frequency: "monthlyVariable",
        budgetAmount: 40000,
        actuals: { "2026-06": 42000 },
        memo: ""
      },
      {
        id: "food-2",
        name: "eating out",
        category: "food",
        frequency: "monthlyVariable",
        budgetAmount: 20000,
        actuals: {},
        memo: ""
      }
    ],
    "2026-06"
  );
  const food = summary.categoryRows.find((row) => row.category === "food");

  assert.equal(food?.itemCount, 2);
  assert.equal(food?.actualEntryCount, 1);
});

test("budget household inputs map monthly and recurring non-monthly items to cashflow fields", () => {
  const inputs = getBudgetHouseholdInputs([
    {
      id: "budget-1",
      name: "rent",
      category: "housing",
      frequency: "monthlyFixed",
      budgetAmount: 80000,
      actuals: {},
      memo: ""
    },
    {
      id: "budget-2",
      name: "food",
      category: "food",
      frequency: "monthlyVariable",
      budgetAmount: 60000,
      actuals: {},
      memo: ""
    },
    {
      id: "budget-3",
      name: "travel",
      category: "travel",
      frequency: "yearly",
      budgetAmount: 200000,
      actuals: {},
      memo: ""
    },
    {
      id: "budget-4",
      name: "one-time repair",
      category: "other",
      frequency: "oneTime",
      budgetAmount: 500000,
      actuals: {},
      memo: ""
    }
  ]);

  assert.equal(inputs.fixedCost, 80000);
  assert.equal(inputs.variableCost, 60000);
  assert.equal(inputs.annualSpecialCost, 200000);
});

test("emergency fund months follow work style, family, and mortgage rules", () => {
  assert.deepEqual(getEmergencyFundMonths(basePlan.profile), {
    lower: 6,
    upper: 6,
    note: "会社員・単身の前提として、6ヶ月分を目安にしています。"
  });

  assert.equal(getEmergencyFundMonths({ ...basePlan.profile, familyType: "children" }).lower, 9);
  assert.equal(getEmergencyFundMonths({ ...basePlan.profile, workStyle: "freelance" }).lower, 12);
  assert.deepEqual(getEmergencyFundMonths({ ...basePlan.profile, housing: "mortgage" }), {
    lower: 9,
    upper: 12,
    note: "住宅ローンがある前提として、9〜12ヶ月分を目安にしています。"
  });
});

test("emergency fund shortage and time to target are based on lower bound", () => {
  const plan: LifePlan = {
    ...basePlan,
    household: {
      monthlyIncome: 280000,
      annualBonus: 0,
      sideIncome: 0,
      fixedCost: 150000,
      variableCost: 70000,
      annualSpecialCost: 360000
    },
    assets: { ...basePlan.assets, cash: 1200000 }
  };
  const result = getEmergencyFundResult(plan);

  assert.equal(getCashflowSummary(plan.household).monthlyLivingCost, 250000);
  assert.equal(result.lowerMonths, 6);
  assert.equal(result.lowerAmount, 1500000);
  assert.equal(result.shortageToLower, 300000);
  assert.equal(result.monthsToLower, 10);
  assert.equal(result.status, "short");
});

test("emergency fund arrival uses the amount kept as cash after investment allocation", () => {
  const plan: LifePlan = {
    ...basePlan,
    household: {
      monthlyIncome: 280000,
      annualBonus: 0,
      sideIncome: 0,
      fixedCost: 150000,
      variableCost: 70000,
      annualSpecialCost: 360000
    },
    assets: { ...basePlan.assets, cash: 1200000 },
    simulation: { ...basePlan.simulation, monthlyInvestmentAmount: 20000 }
  };

  const result = getEmergencyFundResult(plan);

  assert.equal(getBasicProjectionAllocation(plan).monthlyCash, 10000);
  assert.equal(result.shortageToLower, 300000);
  assert.equal(result.monthsToLower, 30);
});

test("asset projection applies monthly savings and life event impact by year", () => {
  const plan: LifePlan = {
    ...basePlan,
    household: {
      monthlyIncome: 110000,
      annualBonus: 0,
      sideIncome: 0,
      fixedCost: 100000,
      variableCost: 0,
      annualSpecialCost: 0
    },
    assets: {
      cash: 1000000,
      investment: 0,
      other: 0,
      debt: 0
    },
    events: [
      {
        id: "event-1",
        title: "expense",
        category: "other",
        year: currentYear + 1,
        month: 6,
        age: 36,
        amount: 120000,
        cashflowType: "expense",
        memo: ""
      }
    ],
    simulation: { ...basePlan.simulation, annualReturnRate: 0 }
  };

  const projection = projectAssets(plan, 2);

  assert.equal(projection[0].value, 1000000);
  assert.equal(projection[1].value, 1000000);
  assert.equal(projection[2].value, 1120000);
});

test("future cashflow periods replace only the selected household field during the selected years", () => {
  const plan: LifePlan = {
    ...basePlan,
    cashflowPeriods: [
      {
        id: "income-period",
        title: "career break",
        owner: "self",
        target: "monthlyIncome",
        startYear: currentYear + 1,
        endYear: currentYear + 2,
        amount: 180000,
        memo: ""
      },
      {
        id: "later-income-period",
        title: "new job",
        owner: "self",
        target: "monthlyIncome",
        startYear: currentYear + 2,
        endYear: currentYear + 3,
        amount: 400000,
        memo: ""
      }
    ]
  };

  assert.equal(getHouseholdForYear(plan, currentYear).monthlyIncome, basePlan.household.monthlyIncome);
  assert.equal(getHouseholdForYear(plan, currentYear + 1).monthlyIncome, 180000);
  assert.equal(getHouseholdForYear(plan, currentYear + 2).monthlyIncome, 400000);
  assert.equal(getHouseholdForYear(plan, currentYear + 4).monthlyIncome, basePlan.household.monthlyIncome);
  assert.equal(getHouseholdForYear(plan, currentYear + 2).fixedCost, basePlan.household.fixedCost);
});

test("detailed cashflow mode sums active items and never adds basic household values", () => {
  const plan: LifePlan = {
    ...basePlan,
    cashflowMode: "detailed",
    household: {
      monthlyIncome: 9000000,
      annualBonus: 9000000,
      sideIncome: 9000000,
      fixedCost: 9000000,
      variableCost: 9000000,
      annualSpecialCost: 9000000
    },
    detailedCashflowItems: [
      {
        id: "self-income",
        title: "本人収入",
        memberId: "member-self",
        target: "monthlyIncome",
        startYear: currentYear,
        endYear: currentYear + 2,
        amount: 200000,
        memo: ""
      },
      {
        id: "spouse-income",
        title: "配偶者収入",
        memberId: null,
        target: "monthlyIncome",
        startYear: currentYear,
        endYear: currentYear + 2,
        amount: 100000,
        memo: ""
      },
      {
        id: "bonus",
        title: "賞与",
        memberId: "member-self",
        target: "annualBonus",
        startYear: currentYear,
        endYear: currentYear + 2,
        amount: 240000,
        memo: ""
      },
      {
        id: "side-income",
        title: "副業",
        memberId: "member-self",
        target: "sideIncome",
        startYear: currentYear,
        endYear: currentYear + 2,
        amount: 20000,
        memo: ""
      },
      {
        id: "expired-side-income",
        title: "終了済み副業",
        memberId: "member-self",
        target: "sideIncome",
        startYear: currentYear - 2,
        endYear: currentYear - 1,
        amount: 9000000,
        memo: ""
      },
      {
        id: "fixed-cost",
        title: "固定費",
        memberId: null,
        target: "fixedCost",
        startYear: currentYear,
        endYear: currentYear + 2,
        amount: 90000,
        memo: ""
      },
      {
        id: "variable-cost",
        title: "変動費",
        memberId: null,
        target: "variableCost",
        startYear: currentYear,
        endYear: currentYear + 2,
        amount: 50000,
        memo: ""
      },
      {
        id: "special-cost",
        title: "年間特別支出",
        memberId: null,
        target: "annualSpecialCost",
        startYear: currentYear,
        endYear: currentYear + 2,
        amount: 120000,
        memo: ""
      }
    ],
    cashflowPeriods: [
      {
        id: "ignored-basic-period",
        title: "詳細方式では無視",
        owner: "household",
        target: "monthlyIncome",
        startYear: currentYear,
        endYear: currentYear + 2,
        amount: 8000000,
        memo: ""
      }
    ],
    assets: { cash: 0, investment: 0, other: 0, debt: 0 },
    events: [],
    simulation: { ...basePlan.simulation, annualReturnRate: 0 }
  };

  const currentHousehold = getHouseholdForYear(plan, currentYear);
  const nextHousehold = getHouseholdForYear(plan, currentYear + 1);
  const currentCashflow = getCurrentCashflowSummary(plan);
  const annualRow = getAnnualProjectionRows(plan, 1)[1];

  assert.deepEqual(currentHousehold, {
    monthlyIncome: 300000,
    annualBonus: 240000,
    sideIncome: 20000,
    fixedCost: 90000,
    variableCost: 50000,
    annualSpecialCost: 120000
  });
  assert.equal(nextHousehold.sideIncome, 20000);
  assert.equal(currentCashflow.annualIncome, 4080000);
  assert.equal(currentCashflow.annualLivingCost, 1800000);
  assert.equal(annualRow.annualSavings, 2280000);
  assert.ok(annualRow.cashflowChangeTitles.includes("本人収入"));
  assert.ok(!annualRow.cashflowChangeTitles.includes("詳細方式では無視"));
});

test("basic cashflow conversion preserves overlapping period assumptions and annual projections", () => {
  const basicPlan: LifePlan = {
    ...basePlan,
    cashflowMode: "basic",
    cashflowPeriods: [
      {
        id: "leave-income",
        title: "育休中の収入",
        owner: "self",
        target: "monthlyIncome",
        startYear: currentYear + 1,
        endYear: currentYear + 2,
        amount: 180000,
        memo: ""
      },
      {
        id: "new-job-income",
        title: "転職後の収入",
        owner: "self",
        target: "monthlyIncome",
        startYear: currentYear + 2,
        endYear: currentYear + 6,
        amount: 400000,
        memo: ""
      },
      {
        id: "education-cost",
        title: "教育費",
        owner: "child",
        target: "annualSpecialCost",
        startYear: currentYear + 3,
        endYear: currentYear + 5,
        amount: 900000,
        memo: ""
      }
    ],
    assets: { cash: 1000000, investment: 0, other: 0, debt: 0 },
    events: [],
    simulation: { ...basePlan.simulation, annualReturnRate: 0 }
  };
  let id = 0;
  const detailedItems = convertBasicCashflowToDetailedItems(basicPlan, () => `converted-${id += 1}`);
  const detailedPlan: LifePlan = {
    ...basicPlan,
    cashflowMode: "detailed",
    detailedCashflowItems: detailedItems
  };

  for (let offset = 0; offset <= 8; offset += 1) {
    assert.deepEqual(
      getHouseholdForYear(detailedPlan, currentYear + offset),
      getHouseholdForYear(basicPlan, currentYear + offset)
    );
  }

  const basicRows = getAnnualProjectionRows(basicPlan, 8);
  const detailedRows = getAnnualProjectionRows(detailedPlan, 8);
  assert.deepEqual(
    detailedRows.map((row) => ({
      value: row.value,
      annualIncome: row.annualIncome,
      annualLivingCost: row.annualLivingCost,
      annualSavings: row.annualSavings
    })),
    basicRows.map((row) => ({
      value: row.value,
      annualIncome: row.annualIncome,
      annualLivingCost: row.annualLivingCost,
      annualSavings: row.annualSavings
    }))
  );
});

test("annual cashflow rows expose income, expenses, events, and balances from one projection", () => {
  const plan: LifePlan = {
    ...basePlan,
    household: {
      monthlyIncome: 200000,
      annualBonus: 120000,
      sideIncome: 20000,
      fixedCost: 100000,
      variableCost: 30000,
      annualSpecialCost: 120000
    },
    householdMembers: [
      ...basePlan.householdMembers,
      {
        id: "child-a",
        displayName: "子どもA",
        relationship: "child",
        birthYear: currentYear - 10,
        birthMonth: new Date().getMonth() + 1
      }
    ],
    cashflowPeriods: [
      {
        id: "income-period",
        title: "income change",
        owner: "self",
        target: "monthlyIncome",
        startYear: currentYear,
        endYear: currentYear + 2,
        amount: 250000,
        memo: ""
      }
    ],
    assets: { cash: 0, investment: 0, other: 0, debt: 0 },
    events: [],
    simulation: { ...basePlan.simulation, annualReturnRate: 0 }
  };

  const row = getAnnualProjectionRows(plan, 1)[1];

  assert.equal(row.annualIncome, 3360000);
  assert.equal(row.annualLivingCost, 1680000);
  assert.equal(row.annualSavings, 1680000);
  assert.equal(row.eventIncome, 0);
  assert.equal(row.eventExpense, 0);
  assert.equal(row.netCashflow, 1680000);
  assert.equal(row.cashBalance + row.investmentBalance, row.value);
  assert.deepEqual(row.incomeBreakdown, {
    mainIncome: 3000000,
    sideIncome: 240000,
    bonus: 120000,
    eventIncome: 0
  });
  assert.deepEqual(row.expenseBreakdown, {
    fixedCost: 1200000,
    variableCost: 360000,
    annualSpecialCost: 120000,
    eventExpense: 0
  });
  assert.deepEqual(row.cashflowChangeTitles, ["income change"]);
  assert.equal(row.memberAges.find((member) => member.relationship === "self")?.age, basePlan.profile.age + 1);
  assert.equal(row.memberAges.find((member) => member.id === "child-a")?.age, 11);
});

test("cashflow stress years explain annual deficits and emergency-fund shortfalls", () => {
  const plan: LifePlan = {
    ...basePlan,
    household: {
      monthlyIncome: 100000,
      annualBonus: 0,
      sideIncome: 0,
      fixedCost: 150000,
      variableCost: 0,
      annualSpecialCost: 0
    },
    cashflowPeriods: [],
    assets: { cash: 0, investment: 0, other: 0, debt: 0 },
    events: [],
    simulation: { ...basePlan.simulation, annualReturnRate: 0 }
  };
  const rows = getAnnualProjectionRows(plan, 2);
  const stressYears = getCashflowStressYears(plan, rows);

  assert.ok(stressYears.length > 0);
  assert.equal(stressYears[0].year, rows[2].year);
  assert.ok(stressYears[0].reasons.some((reason) => reason.includes("年間収支")));
  assert.ok(stressYears[0].reasons.some((reason) => reason.includes("生活防衛資金")));
});

test("asset projection combines expense, income, and neutral events in the same year", () => {
  const plan: LifePlan = {
    ...basePlan,
    household: {
      monthlyIncome: 100000,
      annualBonus: 0,
      sideIncome: 0,
      fixedCost: 100000,
      variableCost: 0,
      annualSpecialCost: 0
    },
    assets: {
      cash: 1000000,
      investment: 0,
      other: 0,
      debt: 0
    },
    events: [
      {
        id: "event-expense",
        title: "expense",
        category: "home",
        year: currentYear + 1,
        month: 4,
        age: 36,
        amount: 300000,
        cashflowType: "expense",
        memo: ""
      },
      {
        id: "event-income",
        title: "income",
        category: "career",
        year: currentYear + 1,
        month: 4,
        age: 36,
        amount: 100000,
        cashflowType: "income",
        memo: ""
      },
      {
        id: "event-neutral",
        title: "neutral",
        category: "other",
        year: currentYear + 1,
        month: 4,
        age: 36,
        amount: 900000,
        cashflowType: "neutral",
        memo: ""
      }
    ],
    simulation: { ...basePlan.simulation, annualReturnRate: 0 }
  };

  const projection = projectAssets(plan, 1);
  const rows = getAnnualProjectionRows(plan, 1);

  assert.equal(projection[1].value, 800000);
  assert.equal(rows[1].eventImpact, -200000);
  assert.deepEqual(rows[1].eventTitles, ["expense", "income", "neutral"]);
});

test("annual projection rows expose savings and event markers for each year", () => {
  const eventDate = new Date(currentYear, new Date().getMonth() + 6, 1);
  const plan: LifePlan = {
    ...basePlan,
    household: {
      monthlyIncome: 110000,
      annualBonus: 0,
      sideIncome: 0,
      fixedCost: 100000,
      variableCost: 0,
      annualSpecialCost: 0
    },
    assets: {
      cash: 1000000,
      investment: 0,
      other: 0,
      debt: 0
    },
    events: [
      {
        id: "event-1",
        title: "home repair",
        category: "home",
        year: eventDate.getFullYear(),
        month: eventDate.getMonth() + 1,
        age: 36,
        amount: 120000,
        cashflowType: "expense",
        memo: ""
      }
    ],
    simulation: { ...basePlan.simulation, annualReturnRate: 0 }
  };

  const rows = getAnnualProjectionRows(plan, 1);

  assert.equal(rows[0].annualSavings, 0);
  assert.equal(rows[1].annualSavings, 120000);
  assert.equal(rows[1].eventImpact, -120000);
  assert.equal(rows[1].returnImpact, 0);
  assert.deepEqual(rows[1].eventTitles, ["home repair"]);
});

test("annual projection includes upcoming current-year events and matches the 12-month snapshot", () => {
  const eventDate = new Date(currentYear, new Date().getMonth() + 1, 1);
  const plan: LifePlan = {
    ...basePlan,
    household: {
      monthlyIncome: 100000,
      annualBonus: 0,
      sideIncome: 0,
      fixedCost: 100000,
      variableCost: 0,
      annualSpecialCost: 0
    },
    assets: { cash: 1000000, investment: 0, other: 0, debt: 0 },
    events: [
      {
        id: "current-year-event",
        title: "upcoming expense",
        category: "other",
        year: eventDate.getFullYear(),
        month: eventDate.getMonth() + 1,
        age: 35,
        amount: 100000,
        cashflowType: "expense",
        memo: ""
      }
    ],
    simulation: { ...basePlan.simulation, annualReturnRate: 0 }
  };

  const annualRows = getAnnualProjectionRows(plan, 1);
  const monthlyRows = getMonthlyProjectionRows(plan, 12);

  assert.equal(annualRows[1].eventImpact, -100000);
  assert.deepEqual(annualRows[1].eventTitles, ["upcoming expense"]);
  assert.equal(annualRows[1].value, monthlyRows[12].value);
});

test("annual projection rows apply returns only to investment assets", () => {
  const plan: LifePlan = {
    ...basePlan,
    household: {
      monthlyIncome: 100000,
      annualBonus: 0,
      sideIncome: 0,
      fixedCost: 0,
      variableCost: 0,
      annualSpecialCost: 0
    },
    assets: {
      cash: 0,
      investment: 1000000,
      other: 0,
      debt: 0
    },
    events: [],
    simulation: { ...basePlan.simulation, annualReturnRate: 3 }
  };

  const rows = getAnnualProjectionRows(plan, 1);
  const expectedReturnImpact = rows[1].value - rows[0].value - rows[1].annualSavings - rows[1].eventImpact;

  assert.equal(rows[1].annualSavings, 1200000);
  assert.equal(rows[1].eventImpact, 0);
  assert.equal(rows[1].returnImpact, expectedReturnImpact);
  assertAlmostEqual(rows[1].returnImpact, 1000000 * ((1 + 0.03 / 12) ** 12 - 1));
});

test("basic projection keeps cash, other assets, and debt outside return calculations", () => {
  const plan: LifePlan = {
    ...basePlan,
    household: {
      monthlyIncome: 100000,
      annualBonus: 0,
      sideIncome: 0,
      fixedCost: 100000,
      variableCost: 0,
      annualSpecialCost: 0
    },
    assets: {
      cash: 1000000,
      investment: 0,
      other: 500000,
      debt: 400000
    },
    events: [],
    simulation: { ...basePlan.simulation, annualReturnRate: 10 }
  };

  const rows = getAnnualProjectionRows(plan, 1);

  assert.equal(rows[0].value, 1100000);
  assert.equal(rows[1].value, 1100000);
  assert.equal(rows[1].returnImpact, 0);
});

test("annual bonus is reflected once per projection year", () => {
  const plan: LifePlan = {
    ...basePlan,
    household: {
      monthlyIncome: 100000,
      annualBonus: 120000,
      sideIncome: 0,
      fixedCost: 100000,
      variableCost: 0,
      annualSpecialCost: 0
    },
    assets: {
      cash: 1000000,
      investment: 0,
      other: 0,
      debt: 0
    },
    events: [],
    simulation: { ...basePlan.simulation, annualReturnRate: 5 }
  };

  const annualRows = getAnnualProjectionRows(plan, 1);
  const monthlyRows = getMonthlyProjectionRows(plan, 12);

  assert.equal(annualRows[1].annualSavings, 120000);
  assert.equal(annualRows[1].value, 1120000);
  assert.equal(annualRows[1].returnImpact, 0);
  assert.equal(monthlyRows[11].bonusSavings, 0);
  assert.equal(monthlyRows[12].bonusSavings, 120000);
  assert.equal(monthlyRows[12].value, 1120000);
});

test("basic projection splits household surplus and bonus between cash and investments", () => {
  const plan: LifePlan = {
    ...basePlan,
    household: {
      monthlyIncome: 100000,
      annualBonus: 120000,
      sideIncome: 0,
      fixedCost: 0,
      variableCost: 0,
      annualSpecialCost: 0
    },
    assets: { cash: 0, investment: 0, other: 0, debt: 0 },
    events: [],
    simulation: {
      ...basePlan.simulation,
      monthlyInvestmentAmount: 60000,
      annualBonusInvestmentAmount: 80000,
      annualReturnRate: 12
    }
  };
  const monthlyRate = 0.12 / 12;
  const expectedInvestment = 60000 * (((1 + monthlyRate) ** 12 - 1) / monthlyRate) + 80000;
  const expectedCash = 40000 * 12 + 40000;

  const allocation = getBasicProjectionAllocation(plan);
  const annualRows = getAnnualProjectionRows(plan, 1);
  const monthlyRows = getMonthlyProjectionRows(plan, 12);

  assert.deepEqual(allocation, {
    monthlySurplus: 100000,
    requestedMonthlyInvestment: 60000,
    monthlyInvestment: 60000,
    monthlyCash: 40000,
    monthlyInvestmentExcess: 0,
    annualBonus: 120000,
    requestedAnnualBonusInvestment: 80000,
    annualBonusInvestment: 80000,
    annualBonusCash: 40000,
    annualBonusInvestmentExcess: 0
  });
  assertAlmostEqual(annualRows[1].value, expectedInvestment + expectedCash);
  assert.equal(monthlyRows[1].monthlyInvestmentContribution, 60000);
  assert.equal(monthlyRows[12].bonusInvestmentContribution, 80000);
  assertAlmostEqual(monthlyRows[12].value, expectedInvestment + expectedCash);
});

test("basic projection caps investment allocation at available surplus and bonus", () => {
  const plan: LifePlan = {
    ...basePlan,
    household: {
      monthlyIncome: 100000,
      annualBonus: 100000,
      sideIncome: 0,
      fixedCost: 50000,
      variableCost: 0,
      annualSpecialCost: 0
    },
    assets: { cash: 0, investment: 0, other: 0, debt: 0 },
    events: [],
    simulation: {
      ...basePlan.simulation,
      monthlyInvestmentAmount: 80000,
      annualBonusInvestmentAmount: 150000,
      annualReturnRate: 0
    }
  };

  const allocation = getBasicProjectionAllocation(plan);
  const projection = projectAssets(plan, 1);

  assert.equal(allocation.monthlyInvestment, 50000);
  assert.equal(allocation.monthlyCash, 0);
  assert.equal(allocation.monthlyInvestmentExcess, 30000);
  assert.equal(allocation.annualBonusInvestment, 100000);
  assert.equal(allocation.annualBonusCash, 0);
  assert.equal(allocation.annualBonusInvestmentExcess, 50000);
  assert.equal(projection[1].value, 700000);
});

test("monthly projection rows expose short-term savings changes", () => {
  const eventDate = new Date(currentYear, new Date().getMonth() + 2, 1);
  const plan: LifePlan = {
    ...basePlan,
    household: {
      monthlyIncome: 150000,
      annualBonus: 0,
      sideIncome: 0,
      fixedCost: 50000,
      variableCost: 0,
      annualSpecialCost: 0
    },
    assets: {
      cash: 1000000,
      investment: 0,
      other: 0,
      debt: 0
    },
    events: [
      {
        id: "event-monthly",
        title: "monthly expense",
        category: "other",
        year: eventDate.getFullYear(),
        month: eventDate.getMonth() + 1,
        age: 35,
        amount: 50000,
        cashflowType: "expense",
        memo: ""
      }
    ],
    simulation: { ...basePlan.simulation, annualReturnRate: 0 }
  };

  const rows = getMonthlyProjectionRows(plan, 2);

  assert.equal(rows.length, 3);
  assert.equal(rows[0].value, 1000000);
  assert.equal(rows[1].value, 1100000);
  assert.equal(rows[2].value, 1150000);
  assert.equal(rows[1].monthlySavings, 100000);
  assert.equal(rows[2].eventImpact, -50000);
  assert.equal(rows[1].returnImpact, 0);
});

test("goal funding summary detects allocations that reuse the same monthly surplus", () => {
  const plan: LifePlan = {
    ...basePlan,
    household: {
      monthlyIncome: 200000,
      annualBonus: 600000,
      sideIncome: 0,
      fixedCost: 100000,
      variableCost: 0,
      annualSpecialCost: 0
    },
    goals: [
      {
        id: "goal-active",
        title: "one-time",
        goalType: "oneTime",
        dueYear: currentYear + 2,
        dueMonth: 12,
        requiredAmount: 500000,
        savedAmount: 0,
        monthlyAllocation: 70000,
        recurrence: "yearly",
        priority: "high",
        progress: 0,
        memo: ""
      },
      {
        id: "goal-recurring",
        title: "recurring",
        goalType: "recurring",
        dueYear: currentYear + 1,
        dueMonth: 6,
        requiredAmount: 120000,
        savedAmount: 0,
        monthlyAllocation: 50000,
        recurrence: "yearly",
        priority: "medium",
        progress: 0,
        memo: ""
      },
      {
        id: "goal-achieved",
        title: "achieved",
        goalType: "oneTime",
        dueYear: currentYear,
        dueMonth: 12,
        requiredAmount: 100000,
        savedAmount: 100000,
        monthlyAllocation: 40000,
        recurrence: "yearly",
        priority: "low",
        progress: 100,
        memo: ""
      }
    ]
  };

  const summary = getGoalFundingSummary(plan);

  assert.equal(summary.monthlyAvailable, 100000);
  assert.equal(summary.monthlyAllocated, 120000);
  assert.equal(summary.monthlyRemaining, -20000);
  assert.equal(summary.overAllocatedAmount, 20000);
  assert.equal(summary.activeGoalCount, 2);
});

test("goal prepared percent is based on saved amount or recurring annual preparation", () => {
  assert.equal(
    getGoalPreparedPercent({
      ...basePlan.goals[0],
      goalType: "oneTime",
      requiredAmount: 5000000,
      savedAmount: 2500000
    }),
    50
  );

  assert.equal(
    getGoalPreparedPercent({
      ...basePlan.goals[0],
      goalType: "recurring",
      requiredAmount: 120000,
      recurrence: "monthly",
      monthlyAllocation: 60000,
      savedAmount: 0
    }),
    50
  );
});

test("mortgage emergency fund uses a 9 to 12 month range and the lower bound for shortage", () => {
  const plan: LifePlan = {
    ...basePlan,
    profile: {
      ...basePlan.profile,
      housing: "mortgage"
    },
    household: {
      monthlyIncome: 330000,
      annualBonus: 0,
      sideIncome: 0,
      fixedCost: 180000,
      variableCost: 70000,
      annualSpecialCost: 0
    },
    assets: {
      ...basePlan.assets,
      cash: 1500000
    }
  };

  const result = getEmergencyFundResult(plan);

  assert.equal(result.lowerMonths, 9);
  assert.equal(result.upperMonths, 12);
  assert.equal(result.lowerAmount, 2250000);
  assert.equal(result.upperAmount, 3000000);
  assert.equal(result.shortageToLower, 750000);
});

test("goal achievement age is based on saved amount and monthly allocation", () => {
  const plan: LifePlan = {
    ...basePlan,
    profile: { ...basePlan.profile, age: 40 },
    household: {
      monthlyIncome: 300000,
      annualBonus: 0,
      sideIncome: 0,
      fixedCost: 250000,
      variableCost: 0,
      annualSpecialCost: 0
    },
    assets: {
      cash: 1000000,
      investment: 0,
      other: 0,
      debt: 0
    }
  };

  const achievement = getGoalAchievement(plan, {
    id: "goal-1",
    title: "target",
    goalType: "oneTime",
    dueYear: currentYear + 3,
    requiredAmount: 2200000,
    savedAmount: 1000000,
    monthlyAllocation: 50000,
    recurrence: "yearly",
    priority: "high",
    progress: 0,
    memo: ""
  });

  assert.equal(achievement.status, "reachable");
  assert.equal(achievement.shortfall, 1200000);
  assert.equal(achievement.targetAge, 42);
  assert.equal(achievement.targetYear, currentYear + 2);
  assert.equal(achievement.monthsToTarget, 24);
});

test("goal achievement within one month does not add a full year to the displayed age", () => {
  const targetDate = new Date(currentYear, new Date().getMonth() + 1, 1);
  const achievement = getGoalAchievement(
    { ...basePlan, profile: { ...basePlan.profile, age: 40 } },
    {
      id: "goal-short",
      title: "short target",
      goalType: "oneTime",
      dueYear: targetDate.getFullYear(),
      dueMonth: targetDate.getMonth() + 1,
      requiredAmount: 100000,
      savedAmount: 0,
      monthlyAllocation: 100000,
      recurrence: "yearly",
      priority: "high",
      progress: 0,
      memo: ""
    }
  );

  assert.equal(achievement.monthsToTarget, 1);
  assert.equal(achievement.targetAge, 40);
  assert.equal(achievement.targetYear, targetDate.getFullYear());
  assert.equal(achievement.monthlyRequiredAmount, 100000);
});

test("next event excludes past months and sorts same-year events by month", () => {
  const now = new Date();
  const pastDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const earlierFutureDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const laterFutureDate = new Date(now.getFullYear(), now.getMonth() + 2, 1);
  const event = (id: string, date: Date): LifePlan["events"][number] => ({
    id,
    title: id,
    category: "other",
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    age: 35,
    amount: 0,
    cashflowType: "neutral",
    memo: ""
  });

  const next = getNextEvent([
    event("past", pastDate),
    event("later", laterFutureDate),
    event("earlier", earlierFutureDate)
  ]);

  assert.equal(next?.id, "earlier");
});

test("goal achievement reports unreachable when monthly allocation is not positive", () => {
  const plan: LifePlan = {
    ...basePlan,
    household: {
      monthlyIncome: 100000,
      annualBonus: 0,
      sideIncome: 0,
      fixedCost: 100000,
      variableCost: 20000,
      annualSpecialCost: 0
    }
  };

  const achievement = getGoalAchievement(plan, {
    id: "goal-2",
    title: "target",
    goalType: "oneTime",
    dueYear: currentYear + 3,
    requiredAmount: 10000000,
    savedAmount: 0,
    monthlyAllocation: 0,
    recurrence: "yearly",
    priority: "medium",
    progress: 0,
    memo: ""
  });

  assert.equal(achievement.status, "unreachable");
  assert.equal(achievement.targetAge, null);
  assert.equal(achievement.targetYear, null);
});

test("goal achievement reports achieved when saved amount already meets required amount", () => {
  const achievement = getGoalAchievement(basePlan, {
    id: "goal-3",
    title: "target",
    goalType: "oneTime",
    dueYear: currentYear,
    requiredAmount: 1000000,
    savedAmount: 1000000,
    monthlyAllocation: 0,
    recurrence: "yearly",
    priority: "low",
    progress: 100,
    memo: ""
  });

  assert.equal(achievement.status, "achieved");
  assert.equal(achievement.targetAge, basePlan.profile.age);
  assert.equal(achievement.shortfall, 0);
});

test("recurring goals show annual and monthly required amounts", () => {
  const achievement = getGoalAchievement(basePlan, {
    id: "goal-4",
    title: "travel",
    goalType: "recurring",
    dueYear: currentYear + 1,
    requiredAmount: 200000,
    savedAmount: 0,
    monthlyAllocation: 17000,
    recurrence: "halfYearly",
    priority: "medium",
    progress: 0,
    memo: ""
  });

  assert.equal(achievement.status, "recurring");
  assert.equal(achievement.annualRequiredAmount, 400000);
  assert.equal(achievement.monthlyRequiredAmount, 33334);
  assert.equal(achievement.targetAge, basePlan.profile.age + 1);
});

test("zero-return contribution simulation matches total contributions exactly", () => {
  const result = simulateContribution({
    monthlyContribution: 10000,
    bonusContribution: 20000,
    annualReturnRate: 0,
    years: 2
  });

  assert.equal(result.totalContribution, 280000);
  assert.equal(result.finalValue, 280000);
  assert.equal(result.noReturnValue, 280000);
  assert.equal(result.increasedByTenThousand, 520000);
  assert.equal(result.rateComparisons.find((item) => item.rate === 0)?.value, 280000);
});

test("positive-return contribution simulation follows monthly compound assumptions", () => {
  const monthlyContribution = 10000;
  const bonusContribution = 120000;
  const annualReturnRate = 12;
  const years = 1;
  const monthlyRate = annualReturnRate / 100 / 12;
  const months = years * 12;
  const expectedMonthlyFutureValue = monthlyContribution * (((1 + monthlyRate) ** months - 1) / monthlyRate);
  const expectedFinalValue = expectedMonthlyFutureValue + bonusContribution;

  const result = simulateContribution({
    monthlyContribution,
    bonusContribution,
    annualReturnRate,
    years
  });

  assertAlmostEqual(result.finalValue, expectedFinalValue);
  assert.equal(result.totalContribution, 240000);
  assert.ok(result.finalValue > result.noReturnValue);
});

test("contribution projection rows expose yearly contribution and return impact", () => {
  const rows = getContributionProjectionRows({
    monthlyContribution: 10000,
    bonusContribution: 120000,
    annualReturnRate: 0,
    years: 2
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].contribution, 240000);
  assert.equal(rows[0].value, 240000);
  assert.equal(rows[0].returnImpact, 0);
  assert.equal(rows[1].contribution, 480000);
  assert.equal(rows[1].value, 480000);
});

test("contribution variability is deterministic and exposes percentile and mode ranges", () => {
  const settings = {
    monthlyContribution: 30000,
    bonusContribution: 120000,
    annualReturnRate: 4,
    years: 10
  };
  const first = simulateContributionVariability(settings, 12, 80);
  const second = simulateContributionVariability(settings, 12, 80);

  assert.equal(first.rows.length, 10);
  assert.deepEqual(first, second);
  assert.ok(first.lowerFinal <= first.medianFinal);
  assert.ok(first.medianFinal <= first.upperFinal);
  assert.ok(Number.isFinite(first.modeFinal));
  assert.equal(first.trialCount, 80);
  assert.equal(first.depletionRate, 0);
});

test("monte carlo simulations default to one thousand trials", () => {
  const result = simulateContributionVariability({
    monthlyContribution: 10000,
    bonusContribution: 0,
    annualReturnRate: 3,
    years: 1
  });

  assert.equal(result.trialCount, 1000);
  assert.ok(Number.isFinite(result.modeFinal));
});

test("withdrawal simulation reports depletion age and final assets from assumptions", () => {
  const result = simulateWithdrawal({
    startAge: 65,
    currentAssets: 1000000,
    monthlyLivingCost: 200000,
    monthlyPension: 100000,
    annualReturnRate: 0,
    inflationRate: 0,
    years: 5
  });

  assert.equal(result.rows[0].withdrawalAmount, 1200000);
  assert.equal(result.depletedAge, 65);
  assert.equal(result.finalAssets, 0);
});

test("simple withdrawal simulation supports a fixed monthly amount", () => {
  const result = simulateWithdrawal({
    startAge: 50,
    currentAssets: 6000000,
    monthlyLivingCost: 0,
    monthlyPension: 0,
    withdrawalMode: "monthlyAmount",
    monthlyWithdrawalAmount: 100000,
    annualReturnRate: 0,
    inflationRate: 0,
    years: 5
  });

  assert.equal(result.rows[0].withdrawalAmount, 1200000);
  assert.equal(result.depletedAge, 54);
  assert.equal(result.finalAssets, 0);
});

test("simple withdrawal rate uses starting assets as its fixed annual base", () => {
  const result = simulateWithdrawal({
    startAge: 60,
    currentAssets: 10000000,
    monthlyLivingCost: 0,
    monthlyPension: 0,
    withdrawalMode: "annualRate",
    annualWithdrawalRate: 4,
    annualReturnRate: 0,
    inflationRate: 0,
    years: 3
  });

  assert.equal(result.rows[0].withdrawalAmount, 400000);
  assert.equal(result.rows[2].withdrawalAmount, 400000);
  assert.equal(result.finalAssets, 8800000);
});

test("withdrawal simulation applies monthly withdrawals and monthly return effects", () => {
  const result = simulateWithdrawal({
    startAge: 60,
    currentAssets: 1000000,
    monthlyLivingCost: 0,
    monthlyPension: 0,
    withdrawalMode: "monthlyAmount",
    monthlyWithdrawalAmount: 10000,
    annualReturnRate: 12,
    inflationRate: 0,
    years: 1
  });
  let expected = 1000000;
  for (let month = 0; month < 12; month += 1) {
    expected = (expected - 10000) * 1.01;
  }

  assert.equal(result.finalAssets, Math.round(expected));
  assert.equal(result.rows[0].withdrawalAmount, 120000);
});

test("withdrawal simulation supports period-based income and living cost assumptions", () => {
  const result = simulateWithdrawal({
    startAge: 45,
    currentAssets: 10000000,
    monthlyLivingCost: 200000,
    monthlyPension: 0,
    annualReturnRate: 0,
    inflationRate: 0,
    years: 3,
    phases: [
      {
        label: "セミリタイア",
        startAge: 45,
        endAge: 46,
        monthlyIncome: 100000,
        monthlyLivingCost: 250000,
        annualExtraExpense: 120000
      },
      {
        label: "軽く働く期間",
        startAge: 47,
        endAge: 47,
        monthlyIncome: 200000,
        monthlyLivingCost: 220000,
        annualExtraExpense: 0
      }
    ]
  });

  assert.equal(result.rows[0].phaseLabel, "セミリタイア");
  assert.equal(result.rows[0].withdrawalAmount, 1920000);
  assert.equal(result.rows[2].phaseLabel, "軽く働く期間");
  assert.equal(result.rows[2].withdrawalAmount, 240000);
  assert.equal(result.finalAssets, 5920000);
});

test("withdrawal simulation carries the previous phase across schedule gaps", () => {
  const result = simulateWithdrawal({
    startAge: 60,
    currentAssets: 10000000,
    monthlyLivingCost: 0,
    monthlyPension: 0,
    annualReturnRate: 0,
    inflationRate: 0,
    years: 6,
    phases: [
      {
        label: "退職直後",
        startAge: 60,
        endAge: 61,
        monthlyIncome: 100000,
        monthlyLivingCost: 200000,
        annualExtraExpense: 0
      },
      {
        label: "年金開始後",
        startAge: 65,
        endAge: 70,
        monthlyIncome: 160000,
        monthlyLivingCost: 180000,
        annualExtraExpense: 0
      }
    ]
  });

  assert.equal(result.rows[2].age, 62);
  assert.equal(result.rows[2].phaseLabel, "退職直後");
  assert.equal(result.rows[4].age, 64);
  assert.equal(result.rows[4].withdrawalAmount, 1200000);
  assert.equal(result.rows[5].phaseLabel, "年金開始後");
});

test("withdrawal variability reports depletion cases from variable annual returns", () => {
  const result = simulateWithdrawalVariability(
    {
      startAge: 65,
      currentAssets: 1000000,
      monthlyLivingCost: 200000,
      monthlyPension: 100000,
      annualReturnRate: 0,
      inflationRate: 0,
      years: 5
    },
    12,
    80
  );

  assert.equal(result.rows.length, 5);
  assert.equal(result.trialCount, 80);
  assert.ok(Number.isFinite(result.modeFinal));
  assert.ok(result.depletionRate > 0);
  assert.ok(result.medianDepletedAge !== null);
});

test("retirement plan includes pension, health insurance, taxes and long-term care assumptions", () => {
  const result = simulateRetirementPlan({
    ...basePlan,
    profile: { ...basePlan.profile, age: 65 },
    household: {
      monthlyIncome: 0,
      annualBonus: 0,
      sideIncome: 0,
      fixedCost: 0,
      variableCost: 0,
      annualSpecialCost: 0
    },
    assets: {
      cash: 10000000,
      investment: 0,
      other: 0,
      debt: 0
    },
    retirementPlan: {
      retirementAge: 65,
      planUntilAge: 66,
      monthlyLivingCost: 200000,
      monthlyHousingCost: 0,
      monthlyMedicalCost: 0,
      monthlyCareCost: 0,
      monthlyPublicPension: 150000,
      monthlyPrivatePension: 0,
      monthlyOtherIncome: 0,
      monthlyHealthInsurance: 30000,
      monthlyLongTermCareInsurance: 10000,
      monthlyTaxes: 10000,
      annualExtraExpense: 120000,
      retirementLumpSum: 0,
      annualReturnRate: 0,
      inflationRate: 0
    }
  });

  assert.equal(result.retirementStartAssets, 10000000);
  assert.equal(result.firstYearTotalCost, 3120000);
  assert.equal(result.firstYearIncome, 1800000);
  assert.equal(result.firstYearWithdrawal, 1320000);
  assert.equal(result.rows[0].assets, 8680000);
});

test("retirement plan variability keeps percentile rows and depletion rate", () => {
  const result = simulateRetirementPlanVariability(
    {
      ...basePlan,
      profile: { ...basePlan.profile, age: 65 },
      household: {
        monthlyIncome: 0,
        annualBonus: 0,
        sideIncome: 0,
        fixedCost: 0,
        variableCost: 0,
        annualSpecialCost: 0
      },
      assets: {
        cash: 3000000,
        investment: 0,
        other: 0,
        debt: 0
      },
      retirementPlan: {
        ...basePlan.retirementPlan,
        retirementAge: 65,
        planUntilAge: 70,
        monthlyLivingCost: 250000,
        monthlyPublicPension: 100000,
        annualReturnRate: 0,
        inflationRate: 0
      }
    },
    10,
    80
  );

  assert.equal(result.rows.length, 6);
  assert.equal(result.trialCount, 80);
  assert.ok(Number.isFinite(result.modeFinal));
  assert.ok(result.lowerFinal <= result.medianFinal);
  assert.ok(result.medianFinal <= result.upperFinal);
  assert.ok(result.depletionRate > 0);
  assert.equal(result.modeFinal, 0);
});

test("retirement plan uses pre-retirement projection and lump sum before withdrawals", () => {
  const result = simulateRetirementPlan({
    ...basePlan,
    profile: { ...basePlan.profile, age: 64 },
    household: {
      monthlyIncome: 0,
      annualBonus: 0,
      sideIncome: 0,
      fixedCost: 0,
      variableCost: 0,
      annualSpecialCost: 0
    },
    assets: {
      cash: 1000000,
      investment: 0,
      other: 0,
      debt: 0
    },
    retirementPlan: {
      ...basePlan.retirementPlan,
      retirementAge: 65,
      planUntilAge: 65,
      retirementLumpSum: 2000000,
      monthlyLivingCost: 0,
      monthlyHousingCost: 0,
      monthlyMedicalCost: 0,
      monthlyCareCost: 0,
      monthlyPublicPension: 0,
      monthlyPrivatePension: 0,
      monthlyOtherIncome: 0,
      monthlyHealthInsurance: 0,
      monthlyLongTermCareInsurance: 0,
      monthlyTaxes: 0,
      annualExtraExpense: 0,
      annualReturnRate: 0,
      inflationRate: 0
    }
  });

  assert.equal(result.startAge, 65);
  assert.equal(result.retirementStartAssets, 3000000);
  assert.equal(result.finalAssets, 3000000);
});

test("retirement withdrawal funds exclude other assets and debt", () => {
  const result = simulateRetirementPlan({
    ...basePlan,
    profile: { ...basePlan.profile, age: 65 },
    household: {
      monthlyIncome: 0,
      annualBonus: 0,
      sideIncome: 0,
      fixedCost: 0,
      variableCost: 0,
      annualSpecialCost: 0
    },
    assets: { cash: 1000000, investment: 2000000, other: 10000000, debt: 5000000 },
    retirementPlan: {
      ...basePlan.retirementPlan,
      retirementAge: 65,
      planUntilAge: 65,
      monthlyLivingCost: 0,
      monthlyHousingCost: 0,
      monthlyMedicalCost: 0,
      monthlyCareCost: 0,
      monthlyPublicPension: 0,
      monthlyPrivatePension: 0,
      monthlyOtherIncome: 0,
      monthlyHealthInsurance: 0,
      monthlyLongTermCareInsurance: 0,
      monthlyTaxes: 0,
      annualExtraExpense: 0,
      retirementLumpSum: 0,
      annualReturnRate: 0,
      inflationRate: 0
    }
  });

  assert.equal(result.retirementStartAssets, 3000000);
  assert.equal(result.finalAssets, 3000000);
});

test("negative monthly cashflow does not produce emergency-fund arrival months", () => {
  const plan: LifePlan = {
    ...basePlan,
    household: {
      monthlyIncome: 200000,
      annualBonus: 0,
      sideIncome: 0,
      fixedCost: 210000,
      variableCost: 90000,
      annualSpecialCost: 0
    },
    assets: { ...basePlan.assets, cash: 500000 }
  };

  const cashflow = getCashflowSummary(plan.household);
  const emergency = getEmergencyFundResult(plan);

  assert.equal(cashflow.monthlySavings, -100000);
  assert.equal(cashflow.savingsRate, -50);
  assert.equal(emergency.status, "short");
  assert.equal(emergency.monthsToLower, null);
});

test("asset projection can represent debt-heavy plans without clamping values", () => {
  const plan: LifePlan = {
    ...basePlan,
    household: {
      monthlyIncome: 0,
      annualBonus: 0,
      sideIncome: 0,
      fixedCost: 0,
      variableCost: 0,
      annualSpecialCost: 0
    },
    assets: {
      cash: 100000,
      investment: 100000,
      other: 0,
      debt: 500000
    },
    simulation: { ...basePlan.simulation, annualReturnRate: 0 }
  };

  const assetSummary = getAssetSummary(plan.assets);
  const projection = projectAssets(plan, 1);

  assert.equal(assetSummary.grossAssets, 200000);
  assert.equal(assetSummary.netAssets, -300000);
  assert.equal(projection[0].value, -300000);
  assert.equal(projection[1].value, -300000);
});

test("zero inputs stay finite across cashflow and contribution calculations", () => {
  const cashflow = getCashflowSummary({
    monthlyIncome: 0,
    annualBonus: 0,
    sideIncome: 0,
    fixedCost: 0,
    variableCost: 0,
    annualSpecialCost: 0
  });
  const contribution = simulateContribution({
    monthlyContribution: 0,
    bonusContribution: 0,
    annualReturnRate: 0,
    years: 0
  });

  assert.equal(cashflow.monthlyIncome, 0);
  assert.equal(cashflow.monthlyLivingCost, 0);
  assert.equal(cashflow.monthlySavings, 0);
  assert.equal(cashflow.savingsRate, 0);
  assert.equal(contribution.finalValue, 0);
  assert.equal(contribution.totalContribution, 0);
});

test("input completion items include the destination view for dashboard guidance", () => {
  const completion = getInputCompletion({
    ...basePlan,
    goals: [],
    events: [],
    notes: {
      general: "",
      spendingReview: ""
    }
  });

  assert.equal(completion.total, 7);
  assert.equal(completion.items.find((item) => item.label === "基本プロフィール")?.view, "profile");
  assert.equal(completion.items.find((item) => item.label === "資産")?.view, "assets");
  assert.equal(completion.items.find((item) => item.label === "ライフイベント")?.view, "events");
  assert.equal(completion.items.find((item) => item.label === "メモ")?.complete, false);
});

test("import validation rejects unrelated JSON and fills optional fields for legacy backups", () => {
  assert.throws(() => validateImportedPlan({}), /Life Compass/);
  assert.throws(() => validateImportedPlan(null), /JSON/);

  const imported = validateImportedPlan({
    ...basePlan,
    version: 0,
    profile: { ...basePlan.profile, familyType: "children" },
    householdMembers: undefined,
    events: [
      {
        id: "legacy-event",
        title: "legacy",
        category: "other",
        year: currentYear + 1,
        age: 36,
        amount: 0,
        cashflowType: "neutral",
        memo: ""
      }
    ],
    goals: [
      {
        id: "legacy-goal",
        title: "legacy goal",
        goalType: "oneTime",
        dueYear: currentYear + 2,
        requiredAmount: 100000,
        savedAmount: 0,
        monthlyAllocation: 10000,
        recurrence: "yearly",
        priority: "medium",
        progress: 0,
        memo: ""
      }
    ],
    timelineMemos: undefined,
    simulation: undefined,
    withdrawalPlan: undefined,
    retirementPlan: undefined,
    notes: undefined,
    reviews: undefined,
    scenarios: undefined,
    planRevisions: undefined,
    fixedCostItems: undefined,
    budgetItems: undefined
  });

  assert.equal(imported.version, CURRENT_PLAN_VERSION);
  assert.deepEqual(
    imported.householdMembers.map((member) => member.relationship),
    ["self", "child"]
  );
  assert.equal(imported.householdMembers[0].birthYear, currentYear - basePlan.profile.age);
  assert.deepEqual(imported.simulation, {
    monthlyInvestmentAmount: 0,
    annualBonusInvestmentAmount: 0,
    monthlyContribution: 50000,
    bonusContribution: 100000,
    annualReturnRate: 3,
    years: 30
  });
  assert.equal(imported.withdrawalPlan.startAge, 65);
  assert.equal(imported.withdrawalPlan.periods.length, 1);
  assert.equal(imported.retirementPlan.retirementAge, 65);
  assert.equal(imported.retirementPlan.monthlyPublicPension, 140000);
  assert.deepEqual(imported.notes, {
    general: "",
    spendingReview: ""
  });
  assert.equal(imported.events[0].month, 1);
  assert.equal(imported.events[0].owner, "household");
  assert.equal(imported.goals[0].dueMonth, 12);
  assert.deepEqual(imported.timelineMemos, []);
  assert.equal(imported.cashflowMode, "basic");
  assert.deepEqual(imported.detailedCashflowItems, []);
  assert.deepEqual(imported.cashflowPeriods, []);
  assert.deepEqual(imported.reviews, []);
  assert.deepEqual(imported.scenarios, []);
  assert.deepEqual(imported.planRevisions, []);
  assert.deepEqual(imported.fixedCostItems, []);
  assert.deepEqual(imported.budgetItems, []);
});

test("import validation normalizes household members and keeps one primary member", () => {
  const imported = validateImportedPlan({
    ...basePlan,
    householdMembers: [
      {
        id: "duplicate-member",
        displayName: "",
        relationship: "self",
        birthYear: 9999,
        birthMonth: 0
      },
      {
        id: "duplicate-member",
        displayName: "",
        relationship: "self",
        birthYear: null,
        birthMonth: null
      }
    ]
  });

  assert.equal(imported.householdMembers.length, 2);
  assert.equal(imported.householdMembers[0].displayName, "本人");
  assert.equal(imported.householdMembers[0].relationship, "self");
  assert.equal(imported.householdMembers[0].birthYear, MAX_PLAN_YEAR);
  assert.equal(imported.householdMembers[0].birthMonth, 1);
  assert.equal(imported.householdMembers[1].relationship, "other");
  assert.notEqual(imported.householdMembers[0].id, imported.householdMembers[1].id);
});

test("import validation adds a primary member when a custom list omits one", () => {
  const imported = validateImportedPlan({
    ...basePlan,
    householdMembers: [
      {
        id: "member-spouse-custom",
        displayName: "パートナー",
        relationship: "spouse",
        birthYear: 1992,
        birthMonth: 4
      }
    ]
  });

  assert.equal(imported.householdMembers[0].relationship, "self");
  assert.equal(imported.householdMembers[1].displayName, "パートナー");
});

test("legacy scenarios and plan revisions inherit normalized household members", () => {
  const revisionSource = createEmptyPlan();
  revisionSource.householdMembers = basePlan.householdMembers.map((member) => ({ ...member }));
  const revision = createPlanRevision(
    revisionSource,
    "legacy-revision",
    "旧計画版",
    "manual",
    "2026-07-01T00:00:00.000Z"
  );
  const scenario = {
    id: "legacy-scenario",
    name: "旧シナリオ",
    description: "",
    tag: "custom" as const,
    createdAt: "2026-07-01T00:00:00.000Z",
    snapshot: {
      ...createScenarioFromReview(
        basePlan,
        createPlanReview(basePlan, "legacy-review", "2026-07-01"),
        "temporary-scenario",
        "2026-07-01T00:00:00.000Z"
      ).snapshot,
      householdMembers: undefined
    }
  };

  const imported = validateImportedPlan({
    ...basePlan,
    scenarios: [scenario],
    planRevisions: [
      {
        ...revision,
        snapshot: { ...revision.snapshot, householdMembers: undefined }
      }
    ]
  });

  assert.deepEqual(imported.scenarios[0].snapshot.householdMembers, imported.householdMembers);
  assert.deepEqual(imported.planRevisions[0].snapshot.householdMembers, imported.householdMembers);
});

test("import validation normalizes future cashflow periods", () => {
  const imported = validateImportedPlan({
    ...basePlan,
    cashflowPeriods: [
      {
        id: "",
        title: "",
        owner: "invalid",
        target: "invalid",
        startYear: currentYear + 3,
        endYear: currentYear + 1,
        amount: -100,
        memo: undefined
      }
    ]
  });

  assert.equal(imported.cashflowPeriods.length, 1);
  assert.ok(imported.cashflowPeriods[0].id);
  assert.equal(imported.cashflowPeriods[0].title, "将来の収支変更");
  assert.equal(imported.cashflowPeriods[0].owner, "household");
  assert.equal(imported.cashflowPeriods[0].target, "monthlyIncome");
  assert.equal(imported.cashflowPeriods[0].startYear, currentYear + 3);
  assert.equal(imported.cashflowPeriods[0].endYear, currentYear + 3);
  assert.equal(imported.cashflowPeriods[0].amount, 0);
});

test("import validation normalizes and limits detailed cashflow items", () => {
  const imported = validateImportedPlan({
    ...basePlan,
    cashflowMode: "invalid",
    detailedCashflowItems: Array.from({ length: MAX_DETAILED_CASHFLOW_ITEMS + 2 }, (_, index) => ({
      id: index === 0 ? "" : `detail-${index}`,
      title: index === 0 ? "" : `item-${index}`,
      memberId: index === 1 ? "member-self" : "unknown-member",
      target: index === 0 ? "invalid" : "fixedCost",
      startYear: currentYear + 3,
      endYear: currentYear + 1,
      amount: index === 0 ? -100 : MAX_MONEY_AMOUNT + 1,
      memo: undefined
    }))
  });

  assert.equal(imported.cashflowMode, "basic");
  assert.equal(imported.detailedCashflowItems.length, MAX_DETAILED_CASHFLOW_ITEMS);
  assert.ok(imported.detailedCashflowItems[0].id);
  assert.equal(imported.detailedCashflowItems[0].title, "収支項目");
  assert.equal(imported.detailedCashflowItems[0].memberId, null);
  assert.equal(imported.detailedCashflowItems[0].target, "monthlyIncome");
  assert.equal(imported.detailedCashflowItems[0].endYear, currentYear + 3);
  assert.equal(imported.detailedCashflowItems[0].amount, 0);
  assert.equal(imported.detailedCashflowItems[1].memberId, "member-self");
  assert.equal(imported.detailedCashflowItems[1].amount, MAX_MONEY_AMOUNT);
});

test("import validation normalizes and limits plan revisions", () => {
  const plan = createEmptyPlan();
  const snapshot = createPlanRevision(
    plan,
    "source",
    "保存元",
    "manual",
    "2026-07-01T00:00:00.000Z"
  ).snapshot;
  const revisions = Array.from({ length: MAX_PLAN_REVISIONS + 2 }, (_, index) => ({
    id: "",
    title: "",
    createdAt: "invalid",
    source: "invalid",
    snapshot: {
      ...snapshot,
      household: { ...snapshot.household, monthlyIncome: index === 0 ? -1 : 300000 }
    }
  }));

  const imported = validateImportedPlan({ ...basePlan, planRevisions: revisions });

  assert.equal(imported.planRevisions.length, MAX_PLAN_REVISIONS);
  assert.ok(imported.planRevisions[0].id);
  assert.equal(imported.planRevisions[0].title, "保存した計画");
  assert.equal(imported.planRevisions[0].source, "manual");
  assert.equal(imported.planRevisions[0].snapshot.household.monthlyIncome, 0);
  assert.ok(Number.isFinite(Date.parse(imported.planRevisions[0].createdAt)));
});

test("import validation normalizes timeline memos", () => {
  const imported = validateImportedPlan({
    ...basePlan,
    timelineMemos: [
      {
        id: "memo-1",
        title: "確認",
        year: currentYear + 1,
        month: 20,
        owner: "invalid",
        memo: "見直す",
        showOnTimeline: undefined
      }
    ]
  });

  assert.equal(imported.timelineMemos.length, 1);
  assert.equal(imported.timelineMemos[0].month, 12);
  assert.equal(imported.timelineMemos[0].owner, "self");
  assert.equal(imported.timelineMemos[0].showOnTimeline, true);
});

test("import validation preserves and normalizes withdrawal plan settings", () => {
  const imported = validateImportedPlan({
    ...basePlan,
    withdrawalPlan: {
      startAge: 50.4,
      startingAssets: 8000000,
      years: 120,
      annualReturnRate: 3,
      inflationRate: 1,
      periods: [
        {
          id: "",
          label: "",
          startAge: 52,
          endAge: 50,
          monthlyIncome: Number.POSITIVE_INFINITY,
          monthlyLivingCost: 260000,
          annualExtraExpense: 300000
        }
      ]
    }
  });

  assert.equal(imported.withdrawalPlan.startAge, 50);
  assert.equal(imported.withdrawalPlan.startingAssets, 8000000);
  assert.equal(imported.withdrawalPlan.years, 80);
  assert.equal(imported.withdrawalPlan.periods.length, 1);
  assert.ok(imported.withdrawalPlan.periods[0].id);
  assert.equal(imported.withdrawalPlan.periods[0].label, "基本期間");
  assert.equal(imported.withdrawalPlan.periods[0].startAge, 52);
  assert.equal(imported.withdrawalPlan.periods[0].endAge, 52);
  assert.equal(imported.withdrawalPlan.periods[0].monthlyIncome, 120000);
  assert.equal(imported.withdrawalPlan.periods[0].monthlyLivingCost, 260000);
});

test("import validation normalizes budget item fields", () => {
  const imported = validateImportedPlan({
    ...basePlan,
    budgetItems: [
      {
        id: "",
        name: "",
        category: "unexpected",
        frequency: "weekly",
        budgetAmount: Number.POSITIVE_INFINITY,
        actuals: {
          "2026-06": 120000,
          "bad-key": 1000,
          "2026-07": "not-number"
        },
        memo: undefined
      }
    ]
  });

  assert.equal(imported.budgetItems.length, 1);
  assert.ok(imported.budgetItems[0].id);
  assert.equal(imported.budgetItems[0].name, "予算項目");
  assert.equal(imported.budgetItems[0].category, "other");
  assert.equal(imported.budgetItems[0].frequency, "monthlyVariable");
  assert.equal(imported.budgetItems[0].budgetAmount, 0);
  assert.deepEqual(imported.budgetItems[0].actuals, { "2026-06": 120000 });
});

test("import validation preserves review actual values and fills missing review fields", () => {
  const imported = validateImportedPlan({
    ...basePlan,
    reviews: [
      {
        id: "review-1",
        date: "2026-06-01",
        plannedNetAssets: 1000000,
        plannedMonthlySavings: 50000,
        plannedTenYearAssets: 5000000,
        plannedThirtyYearAssets: 12000000,
        plannedGoalTitle: "home",
        plannedGoalTargetAge: 45,
        actualNetAssets: 1100000,
        actualMonthlySavings: 60000,
        actualMonthlyExpenses: 240000,
        scenarioName: "spending review",
        scenarioAdoptedAt: "2026-05-01T00:00:00.000Z",
        reviewType: "quarterly",
        todo: "next check",
        todoDone: true,
        memo: "monthly check"
      },
      {
        id: "review-2",
        date: "2026-07-01",
        memo: ""
      }
    ],
    activeScenario: {
      name: "spending review",
      adoptedAt: "2026-05-01T00:00:00.000Z"
    }
  });

  assert.equal(imported.reviews.length, 2);
  assert.equal(imported.reviews[0].reviewType, "quarterly");
  assert.equal(imported.reviews[0].todo, "next check");
  assert.equal(imported.reviews[0].todoDone, true);
  assert.equal(imported.reviews[0].actualNetAssets, 1100000);
  assert.equal(imported.reviews[0].actualMonthlySavings, 60000);
  assert.equal(imported.reviews[0].actualMonthlyExpenses, 240000);
  assert.equal(imported.reviews[0].plannedTenYearAssets, 5000000);
  assert.equal(imported.reviews[0].plannedThirtyYearAssets, 12000000);
  assert.equal(imported.reviews[0].plannedGoalTitle, "home");
  assert.equal(imported.reviews[0].plannedGoalTargetAge, 45);
  assert.equal(imported.reviews[0].scenarioName, "spending review");
  assert.deepEqual(imported.activeScenario, {
    name: "spending review",
    adoptedAt: "2026-05-01T00:00:00.000Z"
  });
  assert.equal(imported.reviews[1].reviewType, "monthly");
  assert.equal(imported.reviews[1].todo, "");
  assert.equal(imported.reviews[1].todoDone, false);
  assert.equal(imported.reviews[1].plannedNetAssets, undefined);
  assert.equal(imported.reviews[1].actualNetAssets, undefined);
});

test("import validation normalizes malformed core fields and rejects future backups", () => {
  const imported = validateImportedPlan({
    ...basePlan,
    version: 1,
    profile: {
      name: 123,
      age: "forty",
      familyType: "invalid",
      workStyle: "invalid",
      housing: "invalid"
    },
    household: {
      monthlyIncome: "450000",
      annualBonus: -100,
      sideIncome: null,
      fixedCost: 120000,
      variableCost: 80000,
      annualSpecialCost: 240000
    },
    assets: {
      cash: "1000000",
      investment: 2000000,
      other: -500,
      debt: 300000
    },
    simulation: {
      monthlyContribution: -1,
      bonusContribution: 100000,
      annualReturnRate: "3",
      years: 999
    }
  });

  assert.equal(imported.profile.name, "マイプラン");
  assert.equal(imported.profile.age, 35);
  assert.equal(imported.profile.familyType, "single");
  assert.equal(imported.household.monthlyIncome, 0);
  assert.equal(imported.household.annualBonus, 0);
  assert.equal(imported.assets.cash, 0);
  assert.equal(imported.assets.other, 0);
  assert.equal(imported.simulation.monthlyInvestmentAmount, 0);
  assert.equal(imported.simulation.annualBonusInvestmentAmount, 0);
  assert.equal(imported.simulation.monthlyContribution, 0);
  assert.equal(imported.simulation.annualReturnRate, 3);
  assert.equal(imported.simulation.years, 80);

  assert.throws(
    () => validateImportedPlan({ ...basePlan, version: CURRENT_PLAN_VERSION + 1 }),
    /新しいバージョン/
  );
  assert.throws(() => validateImportedPlan({ ...basePlan, version: "2" }), /バージョン情報/);
});

test("import validation bounds calculation-heavy ages, rates, years and money values", () => {
  const imported = validateImportedPlan({
    ...basePlan,
    profile: { ...basePlan.profile, age: 999 },
    assets: { ...basePlan.assets, cash: MAX_MONEY_AMOUNT * 2 },
    simulation: { ...basePlan.simulation, annualReturnRate: 999, years: 999 },
    withdrawalPlan: {
      ...basePlan.withdrawalPlan,
      startAge: 999,
      years: 999,
      startingAssets: MAX_MONEY_AMOUNT * 2,
      annualWithdrawalRate: 999,
      annualReturnRate: 999,
      inflationRate: 999
    },
    retirementPlan: {
      ...basePlan.retirementPlan,
      retirementAge: 999,
      planUntilAge: 999,
      annualReturnRate: 999,
      inflationRate: 999
    }
  });

  assert.equal(imported.profile.age, MAX_PLAN_AGE);
  assert.equal(imported.assets.cash, MAX_MONEY_AMOUNT);
  assert.equal(imported.simulation.years, MAX_PROJECTION_YEARS);
  assert.equal(imported.simulation.annualReturnRate, MAX_RATE_PERCENT);
  assert.equal(imported.withdrawalPlan.startAge, MAX_PLAN_AGE);
  assert.equal(imported.withdrawalPlan.years, MAX_PROJECTION_YEARS);
  assert.equal(imported.withdrawalPlan.annualWithdrawalRate, MAX_RATE_PERCENT);
  assert.equal(imported.retirementPlan.retirementAge, MAX_PLAN_AGE);
  assert.equal(imported.retirementPlan.planUntilAge, MAX_PLAN_AGE);
  assert.ok(Number.isFinite(projectAssets(imported, 1)[1].value));
});

test("recovery backups keep the newest three plans and can be removed", () => {
  installMemoryStorage();

  for (let index = 1; index <= 4; index += 1) {
    createRecoveryBackup(
      { ...basePlan, profile: { ...basePlan.profile, name: `plan-${index}` } },
      index === 4 ? "before-import" : "before-reset"
    );
  }

  const backups = getRecoveryBackups();
  assert.equal(backups.length, 3);
  assert.equal(backups[0].plan.profile.name, "plan-4");
  assert.equal(backups[0].reason, "before-import");
  assert.equal(backups[2].plan.profile.name, "plan-2");
  assert.equal(backups.every((backup) => backup.plan.version === CURRENT_PLAN_VERSION), true);

  removeRecoveryBackup(backups[1].id);
  assert.equal(getRecoveryBackups().length, 2);
});

test("unreadable browser data is preserved before the default plan is loaded", () => {
  installMemoryStorage();
  localStorage.setItem(STORAGE_KEY, "{broken-json");

  const loaded = loadPlan();

  assert.equal(loaded.profile.name, "マイプラン");
  assert.equal(localStorage.getItem(`${RECOVERY_STORAGE_KEY}-unreadable`), "{broken-json");
});

test("storage write failures return a clear error without silently succeeding", () => {
  class FailingStorage extends MemoryStorage {
    setItem() {
      throw new Error("quota");
    }
  }

  installMemoryStorage(new FailingStorage());

  assert.throws(() => savePlan(basePlan), /ブラウザ内に保存できません/);
  assert.throws(() => createRecoveryBackup(basePlan, "before-reset"), /操作を中止/);
});

test("cloud backup encryption round-trips without exposing plan contents", async () => {
  const password = "correct horse battery staple";
  const envelope = await encryptCloudBackup(basePlan, password);
  const restored = await decryptCloudBackup(envelope, password);

  assert.equal(restored.profile.name, basePlan.profile.name);
  assert.deepEqual(restored.householdMembers, basePlan.householdMembers);
  assert.equal(restored.household.monthlyIncome, basePlan.household.monthlyIncome);
  assert.equal(JSON.stringify(envelope).includes(basePlan.profile.name), false);
  assert.equal(envelope.encryption.name, "AES-GCM");
  assert.equal(envelope.keyDerivation.iterations, 600_000);
});

test("cloud backups use unique randomness and reject wrong passwords or tampering", async () => {
  const password = "another secure recovery password";
  const first = await encryptCloudBackup(basePlan, password);
  const second = await encryptCloudBackup(basePlan, password);

  assert.notEqual(first.keyDerivation.salt, second.keyDerivation.salt);
  assert.notEqual(first.encryption.iv, second.encryption.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
  await assert.rejects(() => decryptCloudBackup(first, "this password is incorrect"), /違うか、バックアップが破損/);

  const replacement = first.ciphertext.endsWith("A") ? "B" : "A";
  const tampered = { ...first, ciphertext: `${first.ciphertext.slice(0, -1)}${replacement}` };
  await assert.rejects(() => decryptCloudBackup(tampered, password), /違うか、バックアップが破損|形式が正しくありません/);
});

test("cloud backup encryption rejects weak recovery passwords", async () => {
  await assert.rejects(() => encryptCloudBackup(basePlan, "short"), /12文字以上/);
});
