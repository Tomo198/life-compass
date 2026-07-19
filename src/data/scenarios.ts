import { createId } from "./defaultPlan";
import type {
  LifePlan,
  PlanScenario,
  ScenarioSnapshot,
  ScenarioTag
} from "../types";
import { getTargetAgeForYear } from "../utils/calculations";

export const scenarioTagLabels: Record<ScenarioTag, string> = {
  current: "現状維持",
  spending: "支出見直し",
  career: "転職",
  sideBusiness: "副業開始",
  home: "住宅購入",
  retirement: "早期退職",
  custom: "自由入力"
};

export type ScenarioTemplate = {
  tag: ScenarioTag;
  name: string;
  description: string;
  apply: (snapshot: ScenarioSnapshot, plan: LifePlan) => ScenarioSnapshot;
};

export const createScenarioSnapshot = (plan: LifePlan): ScenarioSnapshot => ({
  household: { ...plan.household },
  assets: { ...plan.assets },
  goals: plan.goals.map((goal) => ({ ...goal })),
  events: plan.events.map((event) => ({ ...event })),
  simulation: { ...plan.simulation }
});

export const createScenarioFromTemplate = (plan: LifePlan, template: ScenarioTemplate): PlanScenario => ({
  id: createId(),
  name: template.name,
  description: template.description,
  tag: template.tag,
  createdAt: new Date().toISOString(),
  snapshot: template.apply(createScenarioSnapshot(plan), plan)
});

export const scenarioTemplates: ScenarioTemplate[] = [
  {
    tag: "current",
    name: "現状維持",
    description: "現在の入力条件をそのまま保存します。",
    apply: (snapshot) => snapshot
  },
  {
    tag: "spending",
    name: "支出見直し",
    description: "固定費を月3万円下げた場合の仮シナリオです。",
    apply: (snapshot) => ({
      ...snapshot,
      household: { ...snapshot.household, fixedCost: Math.max(0, snapshot.household.fixedCost - 30000) }
    })
  },
  {
    tag: "career",
    name: "転職",
    description: "月収が5万円変わる前提の仮シナリオです。",
    apply: (snapshot) => ({
      ...snapshot,
      household: { ...snapshot.household, monthlyIncome: snapshot.household.monthlyIncome + 50000 }
    })
  },
  {
    tag: "sideBusiness",
    name: "副業開始",
    description: "副業収入を月5万円として置いた仮シナリオです。",
    apply: (snapshot) => ({
      ...snapshot,
      household: { ...snapshot.household, sideIncome: snapshot.household.sideIncome + 50000 }
    })
  },
  {
    tag: "home",
    name: "住宅購入",
    description: "5年後に住宅購入関連費用を置いた仮シナリオです。",
    apply: (snapshot, plan) => {
      const year = new Date().getFullYear() + 5;
      return {
        ...snapshot,
        events: [
          ...snapshot.events,
          {
            id: createId(),
            title: "住宅購入関連費用",
            owner: "household",
            category: "home",
            year,
            month: 9,
            age: getTargetAgeForYear(plan.profile.age, year),
            amount: 3000000,
            cashflowType: "expense",
            memo: "Proシナリオ比較用の仮イベント"
          }
        ]
      };
    }
  },
  {
    tag: "retirement",
    name: "早期退職",
    description: "収入と生活費を退職前提で見直すための仮シナリオです。",
    apply: (snapshot) => ({
      ...snapshot,
      household: {
        ...snapshot.household,
        monthlyIncome: Math.max(0, snapshot.household.monthlyIncome - 100000),
        fixedCost: Math.max(0, snapshot.household.fixedCost - 20000)
      }
    })
  }
];
