import type { LifePlan } from "../types";
import {
  buildPlanFromScenario,
  emergencyMonthsLabel,
  getAssetSummary,
  getCashflowSummary,
  getEmergencyFundResult,
  getGoalAchievement,
  getPrimaryGoal,
  manYen,
  projectAssets
} from "./calculations";

export function getScenarioComparisonMetrics(plan: LifePlan) {
  const scenarios = plan.scenarios || [];
  const comparisonPlans = [
    { id: "current", name: "現在プラン", plan },
    ...scenarios.map((scenario) => ({
      id: scenario.id,
      name: scenario.name,
      plan: buildPlanFromScenario(plan, scenario)
    }))
  ];

  return comparisonPlans.map((item) => {
    const cashflow = getCashflowSummary(item.plan.household);
    const assets = getAssetSummary(item.plan.assets);
    const projection = projectAssets(item.plan, 30);
    const primaryGoal = getPrimaryGoal(item.plan);
    const goalAchievement = primaryGoal ? getGoalAchievement(item.plan, primaryGoal) : null;
    const emergency = getEmergencyFundResult(item.plan);
    const goalLabel = !primaryGoal
      ? "目標未設定"
      : goalAchievement?.status === "achieved"
        ? "達成済み"
        : goalAchievement?.status === "unreachable"
          ? "毎月の準備額未設定"
          : goalAchievement?.status === "recurring"
            ? `${primaryGoal.title}: 継続目標`
            : `${primaryGoal.title}: ${goalAchievement?.targetAge}歳目安`;
    const emergencyLabel =
      emergency.status === "short"
        ? `${emergency.lowerMonths}ヶ月分まであと${manYen(emergency.shortageToLower)}`
        : emergency.status === "above"
          ? `${emergency.upperMonths}ヶ月分を上回る`
          : `${emergencyMonthsLabel(emergency.lowerMonths, emergency.upperMonths)}の目安内`;

    return {
      id: item.id,
      name: item.name,
      monthlySavings: cashflow.monthlySavings,
      annualBalance: cashflow.annualIncome - cashflow.annualLivingCost,
      netAssets: assets.netAssets,
      tenYear: projection[10]?.value ?? 0,
      thirtyYear: projection[30]?.value ?? 0,
      goalLabel,
      emergencyLabel
    };
  });
}
