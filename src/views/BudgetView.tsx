import { useMemo, useState } from "react";
import { EmptyState, Metric, MoneyInput, StepFlowNav, StepTitle } from "../components/CommonUi";
import { budgetCategoryLabels, budgetFrequencyLabels, monthLabels } from "../data/labels";
import type { BudgetCategory, BudgetFrequency, BudgetItem, LifePlan, ViewKey } from "../types";
import { getBudgetMonthlyAverage, getBudgetSummary, manYen } from "../utils/calculations";

export function BudgetView({
  plan,
  addBudgetItem,
  updateBudgetItem,
  updateBudgetActual,
  removeBudgetItem,
  applyBudgetToHousehold,
  setActiveView
}: {
  plan: LifePlan;
  addBudgetItem: () => void;
  updateBudgetItem: <K extends keyof BudgetItem>(id: string, key: K, value: BudgetItem[K]) => void;
  updateBudgetActual: (id: string, monthKey: string, value: number) => void;
  removeBudgetItem: (id: string) => void;
  applyBudgetToHousehold: () => void;
  setActiveView: (view: ViewKey) => void;
}) {
  const currentDate = new Date();
  const defaultMonthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}`;
  const [monthKey, setMonthKey] = useState(defaultMonthKey);
  const [budgetMode, setBudgetMode] = useState<"input" | "compare" | "history">("input");
  const [budgetSearch, setBudgetSearch] = useState("");
  const [budgetCategoryFilter, setBudgetCategoryFilter] = useState<BudgetCategory | "all">("all");
  const budgetItems = plan.budgetItems || [];
  const summary = getBudgetSummary(budgetItems, monthKey);
  const visibleBudgetItems = useMemo(() => {
    const search = budgetSearch.trim().toLowerCase();
    return budgetItems.filter((item) =>
      (budgetCategoryFilter === "all" || item.category === budgetCategoryFilter) &&
      (!search || `${item.name} ${item.memo} ${budgetCategoryLabels[item.category]}`.toLowerCase().includes(search))
    );
  }, [budgetCategoryFilter, budgetItems, budgetSearch]);
  const compositionRows = useMemo(
    () => [...summary.categoryRows]
      .filter((row) => row.plannedMonthlyAverage > 0)
      .sort((a, b) => b.plannedMonthlyAverage - a.plannedMonthlyAverage),
    [summary.categoryRows]
  );
  const actualEntryCount = budgetItems.filter((item) => Object.prototype.hasOwnProperty.call(item.actuals || {}, monthKey)).length;
  const selectedYear = Number(monthKey.slice(0, 4));
  const annualRows = useMemo(
    () => monthLabels.map((label, index) => {
      const rowMonthKey = `${selectedYear}-${String(index + 1).padStart(2, "0")}`;
      const rowSummary = getBudgetSummary(budgetItems, rowMonthKey);
      return {
        label,
        monthKey: rowMonthKey,
        planned: rowSummary.plannedMonthlyAverage,
        actual: rowSummary.actual,
        variance: rowSummary.variance,
        actualEntryCount: rowSummary.actualEntryCount
      };
    }),
    [budgetItems, selectedYear]
  );
  const annualActual = annualRows.reduce((total, row) => total + row.actual, 0);
  const annualRecordedMonths = annualRows.filter((row) => row.actualEntryCount > 0).length;
  const allActualsEntered = budgetItems.length > 0 && summary.actualEntryCount === budgetItems.length;
  const annualChartMax = Math.max(1, ...annualRows.flatMap((row) => [row.planned, row.actual]));
  const moveMonth = (offset: number) => {
    const [year, month] = monthKey.split("-").map(Number);
    const next = new Date(year, month - 1 + offset, 1);
    setMonthKey(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
  };

  const handleApplyBudget = () => {
    if (window.confirm("予算・実績の年間換算をもとに、家計入力の固定費・変動費・年間特別支出を更新します。")) {
      applyBudgetToHousehold();
    }
  };

  return (
    <div className="view-stack">
      <section className="panel">
        <div className="section-heading">
          <StepTitle
            step="4"
            title="予算・実績プラン"
            description="予算を決め、月末にカテゴリごとの大まかな実績を記録します。"
          />
          <div className="button-row">
            <button type="button" className="secondary" onClick={handleApplyBudget}>
              家計入力に反映
            </button>
            <button type="button" onClick={addBudgetItem}>
              項目を追加
            </button>
          </div>
        </div>
        <div className="notice-band check">
          <strong>家計簿ではなく、ライフプランの前提を整えるための月次管理です</strong>
          <span>細かい日別入力は扱わず、カテゴリごとの月額予算・実績・差額をレビューとシミュレーションに使います。</span>
        </div>
        <div className="segmented-control budget-view-tabs" aria-label="予算と実績の表示切替">
          <button type="button" className={budgetMode === "input" ? "active" : ""} onClick={() => setBudgetMode("input")}>入力</button>
          <button type="button" className={budgetMode === "compare" ? "active" : ""} onClick={() => setBudgetMode("compare")}>月別比較</button>
          <button type="button" className={budgetMode === "history" ? "active" : ""} onClick={() => setBudgetMode("history")}>年間推移</button>
        </div>
        <div className="budget-toolbar">
          <label>
            実績を入力する月
            <input type="month" value={monthKey} onChange={(event) => setMonthKey(event.target.value || defaultMonthKey)} />
          </label>
          <div className="button-row compact-actions">
            <button type="button" className="secondary" onClick={() => moveMonth(-1)}>前月</button>
            <button type="button" className="secondary" onClick={() => setMonthKey(defaultMonthKey)}>今月</button>
            <button type="button" className="secondary" onClick={() => moveMonth(1)}>翌月</button>
          </div>
          <span>{actualEntryCount}/{budgetItems.length}項目入力済み。実績は月ごとにブラウザ内へ保存されます。</span>
        </div>
        <div className="calculation-band compact">
          <Metric label="月平均予算" value={manYen(summary.plannedMonthlyAverage)} helper="頻度を月平均に換算" />
          <Metric label="選択月の実績" value={summary.actualEntryCount > 0 ? manYen(summary.actual) : "未入力"} helper={monthKey} />
          <Metric
            label="予算との差"
            value={allActualsEntered ? manYen(summary.variance) : summary.actualEntryCount > 0 ? "入力途中" : "-"}
            helper={allActualsEntered ? "実績 - 月平均予算" : "全項目の入力後に判定"}
          />
          <Metric label="年間予算" value={manYen(summary.annualPlan)} helper="月次/年次を合算" />
        </div>
        {compositionRows.length > 0 && (
          <div className="budget-overview-panel" aria-label="カテゴリ別の月平均予算構成">
            <div className="budget-overview-head">
              <div>
                <strong>月平均予算の全体像</strong>
                <span>{compositionRows.length}カテゴリ / {budgetItems.length}項目</span>
              </div>
              <small>カテゴリを増やしても構成比と金額を自動集計します。</small>
            </div>
            <div className="budget-composition-bar" aria-hidden="true">
              {compositionRows.map((row) => (
                <span
                  key={row.category}
                  className={`budget-category-segment ${row.category}`}
                  style={{ width: `${(row.plannedMonthlyAverage / Math.max(1, summary.plannedMonthlyAverage)) * 100}%` }}
                />
              ))}
            </div>
            <div className="budget-composition-legend">
              {compositionRows.map((row) => (
                <div key={row.category}>
                  <span className={`budget-category-label ${row.category}`}><i />{budgetCategoryLabels[row.category]}</span>
                  <strong>{manYen(row.plannedMonthlyAverage)}</strong>
                  <small>{Math.round((row.plannedMonthlyAverage / Math.max(1, summary.plannedMonthlyAverage)) * 100)}%</small>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {budgetMode === "input" && (
      <>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>月末の実績入力</h2>
            <p>レシート単位ではなく、食費や住居費などの大まかな項目ごとに、その月に実際に使った合計額を入力します。</p>
          </div>
          <span className="status-pill recurring">{monthKey}</span>
        </div>
        <div className="list-toolbar budget-item-toolbar" aria-label="予算項目の検索と絞り込み">
          <label>
            項目を検索
            <input value={budgetSearch} onChange={(event) => setBudgetSearch(event.target.value)} placeholder="項目名、カテゴリ、メモ" />
          </label>
          <label>
            カテゴリ
            <select value={budgetCategoryFilter} onChange={(event) => setBudgetCategoryFilter(event.target.value as BudgetCategory | "all")}>
              <option value="all">すべて</option>
              {Object.entries(budgetCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <span>{visibleBudgetItems.length}件表示 / 全{budgetItems.length}件</span>
        </div>
        {budgetItems.length === 0 ? (
          <EmptyState title="先に予算項目を追加してください" detail="食費、住居費、通信費など、毎月振り返りたい単位だけで構いません。" />
        ) : visibleBudgetItems.length === 0 ? (
          <EmptyState title="条件に合う項目がありません" detail="検索文字やカテゴリを変えて確認してください。" />
        ) : (
          <div className="monthly-actual-list budget-scalable-list" tabIndex={0} aria-label="月末実績の入力項目一覧">
            {visibleBudgetItems.map((item) => {
              const monthlyBudget = getBudgetMonthlyAverage(item);
              const hasActual = Object.prototype.hasOwnProperty.call(item.actuals || {}, monthKey);
              const actual = item.actuals?.[monthKey] ?? 0;
              return (
                <div className="monthly-actual-row" key={item.id}>
                  <div>
                    <strong><span className={`budget-category-marker ${item.category}`} />{item.name}</strong>
                    <small>{budgetCategoryLabels[item.category]} / 月平均予算 {manYen(monthlyBudget)}</small>
                  </div>
                  <MoneyInput
                    label="実際に使った額"
                    value={actual}
                    onChange={(value) => updateBudgetActual(item.id, monthKey, value)}
                  />
                  <div className={`actual-variance ${hasActual && actual > monthlyBudget ? "over" : "within"}`}>
                    <span>予算との差</span>
                    <strong>{hasActual ? manYen(actual - monthlyBudget) : "未入力"}</strong>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div><h2>予算項目</h2><p>上の検索・カテゴリ絞り込みは、この編集一覧にも反映されます。</p></div>
          <span className="status-chip">{visibleBudgetItems.length}/{budgetItems.length}件</span>
        </div>
        {budgetItems.length === 0 ? (
          <EmptyState title="予算項目はまだありません" detail="食費、住居費、通信費、旅行など、月次レビューで見たい単位で追加します。" />
        ) : visibleBudgetItems.length === 0 ? (
          <EmptyState title="条件に合う項目がありません" detail="上の検索文字やカテゴリを変えてください。" />
        ) : (
          <div className="budget-list budget-scalable-list" tabIndex={0} aria-label="予算項目の編集一覧">
            {visibleBudgetItems.map((item) => (
              <div className="budget-row" key={item.id}>
                <label>
                  項目名
                  <input value={item.name} onChange={(event) => updateBudgetItem(item.id, "name", event.target.value)} />
                </label>
                <label>
                  カテゴリ
                  <select value={item.category} onChange={(event) => updateBudgetItem(item.id, "category", event.target.value as BudgetCategory)}>
                    {Object.entries(budgetCategoryLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  頻度
                  <select value={item.frequency} onChange={(event) => updateBudgetItem(item.id, "frequency", event.target.value as BudgetFrequency)}>
                    {Object.entries(budgetFrequencyLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <MoneyInput label="予算額" value={item.budgetAmount} onChange={(value) => updateBudgetItem(item.id, "budgetAmount", value)} />
                <div className="fixed-cost-impact-cell">
                  <span>月平均</span>
                  <strong>{manYen(getBudgetMonthlyAverage(item))}</strong>
                </div>
                <label>
                  メモ
                  <input value={item.memo} onChange={(event) => updateBudgetItem(item.id, "memo", event.target.value)} />
                </label>
                <button type="button" className="text-button" onClick={() => removeBudgetItem(item.id)}>
                  削除
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      </>
      )}

      {budgetMode === "compare" && (
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>{monthKey}のカテゴリ別比較</h2>
            <p>カテゴリごとに月平均予算と実績を比べます。色と名称を併記し、超過状況を確認できます。</p>
          </div>
          <span className="status-pill recurring">{summary.actualEntryCount}/{budgetItems.length}項目入力済み</span>
        </div>
        {summary.categoryRows.length === 0 ? (
          <EmptyState title="まだ予算項目がありません" detail="項目を追加すると、カテゴリ別の月平均予算と実績差額を確認できます。" />
        ) : (
          <div className="table-wrap budget-scalable-table" tabIndex={0} aria-label="カテゴリ別予算実績比較表">
            <table>
              <thead>
                <tr>
                  <th>カテゴリ</th>
                  <th>月平均予算</th>
                  <th>選択月実績</th>
                  <th>差額</th>
                </tr>
              </thead>
              <tbody>
                {summary.categoryRows.map((row) => {
                  const categoryComplete = row.actualEntryCount === row.itemCount;
                  return (
                  <tr key={row.category}>
                    <td><span className={`budget-category-label ${row.category}`}><i />{budgetCategoryLabels[row.category]}</span></td>
                    <td>{manYen(row.plannedMonthlyAverage)}</td>
                    <td>{row.actualEntryCount > 0 ? manYen(row.actual) : "未入力"}</td>
                    <td className={categoryComplete && row.variance > 0 ? "budget-over-cell" : categoryComplete ? "budget-within-cell" : ""}>
                      {categoryComplete ? `${manYen(row.variance)} / ${row.variance > 0 ? "超過" : "予算内"}` : row.actualEntryCount > 0 ? "入力途中" : "-"}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      )}

      {budgetMode === "history" && (
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>{selectedYear}年の予算・実績推移</h2>
            <p>月ごとの予算と実績を並べ、後から年間の傾向を振り返ります。</p>
          </div>
          <span className="status-pill recurring">{annualRecordedMonths}/12ヶ月入力済み</span>
        </div>
        {budgetItems.length === 0 ? (
          <EmptyState title="予算項目はまだありません" detail="入力タブで予算項目を追加すると、年間推移を確認できます。" />
        ) : (
          <>
            <div className="budget-annual-summary">
              <Metric label="年間予算" value={manYen(summary.annualPlan)} helper="現在の予算設定" />
              <Metric label="入力済み実績" value={manYen(annualActual)} helper={`${annualRecordedMonths}ヶ月分`} />
              <Metric label="入力済み月の平均" value={annualRecordedMonths > 0 ? manYen(annualActual / annualRecordedMonths) : "未入力"} helper="実績入力済み月で計算" />
            </div>
            <div className="budget-year-chart" aria-label={`${selectedYear}年の予算と実績の棒グラフ`}>
              <div className="budget-chart-legend"><span><i className="planned" />予算</span><span><i className="actual" />実績</span></div>
              {annualRows.map((row) => (
                <div className="budget-year-bar-row" key={row.monthKey}>
                  <strong>{row.label}</strong>
                  <div className="budget-bar-pair">
                    <span className="budget-bar planned" style={{ width: `${Math.max(1, (row.planned / annualChartMax) * 100)}%` }} />
                    <span className="budget-bar actual" style={{ width: `${row.actualEntryCount > 0 ? Math.max(1, (row.actual / annualChartMax) * 100) : 0}%` }} />
                  </div>
                  <small>{row.actualEntryCount > 0 ? manYen(row.actual) : "未入力"}</small>
                </div>
              ))}
            </div>
            <div className="table-wrap budget-history-table budget-scalable-table" tabIndex={0} aria-label="年間予算実績履歴表">
              <table>
                <thead><tr><th>月</th><th>月平均予算</th><th>実績</th><th>差額</th><th>入力状況</th></tr></thead>
                <tbody>
                  {annualRows.map((row) => (
                    <tr key={row.monthKey}>
                      <td>{row.label}</td>
                      <td>{manYen(row.planned)}</td>
                      <td>{row.actualEntryCount > 0 ? manYen(row.actual) : "未入力"}</td>
                      <td className={row.actualEntryCount === budgetItems.length && row.variance > 0 ? "budget-over-cell" : row.actualEntryCount === budgetItems.length ? "budget-within-cell" : ""}>
                        {row.actualEntryCount === budgetItems.length ? manYen(row.variance) : row.actualEntryCount > 0 ? "入力途中" : "-"}
                      </td>
                      <td>{row.actualEntryCount}/{budgetItems.length}項目</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
      )}

      <section className="helper-grid">
        <div>
          <strong>家計入力への反映</strong>
          <span>毎月・固定は固定費、毎月・変動は変動費、不定期・年1回は年間特別支出として反映します。1回だけの支出は年表イベントで管理するのが基本です。</span>
        </div>
        <div>
          <strong>レビュー履歴との関係</strong>
          <span>選択月の予算差額は、月次レビュー時に見直しポイントとして使えます。</span>
        </div>
        <div>
          <strong>使いすぎない設計</strong>
          <span>日別明細や店舗別分析は扱わず、ライフプランの前提を整える粒度に絞ります。</span>
        </div>
      </section>

      <StepFlowNav
        setActiveView={setActiveView}
        previous={{ view: "household", label: "家計入力" }}
        next={{ view: "goals", label: "目標管理" }}
      />
    </div>
  );
}
