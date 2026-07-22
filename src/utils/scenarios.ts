import { createScenarioSnapshot } from "../data/scenarios";
import {
  cashflowLabels,
  cashflowPeriodTargetLabels,
  eventCategoryLabels
} from "../data/labels";
import type {
  CashflowPeriodTarget,
  Goal,
  LifeEvent,
  LifePlan,
  PlanScenario
} from "../types";
import {
  buildPlanFromScenario,
  emergencyMonthsLabel,
  getAssetSummary,
  getCurrentCashflowSummary,
  getEmergencyFundResult,
  getGoalAchievement,
  getHouseholdForYear,
  getPrimaryGoal,
  manYen,
  projectAssets
} from "./calculations";

export type ScenarioComparisonMetric = {
  id: string;
  name: string;
  monthlySavings: number;
  annualBalance: number;
  netAssets: number;
  tenYear: number;
  thirtyYear: number;
  goalLabel: string;
  emergencyLabel: string;
};

export type ScenarioImpactGroup = "cashflow" | "assets" | "allocation" | "events" | "goals";

export type ScenarioImpactChange = {
  id: string;
  group: ScenarioImpactGroup;
  label: string;
  period?: string;
  currentValue: string;
  proposedValue: string;
  effect: string;
};

const cashflowTargets: CashflowPeriodTarget[] = [
  "monthlyIncome",
  "annualBonus",
  "sideIncome",
  "fixedCost",
  "variableCost",
  "annualSpecialCost"
];

const monthlyCashflowTargets = new Set<CashflowPeriodTarget>([
  "monthlyIncome",
  "sideIncome",
  "fixedCost",
  "variableCost"
]);

const incomeCashflowTargets = new Set<CashflowPeriodTarget>([
  "monthlyIncome",
  "annualBonus",
  "sideIncome"
]);

const signedMoney = (value: number) => `${value > 0 ? "+" : ""}${manYen(value)}`;

const yearRangeLabel = (startYear: number, endYear: number) =>
  startYear === endYear ? `${startYear}年` : `${startYear}〜${endYear}年`;

const eventAssetEffect = (event?: LifeEvent) => {
  if (!event || event.cashflowType === "neutral") return 0;
  return event.cashflowType === "income" ? event.amount : -event.amount;
};

const eventValue = (event?: LifeEvent) => {
  if (!event) return "設定なし";
  const amount = event.cashflowType === "neutral" ? "金額は試算へ反映しない" : manYen(event.amount);
  return `${event.year}年${event.month}月 / ${amount} / ${cashflowLabels[event.cashflowType]}`;
};

const goalValue = (goal?: Goal) => {
  if (!goal) return "設定なし";
  const deadline = goal.goalType === "recurring" ? "継続目標" : `${goal.dueYear}年${goal.dueMonth}月`;
  return `${deadline} / 目標 ${manYen(goal.requiredAmount)} / 準備済み ${manYen(goal.savedAmount)}`;
};

const sameEvent = (current?: LifeEvent, proposed?: LifeEvent) =>
  current?.title === proposed?.title
  && current?.category === proposed?.category
  && current?.year === proposed?.year
  && current?.month === proposed?.month
  && current?.amount === proposed?.amount
  && current?.cashflowType === proposed?.cashflowType;

const sameGoal = (current?: Goal, proposed?: Goal) =>
  current?.title === proposed?.title
  && current?.goalType === proposed?.goalType
  && current?.dueYear === proposed?.dueYear
  && current?.dueMonth === proposed?.dueMonth
  && current?.requiredAmount === proposed?.requiredAmount
  && current?.savedAmount === proposed?.savedAmount
  && current?.monthlyAllocation === proposed?.monthlyAllocation
  && current?.recurrence === proposed?.recurrence;

