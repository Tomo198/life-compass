import { useMemo, useState } from "react";
import { LineChart } from "../components/Charts";
import { EmptyState } from "../components/CommonUi";
import {
  scenarioTagLabels,
  scenarioTemplates,
  type ScenarioTemplate
} from "../data/scenarios";
import type { LifePlan, PlanScenario, ScenarioTag } from "../types";
import {
  buildPlanFromScenario,
  getAnnualProjectionRows,
  manYen
} from "../utils/calculations";
import { getScenarioComparisonMetrics } from "../utils/scenarios";

type ScenarioComparisonViewProps = {
  plan: LifePlan;
  addScenario: (template: ScenarioTemplate) => void;
  updateScenario: <K extends keyof PlanScenario>(id: string, key: K, value: PlanScenario[K]) => void;
  removeScenario: (id: string) => void;
};

export function ScenarioComparisonView({ plan, addScenario, updateScenario, removeScenario }: ScenarioComparisonViewProps) {
  const scenarios = plan.scenarios || [];
  const [selectedScenarioId, setSelectedScenarioId] = useState("current");
  const comparisonMetrics = useMemo(() => getScenarioComparisonMetrics(plan), [plan]);
  const scenarioOptions = useMemo(
    () => [
      { id: "current", name: "現在プラン", plan },
      ...scenarios.map((scenario) => ({ id: scenario.id, name: scenario.name, plan: buildPlanFromScenario(plan, scenario) }))
    ],
    [plan, scenarios]
  );
  const selectedScenario = scenarioOptions.find((item) => item.id === selectedScenarioId) || scenarioOptions[0];
  const selectedScenarioRows = getAnnualProjectionRows(selectedScenario.plan, 30);

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
          <span className="status-pill recurring">{scenarios.length}件</span>
        </div>
        <div className="template-actions">
          {scenarioTemplates.map((template) => (
            <button key={template.tag} type="button" className="secondary" onClick={() => addScenario(template)}>
              {template.name}
            </button>
          ))}
        </div>
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
            <select value={selectedScenarioId} onChange={(event) => setSelectedScenarioId(event.target.value)}>
              {scenarioOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <LineChart points={selectedScenarioRows} />
      </section>

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
