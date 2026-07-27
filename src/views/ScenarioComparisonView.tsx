import { useMemo, useState } from "react";
import { LineChart } from "../components/Charts";
import { EmptyState, Metric, MoneyInput, NumericInput } from "../components/CommonUi";
import { DetailedCashflowEditor } from "../components/DetailedCashflowEditor";
import { ScenarioCashflowEditor } from "../components/scenarios/ScenarioCashflowEditor";
import { ScenarioEventsEditor } from "../components/scenarios/ScenarioEventsEditor";
import { ScenarioGoalsEditor } from "../components/scenarios/ScenarioGoalsEditor";
import { ScenarioImpactAnalysis } from "../components/scenarios/ScenarioImpactAnalysis";
import { MAX_RATE_PERCENT } from "../config";
import {
  scenarioTagLabels,
  scenarioTemplates,
  type ScenarioTemplate
} from "../data/scenarios";
import { featureTiers } from "../features";
import type {
  Assets,
  CashflowPeriod,
  CashflowPeriodDraft,
  DetailedCashflowItem,
  DetailedCashflowItemDraft,
  Goal,
  GoalDraft,
  Household,
  LifeEvent,
  LifeEventDraft,
  LifePlan,
  PlanScenario,
  ScenarioTag,
  SimulationSettings
} from "../types";
import {
  buildPlanFromScenario,
  getAnnualProjectionRows,
  getCurrentCashflowSummary,
  manYen
} from "../utils/calculations";
import { getScenarioComparisonMetrics, getScenarioImpactChanges } from "../utils/scenarios";

type ScenarioComparisonViewProps = {
  plan: LifePlan;
  addScenario: (template: ScenarioTemplate) => string | null;
  updateScenario: <K extends keyof PlanScenario>(id: string, key: K, value: PlanScenario[K]) => void;
  updateScenarioHousehold: <K extends keyof Household>(id: string, key: K, value: Household[K]) => void;
  updateScenarioAssets: <K extends keyof Assets>(id: string, key: K, value: Assets[K]) => void;
  updateScenarioSimulation: <K extends keyof SimulationSettings>(id: string, key: K, value: SimulationSettings[K]) => void;
  addScenarioCashflowPeriod: (id: string, draft: CashflowPeriodDraft) => void;
  updateScenarioCashflowPeriod: <K extends keyof CashflowPeriod>(scenarioId: string, periodId: string, key: K, value: CashflowPeriod[K]) => void;
  removeScenarioCashflowPeriod: (scenarioId: string, periodId: string) => void;
  addScenarioDetailedCashflowItem: (scenarioId: string, draft: DetailedCashflowItemDraft) => boolean;
  updateScenarioDetailedCashflowItem: <K extends keyof DetailedCashflowItem>(scenarioId: string, itemId: string, key: K, value: DetailedCashflowItem[K]) => void;
  removeScenarioDetailedCashflowItem: (scenarioId: string, itemId: string) => void;
  addScenarioGoal: (scenarioId: string, draft: GoalDraft) => void;
  updateScenarioGoal: <K extends keyof Goal>(scenarioId: string, goalId: string, key: K, value: Goal[K]) => void;
  removeScenarioGoal: (scenarioId: string, goalId: string) => void;
  addScenarioEvent: (scenarioId: string, draft: LifeEventDraft) => void;
  updateScenarioEvent: <K extends keyof LifeEvent>(scenarioId: string, eventId: string, key: K, value: LifeEvent[K]) => void;
  updateScenarioEventSchedule: (scenarioId: string, eventId: string, year: number) => void;
  removeScenarioEvent: (scenarioId: string, eventId: string) => void;
  adoptScenario: (id: string) => boolean;
  removeScenario: (id: string) => void;
  initialReviewYear: number | null;
};

