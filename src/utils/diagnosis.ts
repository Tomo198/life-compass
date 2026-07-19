import { budgetCategoryLabels } from "../data/labels";
import type { EventOwner, LifePlan, ScenarioTag, ViewKey } from "../types";
import {
  emergencyMonthsLabel,
  getAssetSummary,
  getBudgetSummary,
  getCashflowSummary,
  getEmergencyFundResult,
  getGoalAchievements,
  getGoalFundingSummary,
  manYen,
  percent
} from "./calculations";

export type DiagnosisItem = {
  title: string;
  detail: string;
  tone: "good" | "check" | "notice";
  view: ViewKey;
  suggestedScenarioTag?: ScenarioTag;
};

export function getLifePlanDiagnosis(plan: LifePlan): DiagnosisItem[] {
  const cashflow = getCashflowSummary(plan.household);
  const assets = getAssetSummary(plan.assets);
  const emergency = getEmergencyFundResult(plan);
  const goalAchievements = getGoalAchievements(plan);
  const goalFunding = getGoalFundingSummary(plan);
  const eventYears = new Map<number, { count: number; impact: number }>();

  plan.events.forEach((event) => {
    const current = eventYears.get(event.year) || { count: 0, impact: 0 };
    const impact = event.cashflowType === "expense" ? -event.amount : event.cashflowType === "income" ? event.amount : 0;
    eventYears.set(event.year, { count: current.count + 1, impact: current.impact + impact });
  });

  const concentratedYear = [...eventYears.entries()].sort((a, b) => b[1].count - a[1].count || Math.abs(b[1].impact) - Math.abs(a[1].impact))[0];
  const ownerCounts = plan.events.reduce<Record<EventOwner, number>>(
    (counts, event) => {
      counts[event.owner || "household"] += 1;
      return counts;
    },
    { self: 0, spouse: 0, child: 0, parent: 0, household: 0, other: 0 }
  );
  const latestReview = [...(plan.reviews || [])].sort((a, b) => b.date.localeCompare(a.date))[0];
  const daysSinceReview = latestReview
    ? Math.floor((Date.now() - new Date(latestReview.date).getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const openTodos = (plan.reviews || []).filter((review) => review.todo && !review.todoDone).length;
  const backupDays = plan.updatedAt ? Math.floor((Date.now() - new Date(plan.updatedAt).getTime()) / (1000 * 60 * 60 * 24)) : null;
  const currentDate = new Date();
  const currentMonthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}`;
  const budgetSummary = getBudgetSummary(plan.budgetItems || [], currentMonthKey);
  const overBudgetCategories = budgetSummary.categoryRows.filter(
    (row) => row.actualEntryCount === row.itemCount && row.variance > 0
  );
  const items: DiagnosisItem[] = [];

  items.push({
    title: emergency.status === "short" ? "生活防衛資金に不足があります" : "生活防衛資金の目安を確認済みです",
    detail:
      emergency.status === "short"
        ? `${emergency.lowerMonths}ヶ月分まであと${manYen(emergency.shortageToLower)}です。固定費や現金へ残す額と合わせて確認します。`
        : `${emergencyMonthsLabel(emergency.lowerMonths, emergency.upperMonths)}の目安と現在の現金を比較しています。`,
    tone: emergency.status === "short" ? "notice" : "good",
    view: "simulation"
  });

  items.push({
    title: cashflow.monthlySavings < 0 ? "通常月の収支がマイナスの前提です" : "通常月の家計余剰を確認できます",
    detail:
      cashflow.monthlySavings < 0
        ? `毎月${manYen(Math.abs(cashflow.monthlySavings))}の不足です。固定費、変動費、特別支出の入力を確認します。`
        : `通常月の家計余剰は${manYen(cashflow.monthlySavings)}、貯蓄率は${percent(cashflow.savingsRate)}の前提です。`,
    tone: cashflow.monthlySavings < 0 ? "notice" : "good",
    view: "household",
    suggestedScenarioTag: cashflow.monthlySavings < 0 ? "spending" : undefined
  });

  if (assets.netAssets < 0) {
    items.push({
      title: "純資産がマイナスの前提です",
      detail: `現在純資産は${manYen(assets.netAssets)}です。資産入力の負債やその他資産を確認します。`,
      tone: "notice",
      view: "assets"
    });
  }

  const unreachableGoals = goalAchievements.filter(({ achievement }) => achievement.status === "unreachable");
  if (goalFunding.overAllocatedAmount > 0) {
    items.push({
      title: "目標への毎月配分が家計余剰を超えています",
      detail: `毎月${manYen(goalFunding.overAllocatedAmount)}の超過です。複数の目標で同じ資金を重ねて見込んでいないか確認します。`,
      tone: "notice",
      view: "goals"
    });
  } else if (unreachableGoals.length > 0) {
    items.push({
      title: "達成目安が出ない目標があります",
      detail: `${unreachableGoals.length}件の目標で、毎月この目標に回す額が未入力です。`,
      tone: "check",
      view: "goals"
    });
  } else if (plan.goals.length > 0) {
    items.push({
      title: "目標の達成目安を確認できます",
      detail: `${plan.goals.length}件の目標について、期限や準備額をもとに確認できます。`,
      tone: "good",
      view: "goals"
    });
  }

  if (concentratedYear && concentratedYear[1].count >= 3) {
    items.push({
      title: "イベントが集中している年があります",
      detail: `${concentratedYear[0]}年に${concentratedYear[1].count}件のイベントがあります。支出・収入変化の重なりを確認します。`,
      tone: "check",
      view: "timeline"
    });
  }

  if (ownerCounts.child > 0 || ownerCounts.parent > 0 || ownerCounts.spouse > 0) {
    items.push({
      title: "世帯メンバー別のイベントがあります",
      detail: `子ども${ownerCounts.child}件、親${ownerCounts.parent}件、配偶者${ownerCounts.spouse}件。対象者フィルターで確認できます。`,
      tone: "good",
      view: "timeline"
    });
  } else {
    items.push({
      title: "対象者別イベントはまだ少なめです",
      detail: "配偶者、子ども、親に関する予定がある場合は、年表で対象者を分けると見返しやすくなります。",
      tone: "check",
      view: "timeline"
    });
  }

  items.push({
    title: latestReview ? "レビュー履歴があります" : "レビュー履歴はまだありません",
    detail: latestReview
      ? `最新レビューは${latestReview.date}です。${daysSinceReview !== null ? `${daysSinceReview}日前の記録です。` : ""}`
      : "月次・四半期レビューを残すと、前回との差分とTODOを確認できます。",
    tone: latestReview ? "good" : "check",
    view: "reviews"
  });

  if (openTodos > 0) {
    items.push({
      title: "未完了TODOがあります",
      detail: `${openTodos}件のTODOが未完了です。次回の見直しで確認できます。`,
      tone: "check",
      view: "reviews"
    });
  }

  if ((plan.budgetItems || []).length === 0) {
    items.push({
      title: "予算・実績プランはまだありません",
      detail: "月別の予算と実績を入れると、レビューや家計入力の前提確認に使えます。",
      tone: "check",
      view: "budget"
    });
  } else if (overBudgetCategories.length > 0) {
    items.push({
      title: "予算を上回っているカテゴリがあります",
      detail: `${currentMonthKey} は ${overBudgetCategories.slice(0, 3).map((row) => budgetCategoryLabels[row.category]).join("、")} を確認できます。`,
      tone: "check",
      view: "budget",
      suggestedScenarioTag: "spending"
    });
  } else {
    items.push({
      title: "予算・実績を確認できます",
      detail: `${(plan.budgetItems || []).length}件の予算項目があります。月次レビューの前提として使えます。`,
      tone: "good",
      view: "budget"
    });
  }

  items.push({
    title: (plan.scenarios || []).length > 0 ? "比較シナリオがあります" : "比較シナリオはまだありません",
    detail:
      (plan.scenarios || []).length > 0
        ? `${plan.scenarios.length}件のシナリオを保存しています。年次グラフと比較表で確認できます。`
        : "転職、副業、住宅購入などの変更案を保存すると、現状プランと比較できます。",
    tone: (plan.scenarios || []).length > 0 ? "good" : "check",
    view: "scenarios"
  });

  if (backupDays !== null && backupDays >= 30) {
    items.push({
      title: "バックアップ確認の時期です",
      detail: `最終保存から約${backupDays}日です。必要に応じてJSONエクスポートを確認します。`,
      tone: "check",
      view: "data"
    });
  }

  return items;
}
