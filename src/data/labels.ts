import type {
  BudgetCategory,
  BudgetFrequency,
  CashflowType,
  EventOwner,
  LifeEventCategory,
  Priority
} from "../types";

export const priorityLabels: Record<Priority, string> = {
  high: "高",
  medium: "中",
  low: "低"
};

export const eventCategoryLabels: Record<LifeEventCategory, string> = {
  career: "転職",
  move: "引越し",
  marriage: "結婚",
  birth: "出産",
  home: "住宅購入",
  car: "車購入",
  education: "教育費",
  care: "親の介護",
  sideBusiness: "独立/副業",
  retirement: "退職",
  travel: "大きな旅行",
  qualification: "資格取得",
  other: "その他"
};

export const eventOwnerLabels: Record<EventOwner, string> = {
  self: "本人",
  spouse: "配偶者",
  child: "子ども",
  parent: "親",
  household: "世帯全体",
  other: "その他"
};

export const cashflowLabels: Record<CashflowType, string> = {
  expense: "支出として反映",
  income: "収入・資産増として反映",
  neutral: "記録のみ"
};

export const cashflowHelp: Record<CashflowType, string> = {
  expense: "予定月の資産見通しから差し引きます。",
  income: "予定月の資産見通しに加算します。",
  neutral: "年表に残すだけで、試算には反映しません。"
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
