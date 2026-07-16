import { Metric } from "../components/CommonUi";
import type { LifePlan, ViewKey } from "../types";
import { getLifePlanDiagnosis } from "../utils/diagnosis";

export function LifePlanDiagnosisView({ plan, setActiveView }: { plan: LifePlan; setActiveView: (view: ViewKey) => void }) {
  const diagnosisItems = getLifePlanDiagnosis(plan);
  const counts = {
    good: diagnosisItems.filter((item) => item.tone === "good").length,
    check: diagnosisItems.filter((item) => item.tone === "check").length,
    notice: diagnosisItems.filter((item) => item.tone === "notice").length
  };

  return (
    <div className="view-stack">
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
        <div className="diagnosis-list">
          {diagnosisItems.map((item) => (
            <button type="button" className={`diagnosis-item ${item.tone}`} key={item.title} onClick={() => setActiveView(item.view)}>
              <div>
                <span>{item.tone === "good" ? "確認済み" : item.tone === "notice" ? "注意して確認" : "見直し候補"}</span>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </div>
              <span>開く</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
