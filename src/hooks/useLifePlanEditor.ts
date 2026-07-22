import { useState } from "react";
import {
  CURRENT_PLAN_VERSION,
  MAX_DETAILED_CASHFLOW_ITEMS,
  MAX_HOUSEHOLD_MEMBERS
} from "../config";
import { createId, defaultPlan } from "../data/defaultPlan";
import { createSuggestedHouseholdMembers } from "../data/householdMembers";
import { createScenarioFromTemplate, type ScenarioTemplate } from "../data/scenarios";
import { featureTiers } from "../features";
import type {
  Assets,
  BudgetItem,
  CashflowPeriod,
  CashflowPeriodDraft,
  DetailedCashflowItem,
  DetailedCashflowItemDraft,
  FixedCostItem,
  Goal,
  GoalDraft,
  Household,
  HouseholdMember,
  HouseholdMemberDraft,
  LifeEvent,
  LifeEventDraft,
  LifePlan,
  PlanNotes,
  PlanScenario,
  ScenarioSnapshot,
  Profile,
  RetirementPlanSettings,
  ReviewNote,
  SimulationSettings,
  TimelineMemo,
  WithdrawalPlanSettings
} from "../types";
import {
  getBudgetHouseholdInputs,
  getTargetAgeForYear
} from "../utils/calculations";
import { convertBasicCashflowToDetailedItems } from "../utils/detailedCashflow";
import {
  applyBudgetActualsToReview,
  createPlanReview,
  createScenarioFromReview,
  type ReviewScenarioOptions
} from "../utils/reviews";
import {
  addPlanRevision,
  createPlanRevision,
  restorePlanRevision as restorePlanRevisionSnapshot
} from "../utils/planRevisions";
import { createRecoveryBackup, loadPlan, savePlan } from "../utils/storage";
import { adoptScenarioAsBase } from "../utils/scenarios";

const cloneDefaultPlan = () => JSON.parse(JSON.stringify(defaultPlan)) as LifePlan;

export const createEmptyPlan = (): LifePlan => ({
  version: CURRENT_PLAN_VERSION,
  profile: {
    name: "新しいプラン",
    age: 0,
    familyType: "single",
    workStyle: "employee",
    housing: "rent"
  },
  householdMembers: createSuggestedHouseholdMembers({ age: 0, familyType: "single" }),
  household: {
    monthlyIncome: 0,
    annualBonus: 0,
    sideIncome: 0,
    fixedCost: 0,
    variableCost: 0,
    annualSpecialCost: 0
  },
  cashflowMode: "basic",
  detailedCashflowItems: [],
  cashflowPeriods: [],
  assets: {
    cash: 0,
    investment: 0,
    other: 0,
    debt: 0
  },
  goals: [],
  events: [],
  timelineMemos: [],
  simulation: {
    monthlyInvestmentAmount: 0,
    annualBonusInvestmentAmount: 0,
    monthlyContribution: 0,
    bonusContribution: 0,
    annualReturnRate: 0,
    years: 30
  },
  withdrawalPlan: {
    startAge: 0,
    startingAssets: 0,
    years: 101,
    withdrawalMode: "monthlyAmount",
    monthlyWithdrawalAmount: 0,
    annualWithdrawalRate: 4,
    annualReturnRate: 0,
    inflationRate: 0,
    periods: [
      {
        id: createId(),
        label: "基本期間",
        startAge: 0,
        endAge: 39,
        monthlyIncome: 0,
        monthlyLivingCost: 0,
        annualExtraExpense: 0
      }
    ]
  },
  retirementPlan: {
    ...defaultPlan.retirementPlan
  },
  notes: {
    general: "",
    spendingReview: ""
  },
  reviews: [],
  scenarios: [],
  planRevisions: [],
  fixedCostItems: [],
  budgetItems: [],
  updatedAt: new Date().toISOString()
});