export function getScenarioComparisonMetrics(plan: LifePlan): ScenarioComparisonMetric[] {
  const scenarios = plan.scenarios || [];
  const comparisonPlans = [
    { id: "current", name: "現在プラン", plan },
    ...scenarios.map((scenario) => ({
      id: scenario.id,
      name: scenario.name,
      plan: buildPlanFromScenario(plan, scenario)
    }))
  ];

  return comparisonPlans.map((item) => {
    const cashflow = getCurrentCashflowSummary(item.plan);
    const assets = getAssetSummary(item.plan.assets);
    const projection = projectAssets(item.plan, 30);
    const primaryGoal = getPrimaryGoal(item.plan);
    const goalAchievement = primaryGoal ? getGoalAchievement(item.plan, primaryGoal) : null;
    const emergency = getEmergencyFundResult(item.plan);
    const goalLabel = !primaryGoal
      ? "目標未設定"
      : goalAchievement?.status === "achieved"
        ? "達成済み"
        : goalAchievement?.status === "unreachable"
          ? "毎月の準備額未設定"
          : goalAchievement?.status === "recurring"
            ? `${primaryGoal.title}: 継続目標`
            : `${primaryGoal.title}: ${goalAchievement?.targetAge}歳目安`;
    const emergencyLabel =
      emergency.status === "short"
        ? `${emergency.lowerMonths}ヶ月分まであと${manYen(emergency.shortageToLower)}`
        : emergency.status === "above"
          ? `${emergency.upperMonths}ヶ月分を上回る`
          : `${emergencyMonthsLabel(emergency.lowerMonths, emergency.upperMonths)}の目安内`;

    return {
      id: item.id,
      name: item.name,
      monthlySavings: cashflow.monthlySavings,
      annualBalance: cashflow.annualIncome - cashflow.annualLivingCost,
      netAssets: assets.netAssets,
      tenYear: projection[10]?.value ?? 0,
      thirtyYear: projection[30]?.value ?? 0,
      goalLabel,
      emergencyLabel
    };
  });
}

