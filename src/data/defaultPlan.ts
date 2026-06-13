import type { LifePlan } from "../types";

const currentYear = new Date().getFullYear();

export const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const defaultPlan: LifePlan = {
  version: 1,
  profile: {
    name: "マイプラン",
    age: 35,
    familyType: "single",
    workStyle: "employee",
    housing: "rent"
  },
  household: {
    monthlyIncome: 320000,
    annualBonus: 600000,
    sideIncome: 0,
    fixedCost: 130000,
    variableCost: 90000,
    annualSpecialCost: 300000
  },
  assets: {
    cash: 1200000,
    investment: 1500000,
    other: 200000,
    debt: 0
  },
  goals: [
    {
      id: createId(),
      title: "5年後に資産500万円",
      goalType: "oneTime",
      dueYear: currentYear + 5,
      requiredAmount: 5000000,
      savedAmount: 2900000,
      monthlyAllocation: 30000,
      recurrence: "yearly",
      priority: "high",
      progress: 58,
      memo: "生活防衛資金も含めて見直す"
    },
    {
      id: createId(),
      title: "毎年旅行に行く",
      goalType: "recurring",
      dueYear: currentYear + 1,
      requiredAmount: 200000,
      savedAmount: 0,
      monthlyAllocation: 17000,
      recurrence: "yearly",
      priority: "medium",
      progress: 0,
      memo: "年1回の旅行予算として年間特別支出にも反映する"
    }
  ],
  events: [
    {
      id: createId(),
      title: "資格取得",
      category: "qualification",
      year: currentYear + 1,
      month: 4,
      age: 36,
      amount: 120000,
      cashflowType: "expense",
      memo: "学習費用と受験費用"
    },
    {
      id: createId(),
      title: "住まいの見直し",
      category: "move",
      year: currentYear + 3,
      month: 9,
      age: 38,
      amount: 500000,
      cashflowType: "expense",
      memo: "引越し費用の目安"
    }
  ],
  simulation: {
    monthlyContribution: 50000,
    bonusContribution: 100000,
    annualReturnRate: 3,
    years: 30
  },
  notes: {
    general: "今の前提で気になる点や、次に見直したいことを書いておく欄です。",
    spendingReview: "例: 通信費、サブスク、保険、車、家賃など。詳細な影響試算はPro機能で追加予定です。"
  },
  reviews: [],
  updatedAt: new Date().toISOString()
};
