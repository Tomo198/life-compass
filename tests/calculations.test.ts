import test from "node:test";
import assert from "node:assert/strict";
import type { LifePlan } from "../src/types";
import {
  getAssetSummary,
  getAnnualProjectionRows,
  getCashflowSummary,
  getEmergencyFundMonths,
  getEmergencyFundResult,
  getGoalAchievement,
  getGoalPreparedPercent,
  getInputCompletion,
  getMonthlyProjectionRows,
  projectAssets,
  simulateContribution
} from "../src/utils/calculations";
import { validateImportedPlan } from "../src/utils/storage";

const currentYear = new Date().getFullYear();

const basePlan: LifePlan = {
  version: 1,
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
  notes: {
    general: "",
    spendingReview: ""
  },
  reviews: [],
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
    events: [],
    simulation: { ...basePlan.simulation, annualReturnRate: 0 }
  };

  const rows = getMonthlyProjectionRows(plan, 2);

  assert.equal(rows.length, 3);
  assert.equal(rows[0].value, 1000000);
  assert.equal(rows[1].value, 1100000);
  assert.equal(rows[2].value, 1200000);
  assert.equal(rows[1].monthlySavings, 100000);
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
    simulation: undefined,
    notes: undefined,
    reviews: undefined
  });

  assert.equal(imported.version, 1);
  assert.deepEqual(imported.simulation, {
    monthlyContribution: 50000,
    bonusContribution: 100000,
    annualReturnRate: 3,
    years: 30
  });
  assert.deepEqual(imported.notes, {
    general: "",
    spendingReview: ""
  });
  assert.deepEqual(imported.reviews, []);
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
  assert.equal(imported.reviews[0].actualNetAssets, 1100000);
  assert.equal(imported.reviews[0].actualMonthlySavings, 60000);
  assert.equal(imported.reviews[1].plannedNetAssets, undefined);
  assert.equal(imported.reviews[1].actualNetAssets, undefined);
});