export function ScenarioComparisonView({
  plan,
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
  initialReviewYear
}: ScenarioComparisonViewProps) {
  const scenarios = plan.scenarios || [];
  const [selectedScenarioId, setSelectedScenarioId] = useState(() => plan.scenarios?.[0]?.id || "current");
  const [workspaceTab, setWorkspaceTab] = useState<"plans" | "comparison">("plans");
  const [addMessage, setAddMessage] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [editorTab, setEditorTab] = useState<"assumptions" | "cashflow" | "goals" | "events">("assumptions");
  const comparisonMetrics = useMemo(() => getScenarioComparisonMetrics(plan), [plan]);
  const scenarioOptions = useMemo(
    () => [
      { id: "current", name: "現在プラン", plan },
      ...scenarios.map((scenario) => ({ id: scenario.id, name: scenario.name, plan: buildPlanFromScenario(plan, scenario) }))
    ],
    [plan, scenarios]
  );
  const selectedScenario = scenarioOptions.find((item) => item.id === selectedScenarioId) || scenarioOptions[0];
  const selectedPlanScenario = scenarios.find((scenario) => scenario.id === selectedScenarioId) || null;
  const selectedScenarioRows = getAnnualProjectionRows(selectedScenario.plan, 30);
  const selectedScenarioCashflow = getCurrentCashflowSummary(selectedScenario.plan);
  const selectedScenarioImpactChanges = useMemo(
    () => selectedPlanScenario ? getScenarioImpactChanges(plan, selectedPlanScenario) : [],
    [plan, selectedPlanScenario]
  );
  const currentComparisonMetric = comparisonMetrics.find((item) => item.id === "current");
  const selectedComparisonMetric = comparisonMetrics.find((item) => item.id === selectedScenarioId);
  const scenarioLimitReached = scenarios.length >= featureTiers.pro.scenarioLimit;

  const handleAddScenario = (template: ScenarioTemplate) => {
    const scenarioId = addScenario(template);
    if (scenarioId) {
      setSelectedScenarioId(scenarioId);
      setEditorTab("assumptions");
      setAddMessage(`「${template.name}」の見直しプランを追加しました。仮条件を確認して調整してください。`);
      return;
    }
    setAddMessage(
      scenarioLimitReached
        ? `見直しプランは最大${featureTiers.pro.scenarioLimit}件です。不要なプランを削除してから追加してください。`
        : "見直しプランを保存できませんでした。ブラウザの保存状態を確認してください。"
    );
  };

  const handleAdoptScenario = () => {
    if (!selectedPlanScenario) return;
    const confirmed = window.confirm(
      `「${selectedPlanScenario.name}」を基本プランへ採用しますか？採用前の基本プランは比較用の見直しプランとして残ります。`
    );
    if (!confirmed) return;
    if (adoptScenario(selectedPlanScenario.id)) {
      setSelectedScenarioId("current");
      setActionMessage(`「${selectedPlanScenario.name}」を基本プランへ採用しました。`);
    }
  };

  return (
    <div className="view-stack">
      <section className="pro-hero">
        <div>
          <p className="eyebrow">Pro予定 / 見直しプラン</p>
          <h2>暮らしの選択肢を作って比べる</h2>
          <p>支出、働き方、住まい、退職時期などの変更案を別のプランとして保存し、現在プランとの差を確認します。</p>
        </div>
        <span className="lock-badge">Pro機能</span>
      </section>

      <div className="segmented-control scenario-workspace-tabs" aria-label="見直しプランの表示内容">
        <button
          type="button"
          className={workspaceTab === "plans" ? "active" : ""}
          aria-pressed={workspaceTab === "plans"}
          onClick={() => setWorkspaceTab("plans")}
        >
          見直しプラン
        </button>
        <button
          type="button"
          className={workspaceTab === "comparison" ? "active" : ""}
          aria-pressed={workspaceTab === "comparison"}
          onClick={() => setWorkspaceTab("comparison")}
        >
          比較結果
        </button>
      </div>

      {initialReviewYear !== null && workspaceTab === "plans" && (
        <div className="notice-band check scenario-review-year-context" role="status">
          <strong>{initialReviewYear}年の年次収支から開きました</strong>
          <span>見直しプランを追加し、「時期別収支／詳細収支」または「イベント」で{initialReviewYear}年の条件を調整してください。</span>
        </div>
      )}

      {workspaceTab === "plans" && <section className="panel">
        <div className="section-heading">
          <div>
            <h2>見直しプランを作る</h2>
            <p>気になるテーマを選ぶと現在プランを複製します。金額と時期は仮条件なので、追加後に実際の予定へ調整してください。</p>
          </div>
          <span className="status-pill recurring">{scenarios.length} / {featureTiers.pro.scenarioLimit}件</span>
        </div>
        <div className="template-actions">
          {scenarioTemplates.map((template) => (
            <button key={template.tag} type="button" className="secondary" disabled={scenarioLimitReached} onClick={() => handleAddScenario(template)}>
              {template.name}
            </button>
          ))}
        </div>
        {addMessage ? <p className="success-text" role="status">{addMessage}</p> : null}
        {scenarios.length === 0 ? (
          <EmptyState title="見直しプランはまだありません" detail="まずは気になる変更案を1つ追加し、現在プランと比べてみましょう。" />
        ) : (
          <div className="scenario-list">
            {scenarios.map((scenario) => (
              <div className="scenario-row" key={scenario.id}>
                <label>
                  見直しプラン名
                  <input value={scenario.name} onChange={(event) => updateScenario(scenario.id, "name", event.target.value)} />
                </label>
                <label>
                  種類
                  <select
                    value={scenario.tag}
                    onChange={(event) => updateScenario(scenario.id, "tag", event.target.value as ScenarioTag)}
                  >
                    {Object.entries(scenarioTagLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="scenario-description-field">
                  前提メモ
                  <input
                    value={scenario.description}
                    onChange={(event) => updateScenario(scenario.id, "description", event.target.value)}
                    placeholder="例: 固定費を月3万円見直す"
                  />
                </label>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    removeScenario(scenario.id);
                    if (selectedScenarioId === scenario.id) {
                      setSelectedScenarioId(scenarios.find((item) => item.id !== scenario.id)?.id || "current");
                    }
                  }}
                >
                  削除
                </button>
              </div>
            ))}
          </div>
        )}
      </section>}

      {workspaceTab === "comparison" && <section className="panel">
        <div className="section-heading">
          <div>
            <h2>見直しプラン別の年次グラフ</h2>
            <p>選んだプランの30年見通しをグラフで確認します。</p>
          </div>
          <label className="compact-select">
            表示するプラン
            <select
              value={selectedScenarioId}
              onChange={(event) => {
                setSelectedScenarioId(event.target.value);
                setActionMessage("");
                setAddMessage("");
                setEditorTab("assumptions");
              }}
            >
              {scenarioOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <LineChart points={selectedScenarioRows} />
        {selectedPlanScenario && currentComparisonMetric && selectedComparisonMetric ? (
          <ScenarioImpactAnalysis
            current={currentComparisonMetric}
            proposed={selectedComparisonMetric}
            changes={selectedScenarioImpactChanges}
          />
        ) : null}
        {selectedPlanScenario && (
          <div className="scenario-adopt-actions">
            <div>
              <strong>比較結果を基本プランへ反映</strong>
              <span>採用前の基本条件は自動で見直しプランとして残るため、あとから比較・再採用できます。</span>
            </div>
            <button type="button" onClick={handleAdoptScenario}>このプランを採用</button>
          </div>
        )}
        {actionMessage && <p className="success-text" role="status">{actionMessage}</p>}
      </section>}

      {workspaceTab === "plans" && selectedPlanScenario && (
        <section className="panel scenario-assumptions-panel">
          <div className="section-heading">
            <div>
              <h2>選択中の見直しプラン</h2>
              <p>比較に使う家計、資産、積立の前提を変更します。基本プランは採用するまで変わりません。</p>
            </div>
            <label className="compact-select">
              編集するプラン
              <select
                value={selectedPlanScenario.id}
                onChange={(event) => {
                  setSelectedScenarioId(event.target.value);
                  setEditorTab("assumptions");
                  setActionMessage("");
                  setAddMessage("");
                }}
              >
                {scenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>{scenario.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="segmented-control scenario-editor-tabs" aria-label="見直しプランの編集項目">
            {[
              { id: "assumptions", label: "基本条件" },
              {
                id: "cashflow",
                label: selectedPlanScenario.snapshot.cashflowMode === "detailed"
                  ? `詳細収支 ${selectedPlanScenario.snapshot.detailedCashflowItems.length}`
                  : `時期別収支 ${selectedPlanScenario.snapshot.cashflowPeriods.length}`
              },
              { id: "goals", label: `目標 ${selectedPlanScenario.snapshot.goals.length}` },
              { id: "events", label: `イベント ${selectedPlanScenario.snapshot.events.length}` }
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={editorTab === tab.id ? "active" : ""}
                aria-pressed={editorTab === tab.id}
                onClick={() => setEditorTab(tab.id as typeof editorTab)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {editorTab === "assumptions" && (
            <div className="scenario-editor-content">
              <h3>家計</h3>
              {selectedPlanScenario.snapshot.cashflowMode === "detailed" ? (
                <>
                  <div className="calculation-band compact scenario-cashflow-summary">
                    <Metric label="月間収入" value={manYen(selectedScenarioCashflow.monthlyIncome)} helper="詳細収支の現在年合計" />
                    <Metric label="月間支出" value={manYen(selectedScenarioCashflow.monthlyLivingCost)} helper="年間特別支出の月割りを含む" />
                    <Metric label="通常月の家計余剰" value={manYen(selectedScenarioCashflow.monthlySavings)} helper="月間収入 - 月間支出" />
                  </div>
                  <div className="notice-band check">
                    <strong>家計は詳細収支から計算します</strong>
                    <span>収入・支出の変更は「詳細収支」タブで対象者と期間を指定してください。</span>
                  </div>
                </>
              ) : (
                <div className="form-grid">
                  <MoneyInput label="見直しプランの月収" value={selectedPlanScenario.snapshot.household.monthlyIncome} onChange={(value) => updateScenarioHousehold(selectedPlanScenario.id, "monthlyIncome", value)} />
                  <MoneyInput label="見直しプランのボーナス年額" value={selectedPlanScenario.snapshot.household.annualBonus} onChange={(value) => updateScenarioHousehold(selectedPlanScenario.id, "annualBonus", value)} />
                  <MoneyInput label="見直しプランの副業収入 月額" value={selectedPlanScenario.snapshot.household.sideIncome} onChange={(value) => updateScenarioHousehold(selectedPlanScenario.id, "sideIncome", value)} />
                  <MoneyInput label="見直しプランの固定費 月額" value={selectedPlanScenario.snapshot.household.fixedCost} onChange={(value) => updateScenarioHousehold(selectedPlanScenario.id, "fixedCost", value)} />
                  <MoneyInput label="見直しプランの変動費 月額" value={selectedPlanScenario.snapshot.household.variableCost} onChange={(value) => updateScenarioHousehold(selectedPlanScenario.id, "variableCost", value)} />
                  <MoneyInput label="見直しプランの年間特別支出" value={selectedPlanScenario.snapshot.household.annualSpecialCost} onChange={(value) => updateScenarioHousehold(selectedPlanScenario.id, "annualSpecialCost", value)} />
                </div>
              )}
              <h3>資産</h3>
              <div className="form-grid">
                <MoneyInput label="見直しプランの現金" value={selectedPlanScenario.snapshot.assets.cash} onChange={(value) => updateScenarioAssets(selectedPlanScenario.id, "cash", value)} />
                <MoneyInput label="見直しプランの投資資産" value={selectedPlanScenario.snapshot.assets.investment} onChange={(value) => updateScenarioAssets(selectedPlanScenario.id, "investment", value)} />
                <MoneyInput label="見直しプランのその他資産" value={selectedPlanScenario.snapshot.assets.other} onChange={(value) => updateScenarioAssets(selectedPlanScenario.id, "other", value)} />
                <MoneyInput label="見直しプランの負債" value={selectedPlanScenario.snapshot.assets.debt} onChange={(value) => updateScenarioAssets(selectedPlanScenario.id, "debt", value)} />
              </div>
              <h3>積立・基本見通し</h3>
              <div className="form-grid">
                <MoneyInput label="見直しプランで毎月投資へ回す額" value={selectedPlanScenario.snapshot.simulation.monthlyInvestmentAmount} onChange={(value) => updateScenarioSimulation(selectedPlanScenario.id, "monthlyInvestmentAmount", value)} />
                <MoneyInput label="見直しプランでボーナスから投資へ回す年額" value={selectedPlanScenario.snapshot.simulation.annualBonusInvestmentAmount} onChange={(value) => updateScenarioSimulation(selectedPlanScenario.id, "annualBonusInvestmentAmount", value)} />
                <label>
                  見直しプランの想定利回り %
                  <NumericInput value={selectedPlanScenario.snapshot.simulation.annualReturnRate} min={-MAX_RATE_PERCENT} max={MAX_RATE_PERCENT} allowDecimal onChange={(value) => updateScenarioSimulation(selectedPlanScenario.id, "annualReturnRate", value)} />
                </label>
              </div>
            </div>
          )}
          {editorTab === "cashflow" && (
            selectedPlanScenario.snapshot.cashflowMode === "detailed" ? (
              <DetailedCashflowEditor
                key={`detailed-cashflow-${selectedPlanScenario.id}`}
                items={selectedPlanScenario.snapshot.detailedCashflowItems}
                members={selectedPlanScenario.snapshot.householdMembers}
                currentAge={plan.profile.age}
                onAdd={(draft) => addScenarioDetailedCashflowItem(selectedPlanScenario.id, draft)}
                onUpdate={(itemId, key, value) => updateScenarioDetailedCashflowItem(selectedPlanScenario.id, itemId, key, value)}
                onRemove={(itemId) => removeScenarioDetailedCashflowItem(selectedPlanScenario.id, itemId)}
              />
            ) : (
              <ScenarioCashflowEditor
                key={`cashflow-${selectedPlanScenario.id}`}
                household={selectedPlanScenario.snapshot.household}
                periods={selectedPlanScenario.snapshot.cashflowPeriods}
                currentAge={plan.profile.age}
                onAdd={(draft) => addScenarioCashflowPeriod(selectedPlanScenario.id, draft)}
                onUpdate={(periodId, key, value) => updateScenarioCashflowPeriod(selectedPlanScenario.id, periodId, key, value)}
                onRemove={(periodId) => removeScenarioCashflowPeriod(selectedPlanScenario.id, periodId)}
              />
            )
          )}
          {editorTab === "goals" && (
            <ScenarioGoalsEditor
              key={`goals-${selectedPlanScenario.id}`}
              goals={selectedPlanScenario.snapshot.goals}
              currentAge={plan.profile.age}
              onAdd={(draft) => addScenarioGoal(selectedPlanScenario.id, draft)}
              onUpdate={(goalId, key, value) => updateScenarioGoal(selectedPlanScenario.id, goalId, key, value)}
              onRemove={(goalId) => removeScenarioGoal(selectedPlanScenario.id, goalId)}
            />
          )}
          {editorTab === "events" && (
            <ScenarioEventsEditor
              key={`events-${selectedPlanScenario.id}`}
              events={selectedPlanScenario.snapshot.events}
              currentAge={plan.profile.age}
              onAdd={(draft) => addScenarioEvent(selectedPlanScenario.id, draft)}
              onUpdate={(eventId, key, value) => updateScenarioEvent(selectedPlanScenario.id, eventId, key, value)}
              onScheduleChange={(eventId, year) => updateScenarioEventSchedule(selectedPlanScenario.id, eventId, year)}
              onRemove={(eventId) => removeScenarioEvent(selectedPlanScenario.id, eventId)}
            />
          )}
        </section>
      )}

      {workspaceTab === "comparison" && <section className="panel">
        <h2>比較表</h2>
        <p>入力条件に基づく参考試算として、主要な差分を確認します。</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>比較項目</th>
                {comparisonMetrics.map((item) => (
                  <th key={item.id}>{item.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { label: "通常月の家計余剰", getValue: (item: (typeof comparisonMetrics)[number]) => manYen(item.monthlySavings) },
                { label: "年間収支", getValue: (item: (typeof comparisonMetrics)[number]) => manYen(item.annualBalance) },
                { label: "現在純資産", getValue: (item: (typeof comparisonMetrics)[number]) => manYen(item.netAssets) },
                { label: "10年後資産", getValue: (item: (typeof comparisonMetrics)[number]) => manYen(item.tenYear) },
                { label: "30年後資産", getValue: (item: (typeof comparisonMetrics)[number]) => manYen(item.thirtyYear) },
                { label: "主要目標の達成目安", getValue: (item: (typeof comparisonMetrics)[number]) => item.goalLabel },
                { label: "生活防衛資金の状態", getValue: (item: (typeof comparisonMetrics)[number]) => item.emergencyLabel }
              ].map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  {comparisonMetrics.map((item) => (
                    <td key={`${row.label}-${item.id}`}>{row.getValue(item)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>}
    </div>
  );
}
