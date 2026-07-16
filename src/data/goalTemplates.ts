import type { Goal } from "../types";

export type GoalTemplate = Omit<Goal, "id" | "dueYear" | "dueMonth" | "progress"> & {
  yearsFromNow: number;
};

export const goalTemplates: GoalTemplate[] = [
  {
    title: "生活防衛資金を整える",
    goalType: "oneTime",
    yearsFromNow: 1,
    requiredAmount: 1500000,
    savedAmount: 0,
    monthlyAllocation: 50000,
    recurrence: "yearly",
    priority: "high",
    memo: "月間生活費をもとに、6〜12ヶ月分を目安として見直す"
  },
  {
    title: "住宅購入の頭金を準備",
    goalType: "oneTime",
    yearsFromNow: 5,
    requiredAmount: 5000000,
    savedAmount: 0,
    monthlyAllocation: 60000,
    recurrence: "yearly",
    priority: "medium",
    memo: "住宅購入の時期や必要額は定期的に見直す"
  },
  {
    title: "毎年旅行に行く",
    goalType: "recurring",
    yearsFromNow: 1,
    requiredAmount: 200000,
    savedAmount: 0,
    monthlyAllocation: 17000,
    recurrence: "yearly",
    priority: "medium",
    memo: "年1回の旅行予算として、年間特別支出にも反映する"
  },
  {
    title: "資格取得の費用を準備",
    goalType: "oneTime",
    yearsFromNow: 2,
    requiredAmount: 300000,
    savedAmount: 0,
    monthlyAllocation: 15000,
    recurrence: "yearly",
    priority: "low",
    memo: "受験料、教材費、講座費用などをまとめて確認する"
  }
];
