import { useState } from "react";
import { Metric } from "../components/CommonUi";
import { scenarioTemplates, type ScenarioTemplate } from "../data/scenarios";
import { featureTiers } from "../features";
import type { LifePlan, ViewKey } from "../types";
import { getLifePlanDiagnosis, type DiagnosisItem } from "../utils/diagnosis";

type LifePlanDiagnosisViewProps = {
  plan: LifePlan;
  setActiveView: (view: ViewKey) => void;
  addScenario: (template: ScenarioTemplate) => string | null;
};

export function LifePlanDiagnosisView({ plan, setActiveView, addScenario }: LifePlanDiagnosisViewProps) {
  const [actionMessage, setActionMessage] = useState("");
  const diagnosisItems = getLifePlanDiagnosis(plan);
  const pendingItems = diagnosisItems.filter((item) => item.tone !== "good");
  const confirmedItems = diagnosisItems.filter((item) => item.tone === "good");
  const scenarioLimitReached = (plan.scenarios || []).length >= featureTiers.pro.scenarioLimit;
  const counts = {
    good: diagnosisItems.filter((item) => item.tone === "good").length,
    check: diagnosisItems.filter((item) => item.tone === "check").length,
    notice: diagnosisItems.filter((item) => item.tone === "notice").length
  };

  const handleScenarioAction = (item: DiagnosisItem) => {
    if (!item.suggestedScenarioTag) return;
    const existingScenario = (plan.scenarios || []).find((scenario) => scenario.tag === item.suggestedScenarioTag);
    if (existingScenario) {
      setActiveView("scenarios");
      return;
    }

    const template = scenarioTemplates.find((candidate) => candidate.tag === item.suggestedScenarioTag);
    if (!template) return;
    if (!addScenario(template)) {
      setActionMessage(
        scenarioLimitReached
          ? `比較案は最大${featureTiers.pro.scenarioLimit}件です。不要な案を削除してから追加してください。`
          : "比較案を保存できませんでした。ブラウザの保存状態を確認してください。"
      );
      return;
    }
    setActiveView("scenarios");
  };

  const renderDiagnosisItem = (item: DiagnosisItem) => {
    const existingScenario = item.suggestedScenarioTag
      ? (plan.scenarios || []).some((scenario) => scenario.tag === item.suggestedScenarioTag)
      : false;
    return (
      <article className={`diagnosis-item ${item.tone}`} key={item.title}>
        <div className="diagnosis-item-copy">
          <span>{item.tone === "good" ? "確認済み" : item.tone === "notice" ? "注意して確認" : "見直し候補"}</span>
          <strong>{item.title}</strong>
          <small>{item.detail}</small>
        </div>
        <div className="diagnosis-item-actions">
          <button type="button" className="secondary" onClick={() => setActiveView(item.view)}>入力を確認</button>
          {item.suggestedScenarioTag ? (
            <button
              type="button"
              onClick={() => handleScenarioAction(item)}
              disabled={!existingScenario && scenarioLimitReached}
            >
              {existingScenario ? "比較案を確認" : "支出見直しの比較案を作る"}
            </button>
          ) : null}
        </div>
      </article>
    );
  };

  return (
    <div className="view-stack life-plan-diagnosis">
      <section className="pro-hero">
        <div>
          <p className="eyebrow">Pro予定 / ライフプラン診断</p>
          <h2>入力条件の確認ポイントを横断整理</h2>
          <p>家計、資産、目標、イベント、レビュー履歴をまとめて確認します。結果は助言ではなく、入力条件に基づく参考メモです。</p>
        </div>
        <span className="lock-badge">Coming soon</span>
      </section>

      <section className="calculation-band compact">
        <Metric label="確認済み" value={`${counts.good}件`} helper="整っている項目" />
        <Metric label="見直し候補" value={`${counts.check}件`} helper="確認するとよい項目" />
        <Metric label="注意して確認" value={`${counts.notice}件`} helper="入力条件上の不足や赤字" />
        <Metric label="診断項目" value={`${diagnosisItems.length}件`} helper="前提条件に基づく整理" />
      </section>

      <section className="panel">
        <h2>確認ポイント</h2>
        <p className="muted">見直し候補を先に確認し、必要な項目だけ入力や比較案へ進めます。</p>
        {actionMessage ? <p className="message" role="alert">{actionMessage}</p> : null}
        {scenarioLimitReached ? (
          <p className="message">比較案は最大{featureTiers.pro.scenarioLimit}件です。新しく作る場合は、シナリオ比較で不要な案を削除してください。</p>
        ) : null}
        <div className="section-heading diagnosis-section-heading">
          <div>
            <h3>今回の見直し候補</h3>
            <p>現在の入力条件から、確認が必要な項目をまとめています。</p>
          </div>
          <span className="status-pill recurring">{pendingItems.length}件</span>
        </div>
        <div className="diagnosis-list">
          {pendingItems.length > 0
            ? pendingItems.map(renderDiagnosisItem)
            : <p className="empty-inline">現在の入力条件では、優先して確認する項目はありません。</p>}
        </div>
        <details className="diagnosis-confirmed">
          <summary>確認済み {confirmedItems.length}件</summary>
          <div className="diagnosis-list">
            {confirmedItems.map(renderDiagnosisItem)}
          </div>
        </details>
      </section>
    </div>
  );
}