export function useLifePlanEditor() {
  const [plan, setPlan] = useState<LifePlan>(() => loadPlan());
  const [importMessage, setImportMessage] = useState("");
  const [storageError, setStorageError] = useState("");

  const commitPlan = (nextPlan: LifePlan) => {
    try {
      const saved = savePlan(nextPlan);
      setPlan(saved);
      setStorageError("");
      return true;
    } catch (error) {
      setPlan({ ...nextPlan, updatedAt: plan.updatedAt });
      setStorageError(error instanceof Error ? error.message : "ブラウザ内に保存できませんでした。");
      return false;
    }
  };

  const updateProfile = <K extends keyof Profile>(key: K, value: Profile[K]) => {
    const householdMembers = key === "age"
      ? plan.householdMembers.map((member) =>
          member.relationship === "self"
            ? {
                ...member,
                birthYear: (value as number) > 0 ? new Date().getFullYear() - (value as number) : null
              }
            : member
        )
      : plan.householdMembers;

    commitPlan({
      ...plan,
      profile: { ...plan.profile, [key]: value },
      householdMembers
    });
  };

  const addHouseholdMember = (draft: HouseholdMemberDraft) => {
    if (plan.householdMembers.length >= MAX_HOUSEHOLD_MEMBERS) return false;
    const nextMember: HouseholdMember = {
      id: createId(),
      ...draft,
      relationship: draft.relationship === "self" ? "other" : draft.relationship
    };
    return commitPlan({ ...plan, householdMembers: [...plan.householdMembers, nextMember] });
  };

  const updateHouseholdMember = <K extends keyof HouseholdMember>(
    id: string,
    key: K,
    value: HouseholdMember[K]
  ) => {
    commitPlan({
      ...plan,
      householdMembers: plan.householdMembers.map((member) => {
        if (member.id !== id) return member;
        if (member.relationship === "self" && key === "relationship") return member;
        return { ...member, [key]: value };
      })
    });
  };

  const removeHouseholdMember = (id: string) => {
    const member = plan.householdMembers.find((item) => item.id === id);
    if (!member || member.relationship === "self") return false;
    return commitPlan({
      ...plan,
      householdMembers: plan.householdMembers.filter((item) => item.id !== id),
      detailedCashflowItems: (plan.detailedCashflowItems || []).map((item) =>
        item.memberId === id ? { ...item, memberId: null } : item
      )
    });
  };

  const updateHousehold = <K extends keyof Household>(key: K, value: Household[K]) => {
    commitPlan({ ...plan, household: { ...plan.household, [key]: value } });
  };

  const enableDetailedCashflow = () => {
    const currentItems = plan.detailedCashflowItems || [];
    const detailedCashflowItems = currentItems.length > 0
      ? currentItems
      : convertBasicCashflowToDetailedItems(plan, createId);
    if (detailedCashflowItems.length > MAX_DETAILED_CASHFLOW_ITEMS) return false;
    return commitPlan({ ...plan, cashflowMode: "detailed", detailedCashflowItems });
  };

  const useBasicCashflow = () => commitPlan({ ...plan, cashflowMode: "basic" });

  const addDetailedCashflowItem = (draft: DetailedCashflowItemDraft) => {
    if ((plan.detailedCashflowItems || []).length >= MAX_DETAILED_CASHFLOW_ITEMS) return false;
    const nextItem: DetailedCashflowItem = { id: createId(), ...draft };
    return commitPlan({
      ...plan,
      detailedCashflowItems: [...(plan.detailedCashflowItems || []), nextItem]
    });
  };

  const updateDetailedCashflowItem = <K extends keyof DetailedCashflowItem>(
    id: string,
    key: K,
    value: DetailedCashflowItem[K]
  ) => {
    commitPlan({
      ...plan,
      detailedCashflowItems: (plan.detailedCashflowItems || []).map((item) => {
        if (item.id !== id) return item;
        if (key === "startYear") {
          const startYear = value as number;
          return { ...item, startYear, endYear: Math.max(startYear, item.endYear) };
        }
        if (key === "target") {
          const target = value as DetailedCashflowItem["target"];
          return { ...item, target };
        }
        return { ...item, [key]: value };
      })
    });
  };

  const removeDetailedCashflowItem = (id: string) => {
    commitPlan({
      ...plan,
      detailedCashflowItems: (plan.detailedCashflowItems || []).filter((item) => item.id !== id)
    });
  };

  const addCashflowPeriod = () => {
    const startYear = new Date().getFullYear() + 1;
    const nextPeriod: CashflowPeriod = {
      id: createId(),
      title: "将来の収支変更",
      owner: "household",
      target: "monthlyIncome",
      startYear,
      endYear: startYear,
      amount: plan.household.monthlyIncome,
      memo: ""
    };
    commitPlan({ ...plan, cashflowPeriods: [...(plan.cashflowPeriods || []), nextPeriod] });
  };

  const updateCashflowPeriod = <K extends keyof CashflowPeriod>(id: string, key: K, value: CashflowPeriod[K]) => {
    commitPlan({
      ...plan,
      cashflowPeriods: (plan.cashflowPeriods || []).map((period) => {
        if (period.id !== id) return period;
        if (key === "startYear") {
          const startYear = value as number;
          return { ...period, startYear, endYear: Math.max(startYear, period.endYear) };
        }
        return { ...period, [key]: value };
      })
    });
  };

  const removeCashflowPeriod = (id: string) => {
    commitPlan({ ...plan, cashflowPeriods: (plan.cashflowPeriods || []).filter((period) => period.id !== id) });
  };

  const updateAssets = <K extends keyof Assets>(key: K, value: Assets[K]) => {
    commitPlan({ ...plan, assets: { ...plan.assets, [key]: value } });
  };

  const updateSimulation = <K extends keyof SimulationSettings>(key: K, value: SimulationSettings[K]) => {
    commitPlan({ ...plan, simulation: { ...plan.simulation, [key]: value } });
  };

  const updateWithdrawalPlan = <K extends keyof WithdrawalPlanSettings>(key: K, value: WithdrawalPlanSettings[K]) => {
    commitPlan({ ...plan, withdrawalPlan: { ...(plan.withdrawalPlan || defaultPlan.withdrawalPlan), [key]: value } });
  };

  const updateWithdrawalPlanPatch = (patch: Partial<WithdrawalPlanSettings>) => {
    commitPlan({ ...plan, withdrawalPlan: { ...(plan.withdrawalPlan || defaultPlan.withdrawalPlan), ...patch } });
  };

  const updateRetirementPlan = <K extends keyof RetirementPlanSettings>(key: K, value: RetirementPlanSettings[K]) => {
    commitPlan({ ...plan, retirementPlan: { ...(plan.retirementPlan || defaultPlan.retirementPlan), [key]: value } });
  };

  const updateNotes = <K extends keyof PlanNotes>(key: K, value: PlanNotes[K]) => {
    commitPlan({ ...plan, notes: { ...(plan.notes || { general: "", spendingReview: "" }), [key]: value } });
  };

  const addTimelineMemo = () => {
    const now = new Date();
    const nextMemo: TimelineMemo = {
      id: createId(),
      title: "新しい予定メモ",
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      owner: "self",
      memo: "",
      showOnTimeline: true
    };
    commitPlan({ ...plan, timelineMemos: [...(plan.timelineMemos || []), nextMemo] });
  };

  const updateTimelineMemo = <K extends keyof TimelineMemo>(id: string, key: K, value: TimelineMemo[K]) => {
    commitPlan({
      ...plan,
      timelineMemos: (plan.timelineMemos || []).map((memo) => (memo.id === id ? { ...memo, [key]: value } : memo))
    });
  };

  const removeTimelineMemo = (id: string) => {
    commitPlan({ ...plan, timelineMemos: (plan.timelineMemos || []).filter((memo) => memo.id !== id) });
  };

  const addReview = () => {
    const createdAt = new Date().toISOString();
    const reviewDate = createdAt.slice(0, 10);
    const nextReview = createPlanReview(plan, createId(), reviewDate);
    const revision = createPlanRevision(
      plan,
      createId(),
      `${reviewDate.replace(/-/g, "/")} 月次レビュー時点`,
      "review",
      createdAt,
      nextReview.id
    );
    commitPlan({
      ...plan,
      reviews: [nextReview, ...(plan.reviews || [])],
      planRevisions: addPlanRevision(plan.planRevisions || [], revision)
    });
  };

  const updateReview = <K extends keyof ReviewNote>(id: string, key: K, value: ReviewNote[K]) => {
    commitPlan({
      ...plan,
      reviews: (plan.reviews || []).map((review) => (review.id === id ? { ...review, [key]: value } : review))
    });
  };

  const removeReview = (id: string) => {
    commitPlan({ ...plan, reviews: (plan.reviews || []).filter((review) => review.id !== id) });
  };

  const applyBudgetActualsToReviewRecord = (id: string) => {
    const review = (plan.reviews || []).find((item) => item.id === id);
    if (!review) return false;
    const updatedReview = applyBudgetActualsToReview(plan, review);
    if (!updatedReview) return false;
    return commitPlan({
      ...plan,
      reviews: (plan.reviews || []).map((item) => (item.id === id ? updatedReview : item))
    });
  };

  const addScenarioFromReview = (reviewId: string, options: ReviewScenarioOptions) => {
    const review = (plan.reviews || []).find((item) => item.id === reviewId);
    if (!review || (plan.scenarios || []).length >= featureTiers.pro.scenarioLimit) return false;
    const scenario = createScenarioFromReview(plan, review, createId(), new Date().toISOString(), options);
    return commitPlan({ ...plan, scenarios: [...(plan.scenarios || []), scenario] });
  };

  const saveCurrentPlanRevision = () => {
    const createdAt = new Date().toISOString();
    const revision = createPlanRevision(
      plan,
      createId(),
      `${createdAt.slice(0, 10).replace(/-/g, "/")} 現在の計画`,
      "manual",
      createdAt
    );
    return commitPlan({
      ...plan,
      planRevisions: addPlanRevision(plan.planRevisions || [], revision)
    });
  };

  const restorePlanRevision = (id: string) => {
    const revision = (plan.planRevisions || []).find((item) => item.id === id);
    if (!revision) return false;
    const createdAt = new Date().toISOString();
    const beforeRestore = createPlanRevision(
      plan,
      createId(),
      `「${revision.title}」へ戻す前`,
      "beforeRestore",
      createdAt
    );
    return commitPlan(restorePlanRevisionSnapshot(plan, revision, beforeRestore));
  };

  const removePlanRevision = (id: string) => {
    return commitPlan({
      ...plan,
      planRevisions: (plan.planRevisions || []).filter((revision) => revision.id !== id)
    });
  };

  const addScenario = (template: ScenarioTemplate) => {
    if ((plan.scenarios || []).length >= featureTiers.pro.scenarioLimit) return null;
    const nextScenario = createScenarioFromTemplate(plan, template);
    return commitPlan({ ...plan, scenarios: [...(plan.scenarios || []), nextScenario] })
      ? nextScenario.id
      : null;
  };

  const updateScenario = <K extends keyof PlanScenario>(id: string, key: K, value: PlanScenario[K]) => {
    commitPlan({
      ...plan,
      scenarios: (plan.scenarios || []).map((scenario) => (scenario.id === id ? { ...scenario, [key]: value } : scenario))
    });
  };

  const updateScenarioSnapshot = (id: string, update: (snapshot: ScenarioSnapshot) => ScenarioSnapshot) => {
    return commitPlan({
      ...plan,
      scenarios: (plan.scenarios || []).map((scenario) =>
        scenario.id === id ? { ...scenario, snapshot: update(scenario.snapshot) } : scenario
      )
    });
  };

  const updateScenarioHousehold = <K extends keyof Household>(id: string, key: K, value: Household[K]) => {
    commitPlan({
      ...plan,
      scenarios: (plan.scenarios || []).map((scenario) =>
        scenario.id === id
          ? { ...scenario, snapshot: { ...scenario.snapshot, household: { ...scenario.snapshot.household, [key]: value } } }
          : scenario
      )
    });
  };

  const updateScenarioAssets = <K extends keyof Assets>(id: string, key: K, value: Assets[K]) => {
    commitPlan({
      ...plan,
      scenarios: (plan.scenarios || []).map((scenario) =>
        scenario.id === id
          ? { ...scenario, snapshot: { ...scenario.snapshot, assets: { ...scenario.snapshot.assets, [key]: value } } }
          : scenario
      )
    });
  };

  const updateScenarioSimulation = <K extends keyof SimulationSettings>(id: string, key: K, value: SimulationSettings[K]) => {
    commitPlan({
      ...plan,
      scenarios: (plan.scenarios || []).map((scenario) =>
        scenario.id === id
          ? { ...scenario, snapshot: { ...scenario.snapshot, simulation: { ...scenario.snapshot.simulation, [key]: value } } }
          : scenario
      )
    });
  };

  const addScenarioCashflowPeriod = (id: string, draft: CashflowPeriodDraft) => {
    const nextPeriod: CashflowPeriod = { id: createId(), ...draft };
    updateScenarioSnapshot(id, (snapshot) => ({
      ...snapshot,
      cashflowPeriods: [...(snapshot.cashflowPeriods || []), nextPeriod]
    }));
  };

  const updateScenarioCashflowPeriod = <K extends keyof CashflowPeriod>(
    scenarioId: string,
    periodId: string,
    key: K,
    value: CashflowPeriod[K]
  ) => {
    updateScenarioSnapshot(scenarioId, (snapshot) => ({
      ...snapshot,
      cashflowPeriods: (snapshot.cashflowPeriods || []).map((period) => {
        if (period.id !== periodId) return period;
        if (key === "startYear") {
          const startYear = value as number;
          return { ...period, startYear, endYear: Math.max(startYear, period.endYear) };
        }
        return { ...period, [key]: value };
      })
    }));
  };

  const removeScenarioCashflowPeriod = (scenarioId: string, periodId: string) => {
    updateScenarioSnapshot(scenarioId, (snapshot) => ({
      ...snapshot,
      cashflowPeriods: (snapshot.cashflowPeriods || []).filter((period) => period.id !== periodId)
    }));
  };

  const addScenarioDetailedCashflowItem = (scenarioId: string, draft: DetailedCashflowItemDraft) => {
    const scenario = (plan.scenarios || []).find((item) => item.id === scenarioId);
    if (!scenario || scenario.snapshot.detailedCashflowItems.length >= MAX_DETAILED_CASHFLOW_ITEMS) return false;
    const nextItem: DetailedCashflowItem = { id: createId(), ...draft };
    return updateScenarioSnapshot(scenarioId, (snapshot) => ({
      ...snapshot,
      detailedCashflowItems: [...snapshot.detailedCashflowItems, nextItem]
    }));
  };

  const updateScenarioDetailedCashflowItem = <K extends keyof DetailedCashflowItem>(
    scenarioId: string,
    itemId: string,
    key: K,
    value: DetailedCashflowItem[K]
  ) => {
    updateScenarioSnapshot(scenarioId, (snapshot) => ({
      ...snapshot,
      detailedCashflowItems: snapshot.detailedCashflowItems.map((item) => {
        if (item.id !== itemId) return item;
        if (key === "startYear") {
          const startYear = value as number;
          return { ...item, startYear, endYear: Math.max(startYear, item.endYear) };
        }
        return { ...item, [key]: value };
      })
    }));
  };

  const removeScenarioDetailedCashflowItem = (scenarioId: string, itemId: string) => {
    updateScenarioSnapshot(scenarioId, (snapshot) => ({
      ...snapshot,
      detailedCashflowItems: snapshot.detailedCashflowItems.filter((item) => item.id !== itemId)
    }));
  };

  const addScenarioGoal = (scenarioId: string, draft: GoalDraft) => {
    const nextGoal: Goal = { id: createId(), ...draft, progress: 0 };
    updateScenarioSnapshot(scenarioId, (snapshot) => ({
      ...snapshot,
      goals: [...snapshot.goals, nextGoal]
    }));
  };

  const updateScenarioGoal = <K extends keyof Goal>(scenarioId: string, goalId: string, key: K, value: Goal[K]) => {
    updateScenarioSnapshot(scenarioId, (snapshot) => ({
      ...snapshot,
      goals: snapshot.goals.map((goal) => (goal.id === goalId ? { ...goal, [key]: value } : goal))
    }));
  };

  const removeScenarioGoal = (scenarioId: string, goalId: string) => {
    updateScenarioSnapshot(scenarioId, (snapshot) => ({
      ...snapshot,
      goals: snapshot.goals.filter((goal) => goal.id !== goalId)
    }));
  };

  const addScenarioEvent = (scenarioId: string, draft: LifeEventDraft) => {
    const nextEvent: LifeEvent = {
      id: createId(),
      ...draft,
      age: getTargetAgeForYear(plan.profile.age, draft.year)
    };
    updateScenarioSnapshot(scenarioId, (snapshot) => ({
      ...snapshot,
      events: [...snapshot.events, nextEvent]
    }));
  };

  const updateScenarioEvent = <K extends keyof LifeEvent>(
    scenarioId: string,
    eventId: string,
    key: K,
    value: LifeEvent[K]
  ) => {
    updateScenarioSnapshot(scenarioId, (snapshot) => ({
      ...snapshot,
      events: snapshot.events.map((event) => (event.id === eventId ? { ...event, [key]: value } : event))
    }));
  };

  const updateScenarioEventSchedule = (scenarioId: string, eventId: string, year: number) => {
    updateScenarioSnapshot(scenarioId, (snapshot) => ({
      ...snapshot,
      events: snapshot.events.map((event) =>
        event.id === eventId ? { ...event, year, age: getTargetAgeForYear(plan.profile.age, year) } : event
      )
    }));
  };

  const removeScenarioEvent = (scenarioId: string, eventId: string) => {
    updateScenarioSnapshot(scenarioId, (snapshot) => ({
      ...snapshot,
      events: snapshot.events.filter((event) => event.id !== eventId)
    }));
  };

  const adoptScenario = (id: string) => {
    const scenario = (plan.scenarios || []).find((item) => item.id === id);
    if (!scenario) return false;
    const adoptedAt = new Date().toISOString();
    const revision = createPlanRevision(
      plan,
      createId(),
      `「${scenario.name}」採用前`,
      "scenarioAdoption",
      adoptedAt
    );
    const adopted = adoptScenarioAsBase(plan, scenario, createId(), adoptedAt);
    return commitPlan({
      ...adopted,
      planRevisions: addPlanRevision(plan.planRevisions || [], revision)
    });
  };

  const removeScenario = (id: string) => {
    commitPlan({ ...plan, scenarios: (plan.scenarios || []).filter((scenario) => scenario.id !== id) });
  };

  const addFixedCostItem = () => {
    const nextItem: FixedCostItem = {
      id: createId(),
      name: "見直し項目",
      category: "other",
      currentMonthlyCost: 0,
      revisedMonthlyCost: 0,
      memo: ""
    };
    commitPlan({ ...plan, fixedCostItems: [...(plan.fixedCostItems || []), nextItem] });
  };

  const updateFixedCostItem = <K extends keyof FixedCostItem>(id: string, key: K, value: FixedCostItem[K]) => {
    commitPlan({
      ...plan,
      fixedCostItems: (plan.fixedCostItems || []).map((item) => (item.id === id ? { ...item, [key]: value } : item))
    });
  };

  const removeFixedCostItem = (id: string) => {
    commitPlan({ ...plan, fixedCostItems: (plan.fixedCostItems || []).filter((item) => item.id !== id) });
  };

  const addBudgetItem = () => {
    const nextItem: BudgetItem = {
      id: createId(),
      name: "予算項目",
      category: "other",
      frequency: "monthlyVariable",
      budgetAmount: 0,
      actuals: {},
      memo: ""
    };
    commitPlan({ ...plan, budgetItems: [...(plan.budgetItems || []), nextItem] });
  };

  const updateBudgetItem = <K extends keyof BudgetItem>(id: string, key: K, value: BudgetItem[K]) => {
    commitPlan({
      ...plan,
      budgetItems: (plan.budgetItems || []).map((item) => (item.id === id ? { ...item, [key]: value } : item))
    });
  };

  const updateBudgetActual = (id: string, monthKey: string, value: number) => {
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return;

    commitPlan({
      ...plan,
      budgetItems: (plan.budgetItems || []).map((item) =>
        item.id === id ? { ...item, actuals: { ...(item.actuals || {}), [monthKey]: value } } : item
      )
    });
  };

  const removeBudgetItem = (id: string) => {
    commitPlan({ ...plan, budgetItems: (plan.budgetItems || []).filter((item) => item.id !== id) });
  };

  const applyBudgetToHousehold = () => {
    const inputs = getBudgetHouseholdInputs(plan.budgetItems || []);
    commitPlan({
      ...plan,
      household: {
        ...plan.household,
        fixedCost: inputs.fixedCost,
        variableCost: inputs.variableCost,
        annualSpecialCost: inputs.annualSpecialCost
      }
    });
  };

  const addGoal = (draft: GoalDraft) => {
    const nextGoal: Goal = {
      id: createId(),
      ...draft,
      progress: 0,
    };
    commitPlan({ ...plan, goals: [...plan.goals, nextGoal] });
  };

  const updateGoal = <K extends keyof Goal>(id: string, key: K, value: Goal[K]) => {
    commitPlan({
      ...plan,
      goals: plan.goals.map((goal) => (goal.id === id ? { ...goal, [key]: value } : goal))
    });
  };

  const removeGoal = (id: string) => {
    commitPlan({ ...plan, goals: plan.goals.filter((goal) => goal.id !== id) });
  };

  const addEvent = (draft: LifeEventDraft) => {
    const nextEvent: LifeEvent = {
      id: createId(),
      ...draft,
      age: getTargetAgeForYear(plan.profile.age, draft.year)
    };
    commitPlan({ ...plan, events: [...plan.events, nextEvent] });
  };

  const updateEvent = <K extends keyof LifeEvent>(id: string, key: K, value: LifeEvent[K]) => {
    commitPlan({
      ...plan,
      events: plan.events.map((event) => (event.id === id ? { ...event, [key]: value } : event))
    });
  };

  const updateEventSchedule = (id: string, year: number) => {
    commitPlan({
      ...plan,
      events: plan.events.map((event) =>
        event.id === id ? { ...event, year, age: getTargetAgeForYear(plan.profile.age, year) } : event
      )
    });
  };

  const removeEvent = (id: string) => {
    commitPlan({ ...plan, events: plan.events.filter((event) => event.id !== id) });
  };

  const resetPlan = () => {
    try {
      createRecoveryBackup(plan, "before-reset");
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "復旧用コピーを保存できませんでした。");
      return;
    }
    const next = cloneDefaultPlan();
    commitPlan(next);
    setImportMessage("サンプルプランに戻しました。");
  };

  const startEmptyPlan = () => {
    try {
      createRecoveryBackup(plan, "before-reset");
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "復旧用コピーを保存できませんでした。");
      return;
    }
    commitPlan(createEmptyPlan());
    setImportMessage("空のプランを作成しました。");
  };

  return {
    plan,
    commitPlan,
    importMessage,
    setImportMessage,
    storageError,
    updateProfile,
    addHouseholdMember,
    updateHouseholdMember,
    removeHouseholdMember,
    updateHousehold,
    enableDetailedCashflow,
    useBasicCashflow,
    addDetailedCashflowItem,
    updateDetailedCashflowItem,
    removeDetailedCashflowItem,
    addCashflowPeriod,
    updateCashflowPeriod,
    removeCashflowPeriod,
    updateAssets,
    updateSimulation,
    updateWithdrawalPlan,
    updateWithdrawalPlanPatch,
    updateRetirementPlan,
    updateNotes,
    addTimelineMemo,
    updateTimelineMemo,
    removeTimelineMemo,
    addReview,
    updateReview,
    removeReview,
    applyBudgetActualsToReviewRecord,
    addScenarioFromReview,
    saveCurrentPlanRevision,
    restorePlanRevision,
    removePlanRevision,
    addScenario,
    updateScenario,
    updateScenarioHousehold,
    updateScenarioAssets,
    updateScenarioSimulation,
    addScenarioCashflowPeriod,
    updateScenarioCashflowPeriod,
    removeScenarioCashflowPeriod,
    addScenarioDetailedCashflowItem,
    updateScenarioDetailedCashflowItem,
    removeScenarioDetailedCashflowItem,
    addScenarioGoal,
    updateScenarioGoal,
    removeScenarioGoal,
    addScenarioEvent,
    updateScenarioEvent,
    updateScenarioEventSchedule,
    removeScenarioEvent,
    adoptScenario,
    removeScenario,
    addFixedCostItem,
    updateFixedCostItem,
    removeFixedCostItem,
    addBudgetItem,
    updateBudgetItem,
    updateBudgetActual,
    removeBudgetItem,
    applyBudgetToHousehold,
    addGoal,
    updateGoal,
    removeGoal,
    addEvent,
    updateEvent,
    updateEventSchedule,
    removeEvent,
    resetPlan,
    startEmptyPlan
  };
}
