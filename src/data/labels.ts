import type { BudgetCategory, BudgetFrequency, Priority } from "../types";

export const priorityLabels: Record<Priority, string> = {
  high: "高",
  medium: "中",
  low: "低"
};

export const budgetCategoryLabels: Record<BudgetCategory, string> = {
  food: "食費",
  daily: "日用品",
  housing: "住居",
  utilities: "水道光熱費",
  communication: "通信費",
  insurance: "保険",
  car: "車",
  education: "教育",
  medical: "医療",
  travel: "旅行・帰省",
  subscription: "サブスク",
  other: "その他"
};

export const budgetFrequencyLabels: Record<BudgetFrequency, string> = {
  monthlyFixed: "毎月・固定",
  monthlyVariable: "毎月・変動",
  irregularFixed: "不定・固定",
  irregularVariable: "不定・変動",
  yearly: "年1回",
  oneTime: "1回だけ"
};

export const monthLabels = Array.from({ length: 12 }, (_, index) => `${index + 1}月`);
