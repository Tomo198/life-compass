import test from "node:test";
import assert from "node:assert/strict";
import { CURRENT_PLAN_VERSION, RECOVERY_STORAGE_KEY, STORAGE_KEY } from "../src/config";
import {
  canOpenView,
  defaultAccessState,
  getEffectiveTier,
  getScenarioLimit,
  hasFeatureAccess,
  type AccessState
} from "../src/features";
import type { LifePlan } from "../src/types";
import { decryptCloudBackup, encryptCloudBackup } from "../src/utils/cloudBackupCrypto";
import {
  buildPlanFromScenario,
  getAssetSummary,
  getAnnualProjectionRows,
  getBudgetHouseholdInputs,
  getBudgetSummary,
  getCashflowSummary,
  getEmergencyFundMonths,
  getEmergencyFundResult,
  getFixedCostImpact,
  getContributionProjectionRows,
  getGoalAchievement,
  getGoalPreparedPercent,
  getInputCompletion,
  getMonthlyProjectionRows,
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

const currentYear = new Date().getFullYear();

test("preview access keeps Pro features available before billing is enabled", () => {
  assert.equal(defaultAccessState.tier, "free");
  assert.equal(defaultAccessState.mode, "preview");
  assert.equal(getEffectiveTier(defaultAccessState), "pro");
  assert.equal(hasFeatureAccess(defaultAccessState, "detailedWithdrawal"), true);
  assert.equal(canOpenView(defaultAccessState, "scenarios"), true);
  assert.equal(getScenarioLimit(defaultAccessState), 20);
});

test("enforced free access blocks Pro views and capabilities", () => {
  const access: AccessState = { tier: "free", mode: "enforced", source: "anonymous" };
  assert.equal(getEffectiveTier(access), "free");
  assert.equal(hasFeatureAccess(access, "fixedCostImpact"), false);
  assert.equal(hasFeatureAccess(access, "detailedContribution"), false);
  assert.equal(canOpenView(access, "retirement"), false);
  assert.equal(canOpenView(access, "dashboard"), true);
});

test("enforced Pro access unlocks Pro views without preview mode", () => {
  const access: AccessState = { tier: "pro", mode: "enforced", source: "subscription" };
  assert.equal(getEffectiveTier(access), "pro");
  assert.equal(hasFeatureAccess(access, "lifePlanDiagnosis"), true);
  assert.equal(canOpenView(access, "diagnosis"), true);
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
  household: {
    monthlyIncome: 320000,
    annualBonus: 600000,
    sideIncome: 30000,
    fixedCost: 130000,
    variableCost: 90000,
    annualSpecialCost: 300000
  },
  assets: {
    cash: 1200000,
    investment: 1500000,
    other: 200000,
    debt: 500000
  },
  goals: [],
  events: [],
  simulation: {
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
  fixedCostItems: [],
  budgetItems: [],
  updatedAt: new Date().toISOString()
};

const assertAlmostEqual = (actual: number, expected: number, tolerance = 0.01) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
};

test("basic household cashflow is calculated from monthly and annual inputs", () => {
  const summary = getCashflowSummary(basePlan.household);

  assert.equal(summary.monthlyIncome, 350000);
  assert.equal(summary.annualIncome, 4800000);
  assert.equal(summary.monthlyLivingCost, 245000);
  assert.equal(summary.annualLivingCost, 2940000);
  assert.equal(summary.monthlySavings, 105000);
  assert.equal(summary.savingsRate, 30);
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
      household: { ...basePlan.household, fixedCost: basePlan.household.fixedCost - 30000 },
      assets: { ...basePlan.assets },
      goals: [],
      events: [],
      simulation: { ...basePlan.simulation }
    }
  });

  assert.equal(getCashflowSummary(scenarioPlan.household).monthlySavings, getCashflowSummary(basePlan.household).monthlySavings + 30000);
  assert.equal(basePlan.household.fixedCost, 130000);
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
        year: currentYear + 1,
        month: 12,
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

test("annual projection rows separate return impact from savings and event impact", () => {
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
      cash: 1000000,
      investment: 0,
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
  assert.ok(rows[1].returnImpact > 0);
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
  assert.equal(completion.items.find((item) => item.label === "ライフイベント")?.view, "timeline");
  assert.equal(completion.items.find((item) => item.label === "メモ")?.complete, false);
});

test("import validation rejects unrelated JSON and fills optional fields for legacy backups", () => {
  assert.throws(() => validateImportedPlan({}), /Life Compass/);
  assert.throws(() => validateImportedPlan(null), /JSON/);

  const imported = validateImportedPlan({
    ...basePlan,
    version: 0,
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
    simulation: undefined,
    withdrawalPlan: undefined,
    retirementPlan: undefined,
    notes: undefined,
    reviews: undefined,
    scenarios: undefined,
    fixedCostItems: undefined,
    budgetItems: undefined
  });

  assert.equal(imported.version, CURRENT_PLAN_VERSION);
  assert.deepEqual(imported.simulation, {
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
  assert.deepEqual(imported.reviews, []);
  assert.deepEqual(imported.scenarios, []);
  assert.deepEqual(imported.fixedCostItems, []);
  assert.deepEqual(imported.budgetItems, []);
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
        actualNetAssets: 1100000,
        actualMonthlySavings: 60000,
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
    ]
  });

  assert.equal(imported.reviews.length, 2);
  assert.equal(imported.reviews[0].reviewType, "quarterly");
  assert.equal(imported.reviews[0].todo, "next check");
  assert.equal(imported.reviews[0].todoDone, true);
  assert.equal(imported.reviews[0].actualNetAssets, 1100000);
  assert.equal(imported.reviews[0].actualMonthlySavings, 60000);
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
  assert.equal(imported.simulation.monthlyContribution, 0);
  assert.equal(imported.simulation.annualReturnRate, 3);
  assert.equal(imported.simulation.years, 80);

  assert.throws(
    () => validateImportedPlan({ ...basePlan, version: CURRENT_PLAN_VERSION + 1 }),
    /新しいバージョン/
  );
  assert.throws(() => validateImportedPlan({ ...basePlan, version: "2" }), /バージョン情報/);
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
  await assert.rejects(() => decryptCloudBackup(tampered, password), /違うか、バックアップが破損/);
});

test("cloud backup encryption rejects weak recovery passwords", async () => {
  await assert.rejects(() => encryptCloudBackup(basePlan, "short"), /12文字以上/);
});
