import { useMemo, useState } from "react";
import { LineChart } from "../components/Charts";
import { EmptyState, MoneyInput, NumericInput } from "../components/CommonUi";
import { ScenarioCashflowEditor } from "../components/scenarios/ScenarioCashflowEditor";
import { ScenarioEventsEditor } from "../components/scenarios/ScenarioEventsEditor";
import { ScenarioGoalsEditor } from "../components/scenarios/ScenarioGoalsEditor";
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
  manYen
} from "../utils/calculations";
import { getScenarioComparisonMetrics } from "../utils/scenarios";

type ScenarioComparisonViewProps = {
  plan: LifePlan;
  addScenario: (template: ScenarioTemplate) => boolean;
  updateScenario: <K extends keyof PlanScenario>(id: string, key: K, value: PlanScenario[K]) => void;
  updateScenarioHousehold: <K extends keyof Household>(id: string, key: K, value: Household[K]) => void;
  updateScenarioAssets: <K extends keyof Assets>(id: string, key: K, value: Assets[K]) => void;
  updateScenarioSimulation: <K extends keyof SimulationSettings>(id: string, key: K, value: SimulationSettings[K]) => void;
  addScenarioCashflowPeriod: (id: string, draft: CashflowPeriodDraft) => void;
  updateScenarioCashflowPeriod: <K extends keyof CashflowPeriod>(scenarioId: string, periodId: string, key: K, value: CashflowPeriod[K]) => void;
  removeScenarioCashflowPeriod: (scenarioId: string, periodId: string) => void;
  addScenarioGoal: (scenarioId: string, draft: GoalDraft) => void;
  updateScenarioGoal: <K extends keyof Goal>(scenarioId: string, goalId: string, key: K, value: Goal[K]) => void;
  removeScenarioGoal: (scenarioId: string, goalId: string) => void;
  addScenarioEvent: (scenarioId: string, draft: LifeEventDraft) => void;
  updateScenarioEvent: <K extends keyof LifeEvent>(scenarioId: string, eventId: string, key: K, value: LifeEvent[K]) => void;
  updateScenarioEventSchedule: (scenarioId: string, eventId: string, year: number) => void;
  removeScenarioEvent: (scenarioId: string, eventId: string) => void;
  adoptScenario: (id: string) => boolean;
  removeScenario: (id: string) => void;
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
  addScenarioGoal,
  updateScenarioGoal,
  removeScenarioGoal,
  addScenarioEvent,
  updateScenarioEvent,
  updateScenarioEventSchedule,
  removeScenarioEvent,
  adoptScenario,
  removeScenario
}: ScenarioComparisonViewProps) {
  const scenarios = plan.scenarios || [];
  const [selectedScenarioId, setSelectedScenarioId] = useState("current");
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
  const scenarioLimitReached = scenarios.length >= featureTiers.pro.scenarioLimit;

  const handleAddScenario = (template: ScenarioTemplate) => {
    if (addScenario(template)) {
      setAddMessage(`「${template.name}」の比較案を追加しました。仮条件を確認して調整してください。`);
      return;
    }
    setAddMessage(
      scenarioLimitReached
        ? `比較案は最大${featureTiers.pro.scenarioLimit}件です。不要な案を削除してから追加してください。`
        : "比較案を保存できませんでした。ブラウザの保存状態を確認してください。"
    );
  };

  const handleAdoptScenario = () => {
    if (!selectedPlanScenario) return;
    const confirmed = window.confirm(
      `「${selectedPlanScenario.name}」を基本プランへ採用しますか？採用前の基本プランは比較用シナリオとして残ります。`
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
          <p className="eyebrow">Pro予定 / シナリオ比較</p>
          <h2>選択肢ごとの将来見通しを横並びで確認</h2>
          <p>現状維持、支出見直し、転職、副業、住宅購入、早期退職などを同じ入力条件から分けて保存します。</p>
        </div>
        <span className="lock-badge">Coming soon</span>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>シナリオを追加</h2>
            <p>テンプレートは仮条件です。個別の助言ではなく、前提条件に基づく比較用のたたき台として使います。</p>
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
          <EmptyState title="シナリオはまだありません" detail="まずは現状維持と、気になる変更案を1つ追加すると比較しやすくなります。" />
        ) : (
          <div className="scenario-list">
            {scenarios.map((scenario) => (
              <div className="scenario-row" key={scenario.id}>
                <label>
                  シナリオ名
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
                <button type="button" className="text-button" onClick={() => removeScenario(scenario.id)}>
                  削除
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>シナリオ別の年次グラフ</h2>
            <p>選んだシナリオの30年見通しをグラフで確認します。</p>
          </div>
          <label className="compact-select">
            表示シナリオ
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
        {selectedPlanScenario && (
          <div className="scenario-adopt-actions">
            <div>
              <strong>比較結果を基本プランへ反映</strong>
              <span>採用前の基本条件は自動でシナリオとして残るため、あとから比較・再採用できます。</span>
            </div>
            <button type="button" onClick={handleAdoptScenario}>このシナリオを採用</button>
          </div>
        )}
        {actionMessage && <p className="success-text" role="status">{actionMessage}</p>}
      </section>

      {selectedPlanScenario && (
        <section className="panel scenario-assumptions-panel">
          <div className="section-heading">
            <div>
              <h2>選択中のシナリオ前提</h2>
              <p>比較に使う家計、資産、積立の前提を変更します。基本プランは採用するまで変わりません。</p>
            </div>
            <span className="status-pill recurring">{selectedPlanScenario.name}</span>
          </div>
          <div className="segmented-control scenario-editor-tabs" aria-label="シナリオ編集項目">
            {[
              { id: "assumptions", label: "基本条件" },
              { id: "cashflow", label: `時期別収支 ${selectedPlanScenario.snapshot.cashflowPeriods.length}` },
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
              <div className="form-grid">
                <MoneyInput label="シナリオの月収" value={selectedPlanScenario.snapshot.household.monthlyIncome} onChange={(value) => updateScenarioHousehold(selectedPlanScenario.id, "monthlyIncome", value)} />
                <MoneyInput label="シナリオのボーナス年額" value={selectedPlanScenario.snapshot.household.annualBonus} onChange={(value) => updateScenarioHousehold(selectedPlanScenario.id, "annualBonus", value)} />
                <MoneyInput label="シナリオの副業収入 月額" value={selectedPlanScenario.snapshot.household.sideIncome} onChange={(value) => updateScenarioHousehold(selectedPlanScenario.id, "sideIncome", value)} />
                <MoneyInput label="シナリオの固定費 月額" value={selectedPlanScenario.snapshot.household.fixedCost} onChange={(value) => updateScenarioHousehold(selectedPlanScenario.id, "fixedCost", value)} />
                <MoneyInput label="シナリオの変動費 月額" value={selectedPlanScenario.snapshot.household.variableCost} onChange={(value) => updateScenarioHousehold(selectedPlanScenario.id, "variableCost", value)} />
                <MoneyInput label="シナリオの年間特別支出" value={selectedPlanScenario.snapshot.household.annualSpecialCost} onChange={(value) => updateScenarioHousehold(selectedPlanScenario.id, "annualSpecialCost", value)} />
              </div>
              <h3>資産</h3>
              <div className="form-grid">
                <MoneyInput label="シナリオの現金" value={selectedPlanScenario.snapshot.assets.cash} onChange={(value) => updateScenarioAssets(selectedPlanScenario.id, "cash", value)} />
                <MoneyInput label="シナリオの投資資産" value={selectedPlanScenario.snapshot.assets.investment} onChange={(value) => updateScenarioAssets(selectedPlanScenario.id, "investment", value)} />
                <MoneyInput label="シナリオのその他資産" value={selectedPlanScenario.snapshot.assets.other} onChange={(value) => updateScenarioAssets(selectedPlanScenario.id, "other", value)} />
                <MoneyInput label="シナリオの負債" value={selectedPlanScenario.snapshot.assets.debt} onChange={(value) => updateScenarioAssets(selectedPlanScenario.id, "debt", value)} />
              </div>
              <h3>積立・基本見通し</h3>
              <div className="form-grid">
                <MoneyInput label="シナリオで毎月投資へ回す額" value={selectedPlanScenario.snapshot.simulation.monthlyInvestmentAmount} onChange={(value) => updateScenarioSimulation(selectedPlanScenario.id, "monthlyInvestmentAmount", value)} />
                <MoneyInput label="シナリオでボーナスから投資へ回す年額" value={selectedPlanScenario.snapshot.simulation.annualBonusInvestmentAmount} onChange={(value) => updateScenarioSimulation(selectedPlanScenario.id, "annualBonusInvestmentAmount", value)} />
                <label>
                  シナリオの想定利回り %
                  <NumericInput value={selectedPlanScenario.snapshot.simulation.annualReturnRate} min={-MAX_RATE_PERCENT} max={MAX_RATE_PERCENT} allowDecimal onChange={(value) => updateScenarioSimulation(selectedPlanScenario.id, "annualReturnRate", value)} />
                </label>
              </div>
            </div>
          )}
          {editorTab === "cashflow" && (
            <ScenarioCashflowEditor
              key={`cashflow-${selectedPlanScenario.id}`}
              household={selectedPlanScenario.snapshot.household}
              periods={selectedPlanScenario.snapshot.cashflowPeriods}
              currentAge={plan.profile.age}
              onAdd={(draft) => addScenarioCashflowPeriod(selectedPlanScenario.id, draft)}
              onUpdate={(periodId, key, value) => updateScenarioCashflowPeriod(selectedPlanScenario.id, periodId, key, value)}
              onRemove={(periodId) => removeScenarioCashflowPeriod(selectedPlanScenario.id, periodId)}
            />
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

      <section className="panel">
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
      </section>
    </div>
  );
}
