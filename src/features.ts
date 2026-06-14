export const featureTiers = {
  free: {
    planLimit: 1,
    scenarioLimit: 0,
    scenarioComparison: false,
    reviewHistory: false,
    fixedCostImpact: false,
    budgetPlanning: true,
    advancedBudgetReview: false,
    lifePlanDiagnosis: false,
    householdEventOwners: false,
    detailedWithdrawal: false,
    retirementPlanning: false,
    cloudSync: false
  },
  pro: {
    planLimit: 20,
    scenarioLimit: 20,
    scenarioComparison: true,
    reviewHistory: true,
    fixedCostImpact: true,
    budgetPlanning: true,
    advancedBudgetReview: true,
    lifePlanDiagnosis: true,
    householdEventOwners: true,
    detailedWithdrawal: true,
    retirementPlanning: true,
    cloudSync: true
  }
};

export const proPriceLabel = "月500円程度を想定";
