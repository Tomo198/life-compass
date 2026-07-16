import type { LifeEvent } from "../types";

export type EventTemplate = Omit<LifeEvent, "id" | "year" | "age"> & {
  yearsFromNow: number;
};

export const eventTemplates: EventTemplate[] = [
  {
    title: "転職",
    owner: "self",
    category: "career",
    yearsFromNow: 2,
    month: 4,
    amount: 0,
    cashflowType: "neutral",
    memo: "年収や働き方の変化は家計入力も合わせて見直す"
  },
  {
    title: "引越し",
    owner: "household",
    category: "move",
    yearsFromNow: 1,
    month: 3,
    amount: 500000,
    cashflowType: "expense",
    memo: "初期費用、家具家電、移動費など"
  },
  {
    title: "住宅購入",
    owner: "household",
    category: "home",
    yearsFromNow: 5,
    month: 9,
    amount: 3000000,
    cashflowType: "expense",
    memo: "頭金や諸費用の概算。住宅ローンは資産入力の負債も確認する"
  },
  {
    title: "車購入",
    owner: "household",
    category: "car",
    yearsFromNow: 3,
    month: 6,
    amount: 2000000,
    cashflowType: "expense",
    memo: "購入費、維持費、保険料など"
  },
  {
    title: "教育費",
    owner: "child",
    category: "education",
    yearsFromNow: 10,
    month: 4,
    amount: 1000000,
    cashflowType: "expense",
    memo: "入学金、授業料、教材費など"
  },
  {
    title: "親の介護",
    owner: "parent",
    category: "care",
    yearsFromNow: 8,
    month: 1,
    amount: 600000,
    cashflowType: "expense",
    memo: "支援額や頻度は状況に合わせて見直す"
  }
];
