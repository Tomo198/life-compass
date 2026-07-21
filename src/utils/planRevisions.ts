import { MAX_PLAN_REVISIONS } from "../config";
import { createSuggestedHouseholdMembers } from "../data/householdMembers";
import type {
  LifePlan,
  PlanRevision,
  PlanRevisionSnapshot,
  PlanRevisionSource
} from "../types";

const cloneSnapshot = (snapshot: PlanRevisionSnapshot): PlanRevisionSnapshot => ({
  profile: { ...snapshot.profile },
  householdMembers: (snapshot.householdMembers || createSuggestedHouseholdMembers(snapshot.profile)).map((member) => ({
    ...member
  })),
  household: { ...snapshot.household },
  cashflowMode: snapshot.cashflowMode || "basic",
  detailedCashflowItems: (snapshot.detailedCashflowItems || []).map((item) => ({ ...item })),
  cashflowPeriods: snapshot.cashflowPeriods.map((period) => ({ ...period })),
  assets: { ...snapshot.assets },
  goals: snapshot.goals.map((goal) => ({ ...goal })),
  events: snapshot.events.map((event) => ({ ...event })),
  timelineMemos: snapshot.timelineMemos.map((memo) => ({ ...memo })),
  simulation: { ...snapshot.simulation },
  withdrawalPlan: {
    ...snapshot.withdrawalPlan,
    periods: snapshot.withdrawalPlan.periods.map((period) => ({ ...period }))
  },
  retirementPlan: { ...snapshot.retirementPlan },
  notes: { ...snapshot.notes },
  activeScenario: snapshot.activeScenario ? { ...snapshot.activeScenario } : undefined,
  fixedCostItems: snapshot.fixedCostItems.map((item) => ({ ...item })),
  budgetItems: snapshot.budgetItems.map((item) => ({
    ...item,
    actuals: { ...item.actuals }
  }))
});

export const createPlanRevisionSnapshot = (plan: LifePlan): PlanRevisionSnapshot =>
  cloneSnapshot({
    profile: plan.profile,
    householdMembers: plan.householdMembers || createSuggestedHouseholdMembers(plan.profile),
    household: plan.household,
    cashflowMode: plan.cashflowMode || "basic",
    detailedCashflowItems: plan.detailedCashflowItems || [],
    cashflowPeriods: plan.cashflowPeriods || [],
    assets: plan.assets,
    goals: plan.goals,
    events: plan.events,
    timelineMemos: plan.timelineMemos || [],
    simulation: plan.simulation,
    withdrawalPlan: plan.withdrawalPlan,
    retirementPlan: plan.retirementPlan,
    notes: plan.notes,
    activeScenario: plan.activeScenario,
    fixedCostItems: plan.fixedCostItems || [],
    budgetItems: plan.budgetItems || []
  });

export const createPlanRevision = (
  plan: LifePlan,
  id: string,
  title: string,
  source: PlanRevisionSource,
  createdAt: string,
  sourceReviewId?: string
): PlanRevision => ({
  id,
  title,
  source,
  createdAt,
  sourceReviewId,
  snapshot: createPlanRevisionSnapshot(plan)
});

export const addPlanRevision = (revisions: PlanRevision[], revision: PlanRevision) =>
  [revision, ...revisions.filter((item) => item.id !== revision.id)].slice(0, MAX_PLAN_REVISIONS);

export const restorePlanRevision = (
  plan: LifePlan,
  revision: PlanRevision,
  beforeRestoreRevision: PlanRevision
): LifePlan => ({
  ...plan,
  ...cloneSnapshot(revision.snapshot),
  reviews: plan.reviews,
  scenarios: plan.scenarios,
  planRevisions: addPlanRevision(plan.planRevisions || [], beforeRestoreRevision)
});