export function getScenarioImpactChanges(
  plan: LifePlan,
  scenario: PlanScenario,
  startYear = new Date().getFullYear(),
  years = 30
): ScenarioImpactChange[] {
  const proposedPlan = buildPlanFromScenario(plan, scenario);
  const changes: ScenarioImpactChange[] = [];
  const endYear = startYear + years;

  cashflowTargets.forEach((target) => {
    let segmentStart: number | null = null;
    let segmentCurrent = 0;
    let segmentProposed = 0;

    const pushSegment = (segmentEnd: number) => {
      if (segmentStart === null) return;
      const annualMultiplier = monthlyCashflowTargets.has(target) ? 12 : 1;
      const direction = incomeCashflowTargets.has(target) ? 1 : -1;
      const annualEffect = (segmentProposed - segmentCurrent) * annualMultiplier * direction;
      changes.push({
        id: `cashflow-${target}-${segmentStart}`,
        group: "cashflow",
        label: cashflowPeriodTargetLabels[target],
        period: yearRangeLabel(segmentStart, segmentEnd),
        currentValue: manYen(segmentCurrent),
        proposedValue: manYen(segmentProposed),
        effect: `年間収支への直接差 ${signedMoney(annualEffect)}`
      });
      segmentStart = null;
    };

    for (let year = startYear; year <= endYear; year += 1) {
      const currentAmount = getHouseholdForYear(plan, year)[target];
      const proposedAmount = getHouseholdForYear(proposedPlan, year)[target];
      const changed = currentAmount !== proposedAmount;
      const continuesSegment =
        segmentStart !== null
        && currentAmount === segmentCurrent
        && proposedAmount === segmentProposed;

      if (!changed) {
        pushSegment(year - 1);
        continue;
      }
      if (continuesSegment) continue;
      pushSegment(year - 1);
      segmentStart = year;
      segmentCurrent = currentAmount;
      segmentProposed = proposedAmount;
    }
    pushSegment(endYear);
  });

  const assetFields = [
    { key: "cash", label: "現金", direction: 1 },
    { key: "investment", label: "投資資産", direction: 1 },
    { key: "other", label: "その他資産", direction: 1 },
    { key: "debt", label: "負債", direction: -1 }
  ] as const;
  assetFields.forEach(({ key, label, direction }) => {
    const currentAmount = plan.assets[key];
    const proposedAmount = proposedPlan.assets[key];
    if (currentAmount === proposedAmount) return;
    changes.push({
      id: `assets-${key}`,
      group: "assets",
      label,
      currentValue: manYen(currentAmount),
      proposedValue: manYen(proposedAmount),
      effect: `現在純資産への直接差 ${signedMoney((proposedAmount - currentAmount) * direction)}`
    });
  });

  const allocationFields = [
    {
      key: "monthlyInvestmentAmount",
      label: "毎月投資へ回す額",
      format: manYen,
      effect: "家計余剰のうち、現金と投資資産へ配分する額に反映"
    },
    {
      key: "annualBonusInvestmentAmount",
      label: "ボーナスから投資へ回す年額",
      format: manYen,
      effect: "ボーナスのうち、現金と投資資産へ配分する額に反映"
    },
    {
      key: "annualReturnRate",
      label: "想定利回り",
      format: (value: number) => `${value}%`,
      effect: "投資資産の将来見通しに反映"
    }
  ] as const;
  allocationFields.forEach(({ key, label, format, effect }) => {
    const currentAmount = plan.simulation[key];
    const proposedAmount = proposedPlan.simulation[key];
    if (currentAmount === proposedAmount) return;
    changes.push({
      id: `allocation-${key}`,
      group: "allocation",
      label,
      currentValue: format(currentAmount),
      proposedValue: format(proposedAmount),
      effect
    });
  });

  const currentEvents = new Map(plan.events.map((event) => [event.id, event]));
  const proposedEvents = new Map(proposedPlan.events.map((event) => [event.id, event]));
  new Set([...currentEvents.keys(), ...proposedEvents.keys()]).forEach((id) => {
    const current = currentEvents.get(id);
    const proposed = proposedEvents.get(id);
    if (sameEvent(current, proposed)) return;
    const directDifference = eventAssetEffect(proposed) - eventAssetEffect(current);
    const timingOnly = directDifference === 0 && current && proposed
      && (current.year !== proposed.year || current.month !== proposed.month);
    changes.push({
      id: `event-${id}`,
      group: "events",
      label: proposed?.title || current?.title || "ライフイベント",
      period: eventCategoryLabels[proposed?.category || current?.category || "other"],
      currentValue: eventValue(current),
      proposedValue: eventValue(proposed),
      effect: timingOnly
        ? "資産見通しへ反映する時期を変更"
        : directDifference === 0
          ? "資産見通しへ反映する金額の差はありません"
          : `予定年の資産見通しへの直接差 ${signedMoney(directDifference)}`
    });
  });

  const currentGoals = new Map(plan.goals.map((goal) => [goal.id, goal]));
  const proposedGoals = new Map(proposedPlan.goals.map((goal) => [goal.id, goal]));
  new Set([...currentGoals.keys(), ...proposedGoals.keys()]).forEach((id) => {
    const current = currentGoals.get(id);
    const proposed = proposedGoals.get(id);
    if (sameGoal(current, proposed)) return;
    changes.push({
      id: `goal-${id}`,
      group: "goals",
      label: proposed?.title || current?.title || "目標",
      currentValue: goalValue(current),
      proposedValue: goalValue(proposed),
      effect: "達成目安の確認に使用。資産見通しからは自動控除しません"
    });
  });

  return changes;
}

export function adoptScenarioAsBase(
  plan: LifePlan,
  scenario: PlanScenario,
  previousPlanScenarioId: string,
  adoptedAt: string
): LifePlan {
  const previousPlan: PlanScenario = {
    id: previousPlanScenarioId,
    name: `採用前: ${plan.profile.name}`,
    description: `「${scenario.name}」を基本プランへ採用する前の条件です。`,
    tag: "current",
    createdAt: adoptedAt,
    snapshot: createScenarioSnapshot(plan)
  };
  const adoptedPlan = buildPlanFromScenario(plan, scenario);

  return {
    ...adoptedPlan,
    activeScenario: {
      name: scenario.name,
      adoptedAt
    },
    scenarios: [previousPlan, ...(plan.scenarios || []).filter((item) => item.id !== scenario.id)]
  };
}
