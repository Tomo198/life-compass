import { MAX_PLAN_YEAR } from "../config";
import { cashflowPeriodTargetLabels } from "../data/labels";
import type {
  CashflowPeriodTarget,
  DetailedCashflowItem,
  DetailedCashflowItemDraft,
  LifePlan
} from "../types";
import { getHouseholdForYear } from "./calculations";

const targets: CashflowPeriodTarget[] = [
  "monthlyIncome",
  "annualBonus",
  "sideIncome",
  "fixedCost",
  "variableCost",
  "annualSpecialCost"
];

const incomeTargets = new Set<CashflowPeriodTarget>(["monthlyIncome", "annualBonus", "sideIncome"]);

export const setDetailedCashflowTargetAmount = (
  items: DetailedCashflowItem[],
  target: CashflowPeriodTarget,
  amount: number,
  year: number,
  createId: () => string,
  title = cashflowPeriodTargetLabels[target],
  memberId: string | null = null
): DetailedCashflowItem[] => {
  const targetAmount = Math.max(0, Math.round(amount));
  const activeItems = items.filter(
    (item) => item.target === target && item.startYear <= year && year <= item.endYear
  );

  if (activeItems.length === 0) {
    if (targetAmount === 0) return items;
    return [
      ...items,
      {
        id: createId(),
        title,
        memberId,
        target,
        startYear: year,
        endYear: MAX_PLAN_YEAR,
        amount: targetAmount,
        memo: "シナリオの前提変更から作成"
      }
    ];
  }

  const currentTotal = activeItems.reduce((sum, item) => sum + item.amount, 0);
  let allocated = 0;
  const nextAmounts = new Map<string, number>();
  activeItems.forEach((item, index) => {
    const nextAmount = index === activeItems.length - 1
      ? targetAmount - allocated
      : currentTotal > 0
        ? Math.floor(targetAmount * (item.amount / currentTotal))
        : Math.floor(targetAmount / activeItems.length);
    const safeAmount = Math.max(0, nextAmount);
    nextAmounts.set(item.id, safeAmount);
    allocated += safeAmount;
  });

  return items.map((item) => (
    nextAmounts.has(item.id) ? { ...item, amount: nextAmounts.get(item.id) ?? item.amount } : item
  ));
};

export const createDetailedCashflowDraft = (
  _currentAge: number,
  primaryMemberId: string | null
): DetailedCashflowItemDraft => ({
  title: "",
  memberId: primaryMemberId,
  target: "monthlyIncome",
  startYear: new Date().getFullYear(),
  endYear: MAX_PLAN_YEAR,
  amount: 0,
  memo: ""
});

export const convertBasicCashflowToDetailedItems = (
  plan: LifePlan,
  createId: () => string
): DetailedCashflowItem[] => {
  const currentYear = new Date().getFullYear();
  const primaryMemberId = plan.householdMembers.find((member) => member.relationship === "self")?.id ?? null;
  const basicSource = { ...plan, cashflowMode: "basic" as const };

  return targets.flatMap((target) => {
    const boundaries = new Set<number>([currentYear]);
    (plan.cashflowPeriods || [])
      .filter((period) => period.target === target && period.endYear >= currentYear)
      .forEach((period) => {
        boundaries.add(Math.max(currentYear, period.startYear));
        if (period.endYear < MAX_PLAN_YEAR) boundaries.add(period.endYear + 1);
      });

    const years = [...boundaries]
      .filter((year) => year <= MAX_PLAN_YEAR)
      .sort((a, b) => a - b);
    const segments = years.map((startYear, index) => ({
      startYear,
      endYear: Math.min(MAX_PLAN_YEAR, (years[index + 1] ?? MAX_PLAN_YEAR + 1) - 1),
      amount: getHouseholdForYear(basicSource, startYear)[target]
    }));
    const merged = segments.reduce<typeof segments>((result, segment) => {
      const previous = result[result.length - 1];
      if (previous && previous.amount === segment.amount && previous.endYear + 1 === segment.startYear) {
        previous.endYear = segment.endYear;
      } else {
        result.push({ ...segment });
      }
      return result;
    }, []);

    return merged
      .filter((segment) => segment.amount > 0)
      .map((segment) => ({
        id: createId(),
        title:
          segment.startYear === currentYear && segment.endYear === MAX_PLAN_YEAR
            ? cashflowPeriodTargetLabels[target]
            : `${cashflowPeriodTargetLabels[target]}（${segment.startYear}年から）`,
        memberId: incomeTargets.has(target) ? primaryMemberId : null,
        target,
        startYear: segment.startYear,
        endYear: segment.endYear,
        amount: segment.amount,
        memo: "基本収支と時期別変更から作成"
      }));
  });
};
