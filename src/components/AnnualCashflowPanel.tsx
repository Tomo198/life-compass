import { useMemo, useState } from "react";
import type { LifePlan } from "../types";
import {
  getCashflowStressYears,
  type AnnualProjectionRow
} from "../utils/calculations";
import { AnnualCashflowTable } from "./AnnualCashflowTable";
import { AnnualCashflowChart } from "./Charts";

export function AnnualCashflowPanel({
  plan,
  annualRows,
  projectionYears,
  onProjectionYearsChange
}: {
  plan: LifePlan;
  annualRows: AnnualProjectionRow[];
  projectionYears: 10 | 30;
  onProjectionYearsChange: (years: 10 | 30) => void;
}) {
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const rows = annualRows.slice(1);
  const stressYears = useMemo(
    () => getCashflowStressYears(plan, annualRows),
    [annualRows, plan]
  );

  return (
    <section className="panel annual-cashflow-panel">
      <div className="section-heading">
        <div>
          <h2>年次キャッシュフロー</h2>
          <p>世帯年齢、収入、支出、イベント、資産見通しを12か月ごとに確認します。</p>
        </div>
        <div className="segmented-control" aria-label="年次キャッシュフローの表示期間">
          <button
            type="button"
            className={projectionYears === 10 ? "active" : ""}
            onClick={() => onProjectionYearsChange(10)}
          >
            10年
          </button>
          <button
            type="button"
            className={projectionYears === 30 ? "active" : ""}
            onClick={() => onProjectionYearsChange(30)}
          >
            30年
          </button>
        </div>
      </div>

      <div className="notice-band check annual-cashflow-guide">
        <strong>グラフと表は同じ年を表示します</strong>
        <span>棒または山場の年を選ぶと、その年の収入・支出・残高が表示され、詳細表の同じ年も開きます。</span>
      </div>

      <AnnualCashflowChart
        rows={rows}
        selectedYear={selectedYear}
        onSelectYear={setSelectedYear}
      />

      <section className="cashflow-stress-summary" aria-label="家計の山場">
        <div className="section-heading">
          <div>
            <h3>家計の山場</h3>
            <p>年間収支、生活防衛資金、大きな支出イベントが重なる年を整理します。</p>
          </div>
        </div>
        {stressYears.length > 0 ? (
          <div className="cashflow-stress-list">
            {stressYears.map((item) => (
              <button
                type="button"
                className={`cashflow-stress-item${selectedYear === item.year ? " active" : ""}`}
                key={item.year}
                onClick={() => setSelectedYear(item.year)}
              >
                <strong>{item.year}年 / {item.age}歳</strong>
                <span>{item.reasons.join("。")}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="notice-band good">
            <strong>大きな山場は見つかりませんでした</strong>
            <span>現在の入力条件で、年間赤字や生活防衛資金の不足につながる年は表示期間内に見つかりませんでした。</span>
          </div>
        )}
      </section>

      <details className="projection-details">
        <summary>世帯年齢と年次キャッシュフローの内訳を確認</summary>
        <p className="projection-detail-intro">
          各行は現在から12か月ごとの区間です。行を選ぶと、世帯年齢、収入・支出、残高、イベントの内訳を確認できます。
        </p>
        <AnnualCashflowTable
          rows={rows}
          selectedYear={selectedYear}
          onSelectYear={setSelectedYear}
        />
      </details>

      <div className="notice-band check annual-cashflow-assumption">
        <strong>この表の計算前提</strong>
        <span>家計入力と時期別収支、ライフイベント、資産入力、家計余剰の振り分けを同じ基本見通しに反映しています。表示結果は入力条件に基づく参考試算です。</span>
      </div>
    </section>
  );
}
