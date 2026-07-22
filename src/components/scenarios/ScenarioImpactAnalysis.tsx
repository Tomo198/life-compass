import type {
  ScenarioComparisonMetric,
  ScenarioImpactChange,
  ScenarioImpactGroup
} from "../../utils/scenarios";
import { manYen } from "../../utils/calculations";

type ScenarioImpactAnalysisProps = {
  current: ScenarioComparisonMetric;
  proposed: ScenarioComparisonMetric;
  changes: ScenarioImpactChange[];
};

const groupLabels: Record<ScenarioImpactGroup, string> = {
  cashflow: "収入・支出",
  assets: "現在資産",
  allocation: "積立・利回り",
  events: "ライフイベント",
  goals: "目標"
};

const groupOrder: ScenarioImpactGroup[] = ["cashflow", "assets", "allocation", "events", "goals"];

const signedMoney = (value: number) => `${value > 0 ? "+" : ""}${manYen(value)}`;

export function ScenarioImpactAnalysis({ current, proposed, changes }: ScenarioImpactAnalysisProps) {
  const outcomes = [
    { id: "monthlySavings", label: "通常月の家計余剰", current: current.monthlySavings, proposed: proposed.monthlySavings },
    { id: "netAssets", label: "現在純資産", current: current.netAssets, proposed: proposed.netAssets },
    { id: "tenYear", label: "10年後資産", current: current.tenYear, proposed: proposed.tenYear },
    { id: "thirtyYear", label: "30年後資産", current: current.thirtyYear, proposed: proposed.thirtyYear }
  ];
  const groups = groupOrder
    .map((group) => ({ group, changes: changes.filter((change) => change.group === group) }))
    .filter((item) => item.changes.length > 0);

  return (
    <section className="scenario-impact-analysis" data-testid="scenario-impact-analysis" aria-labelledby="scenario-impact-title">
      <div className="section-heading scenario-impact-heading">
        <div>
          <h3 id="scenario-impact-title">影響分析</h3>
          <p>順位付けや助言ではなく、現在プランから変更した前提と、見通し全体の差を整理します。</p>
        </div>
        <span className="status-pill recurring">変更 {changes.length}件</span>
      </div>

      <div className="scenario-impact-results" aria-label="結果の差">
        {outcomes.map((outcome) => (
          <div className="scenario-impact-result" key={outcome.id}>
            <span>{outcome.label}</span>
            <div className="scenario-impact-values">
              <small>現在 {manYen(outcome.current)}</small>
              <strong>{manYen(outcome.proposed)}</strong>
            </div>
            <small>差 {signedMoney(outcome.proposed - outcome.current)}</small>
          </div>
        ))}
      </div>
      <p className="scenario-impact-caption">
        結果の差は、選択した見直しプランの変更をすべて反映した試算です。各前提の直接差を単純に足した値ではありません。
      </p>

      <div className="scenario-impact-change-heading">
        <h4>変更した前提</h4>
        <p>金額と時期の変更を、試算へ反映される単位で表示します。</p>
      </div>
      {groups.length === 0 ? (
        <div className="notice-band neutral">
          <strong>現在プランとの前提差はありません</strong>
          <span>見直しプランの家計、資産、積立、目標またはイベントを変更すると、ここに表示されます。</span>
        </div>
      ) : (
        <div className="scenario-impact-groups">
          {groups.map(({ group, changes: groupChanges }) => (
            <details className="scenario-impact-group" key={group} open>
              <summary>
                <span>{groupLabels[group]}</span>
                <small>{groupChanges.length}件</small>
              </summary>
              <div className="scenario-impact-list">
                {groupChanges.map((change) => (
                  <div className="scenario-impact-row" key={change.id}>
                    <div className="scenario-impact-label">
                      <strong>{change.label}</strong>
                      {change.period ? <small>{change.period}</small> : null}
                    </div>
                    <div className="scenario-impact-before-after">
                      <span>{change.currentValue}</span>
                      <span aria-hidden="true">→</span>
                      <strong>{change.proposedValue}</strong>
                    </div>
                    <p>{change.effect}</p>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
