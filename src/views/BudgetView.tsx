import { useMemo, useState, type FormEvent } from "react";
import { EmptyState, Metric, MoneyInput, OptionalMoneyInput, StepFlowNav, StepTitle } from "../components/CommonUi";
import { MAX_PLAN_YEAR } from "../config";
import { budgetCategoryLabels, budgetFrequencyLabels, monthLabels } from "../data/labels";
import type { BudgetCategory, BudgetFrequency, BudgetItem, BudgetItemDraft, LifePlan, ViewKey } from "../types";
import { getBudgetMonthlyAverage, getBudgetSummary, manYen } from "../utils/calculations";

type BudgetMode = "budget" | "actual" | "compare" | "history";

type CompositionRow = {
  category: BudgetCategory;
  amount: number;
};

const createBudgetDraft = (): BudgetItemDraft => ({
  name: "",
  category: "other",
  frequency: "monthlyVariable",
  budgetAmount: 0,
  memo: ""
});

function BudgetComposition({
  title,
  countText,
  note,
  rows,
  total,
  ariaLabel
}: {
  title: string;
  countText: string;
  note: string;
  rows: CompositionRow[];
  total: number;
  ariaLabel: string;
}) {
  if (rows.length === 0 || total <= 0) return null;

  return (
    <div className="budget-overview-panel" aria-label={ariaLabel}>
      <div className="budget-overview-head">
        <div>
          <strong>{title}</strong>
          <span>{countText}</span>
        </div>
        <small>{note}</small>
      </div>
      <div className="budget-composition-bar" aria-hidden="true">
        {rows.map((row) => (
          <span
            key={row.category}
            className={`budget-category-segment ${row.category}`}
            style={{ width: `${(row.amount / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="budget-composition-legend">
        {rows.map((row) => (
          <div key={row.category}>
            <span className={`budget-category-label ${row.category}`}><i />{budgetCategoryLabels[row.category]}</span>
            <strong>{manYen(row.amount)}</strong>
            <small>{Math.round((row.amount / total) * 100)}%</small>
          </div>
        ))}
      </div>
    </div>
  );
}

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
  addBudgetItem: (draft: BudgetItemDraft) => void;
  updateBudgetItem: <K extends keyof BudgetItem>(id: string, key: K, value: BudgetItem[K]) => void;
  updateBudgetActual: (id: string, monthKey: string, value: number | undefined) => void;
  removeBudgetItem: (id: string) => void;
  applyBudgetToHousehold: () => void;
  setActiveView: (view: ViewKey) => void;
}) {
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const defaultMonthKey = `${currentYear}-${String(currentDate.getMonth() + 1).padStart(2, "0")}`;
  const [monthKey, setMonthKey] = useState(defaultMonthKey);
  const [budgetMode, setBudgetMode] = useState<BudgetMode>("budget");
  const usesDetailedCashflow = plan.cashflowMode === "detailed";
  const [budgetSearch, setBudgetSearch] = useState("");
  const [budgetCategoryFilter, setBudgetCategoryFilter] = useState<BudgetCategory | "all">("all");
  const [budgetDraft, setBudgetDraft] = useState<BudgetItemDraft>(createBudgetDraft);
  const [budgetFormStatus, setBudgetFormStatus] = useState("");
  const budgetItems = plan.budgetItems || [];
  const summary = getBudgetSummary(budgetItems, monthKey);
  const visibleBudgetItems = useMemo(() => {
    const search = budgetSearch.trim().toLowerCase();
    return budgetItems.filter((item) =>
      (budgetCategoryFilter === "all" || item.category === budgetCategoryFilter) &&
      (!search || `${item.name} ${item.memo} ${budgetCategoryLabels[item.category]}`.toLowerCase().includes(search))
    );
  }, [budgetCategoryFilter, budgetItems, budgetSearch]);
  const budgetCompositionRows = useMemo(
    () => [...summary.categoryRows]
      .filter((row) => row.plannedMonthlyAverage > 0)
      .sort((a, b) => b.plannedMonthlyAverage - a.plannedMonthlyAverage)
      .map((row) => ({ category: row.category, amount: row.plannedMonthlyAverage })),
    [summary.categoryRows]
  );
  const actualCompositionRows = useMemo(
    () => [...summary.categoryRows]
      .filter((row) => row.actualEntryCount > 0 && row.actual > 0)
      .sort((a, b) => b.actual - a.actual)
      .map((row) => ({ category: row.category, amount: row.actual })),
    [summary.categoryRows]
  );
  const actualEntryCount = summary.actualEntryCount;
  const selectedYear = Number(monthKey.slice(0, 4));
  const selectedMonth = Number(monthKey.slice(5, 7));
  const selectableBudgetYears = useMemo(() => {
    const years = new Set<number>();
    const firstDefaultYear = Math.max(1900, currentYear - 10);
    const lastDefaultYear = Math.min(MAX_PLAN_YEAR, currentYear + 5);
    for (let year = firstDefaultYear; year <= lastDefaultYear; year += 1) years.add(year);
    years.add(selectedYear);
    budgetItems.forEach((item) => {
      Object.keys(item.actuals || {}).forEach((key) => {
        const year = Number(key.slice(0, 4));
        if (Number.isInteger(year) && year >= 1900 && year <= MAX_PLAN_YEAR) years.add(year);
      });
    });
    return [...years].sort((a, b) => a - b);
  }, [budgetItems, currentYear, selectedYear]);
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
  const comparisonChartMax = Math.max(
    1,
    ...summary.categoryRows.flatMap((row) => [row.plannedMonthlyAverage, row.actual])
  );
  const moveMonth = (offset: number) => {
    const [year, month] = monthKey.split("-").map(Number);
    const next = new Date(year, month - 1 + offset, 1);
    if (next.getFullYear() < 1900 || next.getFullYear() > MAX_PLAN_YEAR) return;
    setMonthKey(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
  };
  const selectYear = (year: number) => {
    setMonthKey(`${year}-${String(selectedMonth).padStart(2, "0")}`);
  };
  const selectMonth = (month: number) => {
    setMonthKey(`${selectedYear}-${String(month).padStart(2, "0")}`);
  };
  const moveYear = (offset: number) => {
    selectYear(Math.min(MAX_PLAN_YEAR, Math.max(1900, selectedYear + offset)));
  };

  const handleApplyBudget = () => {
    if (usesDetailedCashflow) return;
    if (window.confirm("予算・実績の年間換算をもとに、家計入力の固定費・変動費・年間特別支出を更新します。")) {
      applyBudgetToHousehold();
    }
  };

  const updateBudgetDraft = <K extends keyof BudgetItemDraft>(key: K, value: BudgetItemDraft[K]) => {
    setBudgetDraft((current) => ({ ...current, [key]: value }));
    setBudgetFormStatus("");
  };

  const handleBudgetSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = budgetDraft.name.trim();
    if (!name) return;
    addBudgetItem({ ...budgetDraft, name, memo: budgetDraft.memo.trim() });
    setBudgetDraft(createBudgetDraft());
    setBudgetFormStatus(`「${name}」を予算表に登録しました。`);
  };

  const handleRemoveBudgetItem = (item: BudgetItem) => {
    const displayName = item.name.trim() || "名称未設定の項目";
    const actualMonthCount = Object.keys(item.actuals || {}).length;
    const actualWarning = actualMonthCount > 0
      ? `\nこの項目に保存された${actualMonthCount}か月分の実績もすべて削除されます。`
      : "";
    const confirmed = window.confirm(
      `「${displayName}」を予算項目から削除しますか？${actualWarning}\nこの操作は元に戻せません。`
    );
    if (confirmed) removeBudgetItem(item.id);
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
          {budgetMode === "budget" ? (
            <button
              type="button"
              className="secondary"
              onClick={handleApplyBudget}
              disabled={usesDetailedCashflow}
              title={usesDetailedCashflow ? "詳細収支方式では、家計入力の詳細収支を編集してください。" : undefined}
            >
              家計入力に反映
            </button>
          ) : null}
        </div>
        {usesDetailedCashflow ? (
          <div className="notice-band check budget-detail-mode-note">
            <strong>世帯別の詳細収支を使用中です</strong>
            <span>予算は実績比較に使用します。将来見通しへ反映する金額は、家計入力の詳細収支で編集してください。</span>
          </div>
        ) : null}
        <div className="notice-band check">
          <strong>家計簿ではなく、ライフプランの前提を整えるための月次管理です</strong>
          <span>細かい日別入力は扱わず、カテゴリごとの月額予算・実績・差額をレビューとシミュレーションに使います。</span>
        </div>
        <div className="segmented-control budget-view-tabs" aria-label="予算と実績の表示切替">
          <button type="button" aria-pressed={budgetMode === "budget"} className={budgetMode === "budget" ? "active" : ""} onClick={() => setBudgetMode("budget")}>予算入力</button>
          <button type="button" aria-pressed={budgetMode === "actual"} className={budgetMode === "actual" ? "active" : ""} onClick={() => setBudgetMode("actual")}>実績入力</button>
          <button type="button" aria-pressed={budgetMode === "compare"} className={budgetMode === "compare" ? "active" : ""} onClick={() => setBudgetMode("compare")}>予算・実績比較</button>
          <button type="button" aria-pressed={budgetMode === "history"} className={budgetMode === "history" ? "active" : ""} onClick={() => setBudgetMode("history")}>年間推移</button>
        </div>

        {budgetMode !== "budget" ? (
          <div className="budget-toolbar">
            {budgetMode === "history" ? (
              <div className="calendar-year-navigation budget-year-navigation" aria-label="表示する年を変更">
                <button type="button" className="secondary" aria-label="前年を表示" disabled={selectedYear <= 1900} onClick={() => moveYear(-1)}>‹</button>
                <label>
                  表示年
                  <select aria-label="表示する年" value={selectedYear} onChange={(event) => selectYear(Number(event.target.value))}>
                    {selectableBudgetYears.map((year) => <option key={year} value={year}>{year}年</option>)}
                  </select>
                </label>
                <button type="button" className="secondary" aria-label="翌年を表示" disabled={selectedYear >= MAX_PLAN_YEAR} onClick={() => moveYear(1)}>›</button>
                <button type="button" className="secondary calendar-today-button" onClick={() => setMonthKey(defaultMonthKey)}>今年</button>
              </div>
            ) : (
              <>
                <div className="budget-period-selectors" aria-label="実績を確認する年月">
                  <label>
                    年
                    <select aria-label="実績を確認する年" value={selectedYear} onChange={(event) => selectYear(Number(event.target.value))}>
                      {selectableBudgetYears.map((year) => <option key={year} value={year}>{year}年</option>)}
                    </select>
                  </label>
                  <label>
                    月
                    <select aria-label="実績を確認する月" value={selectedMonth} onChange={(event) => selectMonth(Number(event.target.value))}>
                      {monthLabels.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
                    </select>
                  </label>
                </div>
                <div className="button-row compact-actions budget-month-actions">
                  <button type="button" className="secondary" disabled={selectedYear <= 1900 && selectedMonth <= 1} onClick={() => moveMonth(-1)}>前月</button>
                  <button type="button" className="secondary" onClick={() => setMonthKey(defaultMonthKey)}>今月</button>
                  <button type="button" className="secondary" disabled={selectedYear >= MAX_PLAN_YEAR && selectedMonth >= 12} onClick={() => moveMonth(1)}>翌月</button>
                </div>
              </>
            )}
            <span>
              {budgetMode === "history"
                ? `${selectedYear}年は${annualRecordedMonths}/12か月に実績入力があります。`
                : `${actualEntryCount}/${budgetItems.length}項目入力済み。実績は月ごとにブラウザ内へ保存されます。`}
            </span>
          </div>
        ) : null}

        {budgetMode === "budget" ? (
          <>
            <div className="calculation-band compact">
              <Metric label="月平均予算" value={manYen(summary.plannedMonthlyAverage)} helper="頻度を月平均に換算" />
              <Metric label="年間予算" value={manYen(summary.annualPlan)} helper="月次・年次を合算" />
              <Metric label="カテゴリ" value={`${budgetCompositionRows.length}件`} helper="構成比を自動集計" />
              <Metric label="登録済み項目" value={`${budgetItems.length}件`} helper="下の表で編集できます" />
            </div>
            <BudgetComposition
              title="月平均予算の全体像"
              countText={`${budgetCompositionRows.length}カテゴリ / ${budgetItems.length}項目`}
              note="現在の予算設定を月平均へ換算した構成です。"
              rows={budgetCompositionRows}
              total={summary.plannedMonthlyAverage}
              ariaLabel="カテゴリ別の月平均予算構成"
            />
          </>
        ) : null}

        {budgetMode === "actual" || budgetMode === "compare" ? (
          <div className="calculation-band compact">
            <Metric label="月平均予算" value={manYen(summary.plannedMonthlyAverage)} helper="現在の予算設定" />
            <Metric label="選択月の実績" value={summary.actualEntryCount > 0 ? manYen(summary.actual) : "未入力"} helper={monthKey} />
            <Metric
              label="月平均予算との差"
              value={allActualsEntered ? manYen(summary.variance) : summary.actualEntryCount > 0 ? "入力途中" : "-"}
              helper={allActualsEntered ? "実績 - 月平均換算予算" : "全項目の入力後に判定"}
            />
            <Metric label="入力状況" value={`${actualEntryCount}/${budgetItems.length}件`} helper={allActualsEntered ? "入力完了" : "未入力項目があります"} />
          </div>
        ) : null}

        {budgetMode === "actual" ? (
          actualCompositionRows.length > 0 ? (
            <BudgetComposition
              title={`${monthKey} 実績の全体像`}
              countText={`${actualEntryCount}/${budgetItems.length}項目入力済み`}
              note={allActualsEntered ? "入力済み実績のカテゴリ構成です。" : "入力途中の実績だけで集計しています。"}
              rows={actualCompositionRows}
              total={summary.actual}
              ariaLabel={`${monthKey}のカテゴリ別実績構成`}
            />
          ) : actualEntryCount > 0 ? (
            <div className="notice-band check budget-zero-actual-note">
              <strong>入力済みの実績はすべて0円です</strong>
              <span>0円は入力済みとして扱い、構成比は表示しません。</span>
            </div>
          ) : null
        ) : null}
      </section>

      {budgetMode === "budget" ? (
        <section className="panel">
          <form className="entry-creation-form" data-testid="budget-create-form" onSubmit={handleBudgetSubmit}>
            <div className="entry-creation-heading">
              <div>
                <h2>予算項目を登録</h2>
                <p>項目と予算の詳細を入力して登録すると、下の予算表へ追加されます。</p>
              </div>
              <span>必須: 項目名</span>
            </div>
            <div className="entry-creation-grid budget-entry-grid">
              <label className="entry-field-wide">
                項目名
                <input
                  required
                  value={budgetDraft.name}
                  onChange={(event) => updateBudgetDraft("name", event.target.value)}
                  placeholder="例: 食費"
                />
              </label>
              <label>
                カテゴリ
                <select value={budgetDraft.category} onChange={(event) => updateBudgetDraft("category", event.target.value as BudgetCategory)}>
                  {Object.entries(budgetCategoryLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label>
                頻度
                <select value={budgetDraft.frequency} onChange={(event) => updateBudgetDraft("frequency", event.target.value as BudgetFrequency)}>
                  {Object.entries(budgetFrequencyLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <div className="entry-control-field">
                <MoneyInput label="予算額" value={budgetDraft.budgetAmount} onChange={(value) => updateBudgetDraft("budgetAmount", value)} />
              </div>
              <label className="entry-field-wide">
                メモ
                <input
                  value={budgetDraft.memo}
                  onChange={(event) => updateBudgetDraft("memo", event.target.value)}
                  placeholder="予算に含める内容や前提"
                />
              </label>
            </div>
            <div className="entry-form-actions">
              <span role="status" aria-live="polite">{budgetFormStatus}</span>
              <button type="submit">予算項目を登録</button>
            </div>
          </form>

          <div className="registered-list-heading">
            <div>
              <h2>登録済みの予算項目</h2>
              <p>登録後も表から項目名、分類、金額、メモを編集できます。</p>
            </div>
            <span>{budgetItems.length}件</span>
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
            <EmptyState title="予算項目はまだありません" detail="上のフォームから、月次レビューで見たい単位の項目を登録します。" />
          ) : visibleBudgetItems.length === 0 ? (
            <EmptyState title="条件に合う項目がありません" detail="検索文字やカテゴリを変えてください。" />
          ) : (
            <div className="budget-list budget-scalable-list" tabIndex={0} aria-label="登録済み予算項目表">
              {visibleBudgetItems.map((item) => (
                <div className="budget-row" data-testid="budget-item-row" key={item.id}>
                  <label>
                    項目名
                    <input value={item.name} onChange={(event) => updateBudgetItem(item.id, "name", event.target.value)} />
                  </label>
                  <label>
                    カテゴリ
                    <select value={item.category} onChange={(event) => updateBudgetItem(item.id, "category", event.target.value as BudgetCategory)}>
                      {Object.entries(budgetCategoryLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    頻度
                    <select value={item.frequency} onChange={(event) => updateBudgetItem(item.id, "frequency", event.target.value as BudgetFrequency)}>
                      {Object.entries(budgetFrequencyLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
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
                  <button
                    type="button"
                    className="text-button"
                    aria-label={`「${item.name.trim() || "名称未設定の項目"}」を削除`}
                    onClick={() => handleRemoveBudgetItem(item)}
                  >
                    削除
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {budgetMode === "actual" ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>{monthKey}の実績入力</h2>
              <p>予算設定とは分けて、その月に実際に使った合計額だけを入力します。空欄へ戻すと未入力になります。</p>
            </div>
            <span className="status-pill recurring">{actualEntryCount}/{budgetItems.length}項目</span>
          </div>
          <div className="list-toolbar budget-item-toolbar" aria-label="実績入力項目の検索と絞り込み">
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
            <EmptyState title="先に予算項目を登録してください" detail="予算入力タブで、毎月振り返りたい項目を登録します。" />
          ) : visibleBudgetItems.length === 0 ? (
            <EmptyState title="条件に合う項目がありません" detail="検索文字やカテゴリを変えて確認してください。" />
          ) : (
            <div className="monthly-actual-list budget-scalable-list" tabIndex={0} aria-label="月末実績の入力項目一覧">
              {visibleBudgetItems.map((item) => {
                const monthlyBudget = getBudgetMonthlyAverage(item);
                const hasActual = Object.prototype.hasOwnProperty.call(item.actuals || {}, monthKey);
                const actual = hasActual ? item.actuals[monthKey] : undefined;
                return (
                  <div className="monthly-actual-row" key={item.id}>
                    <div>
                      <strong><span className={`budget-category-marker ${item.category}`} />{item.name}</strong>
                      <small>{budgetCategoryLabels[item.category]} / 月平均予算 {manYen(monthlyBudget)}</small>
                    </div>
                    <OptionalMoneyInput
                      key={`${item.id}-${monthKey}`}
                      label="実際に使った額"
                      value={actual}
                      onChange={(value) => updateBudgetActual(item.id, monthKey, value)}
                    />
                    <div className={`actual-variance ${hasActual && (actual ?? 0) > monthlyBudget ? "over" : "within"}`}>
                      <span>月平均予算との差</span>
                      <strong>{hasActual ? manYen((actual ?? 0) - monthlyBudget) : "未入力"}</strong>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {budgetMode === "compare" ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>{monthKey}の予算・実績比較</h2>
              <p>カテゴリごとに、現在の月平均予算と選択月の実績を並べて確認します。</p>
            </div>
            <span className="status-pill recurring">{summary.actualEntryCount}/{budgetItems.length}項目入力済み</span>
          </div>
          {summary.categoryRows.length === 0 ? (
            <EmptyState title="まだ予算項目がありません" detail="予算入力タブで項目を登録すると、カテゴリ別の差額を確認できます。" />
          ) : (
            <>
              <div className="budget-comparison-chart" aria-label={`${monthKey}のカテゴリ別予算実績グラフ`}>
                <div className="budget-chart-legend">
                  <span><i className="planned" />月平均予算</span>
                  <span><i className="actual" />実績</span>
                </div>
                {summary.categoryRows.map((row) => (
                  <div className="budget-comparison-row" key={row.category}>
                    <span className={`budget-category-label ${row.category}`}><i />{budgetCategoryLabels[row.category]}</span>
                    <div className="budget-bar-pair" aria-hidden="true">
                      <span
                        className="budget-bar planned"
                        style={{ width: `${row.plannedMonthlyAverage > 0 ? Math.max(1, (row.plannedMonthlyAverage / comparisonChartMax) * 100) : 0}%` }}
                      />
                      <span
                        className="budget-bar actual"
                        style={{ width: `${row.actualEntryCount > 0 ? Math.max(1, (row.actual / comparisonChartMax) * 100) : 0}%` }}
                      />
                    </div>
                    <small>
                      {manYen(row.plannedMonthlyAverage)} / {row.actualEntryCount > 0 ? manYen(row.actual) : "未入力"}
                    </small>
                  </div>
                ))}
              </div>
              <p className="budget-comparison-note">
                差額は「実績 − 現在の月平均換算予算」です。不定期・年1回の予算も年額を12ヶ月で割って比較します。
              </p>
              <div className="table-wrap budget-scalable-table budget-comparison-table" tabIndex={0} aria-label="カテゴリ別予算実績比較表">
                <table>
                  <thead>
                    <tr>
                      <th>カテゴリ</th>
                      <th>月平均予算</th>
                      <th>選択月実績</th>
                      <th>差額（実績 − 予算）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.categoryRows.map((row) => {
                      const categoryComplete = row.actualEntryCount === row.itemCount;
                      return (
                        <tr key={row.category}>
                          <td data-label="カテゴリ"><span className={`budget-category-label ${row.category}`}><i />{budgetCategoryLabels[row.category]}</span></td>
                          <td data-label="月平均予算">{manYen(row.plannedMonthlyAverage)}</td>
                          <td data-label="選択月実績">{row.actualEntryCount > 0 ? manYen(row.actual) : "未入力"}</td>
                          <td
                            data-label="差額（実績 − 予算）"
                            className={categoryComplete && row.variance > 0 ? "budget-over-cell" : categoryComplete ? "budget-within-cell" : ""}
                          >
                            {categoryComplete ? `${manYen(row.variance)} / ${row.variance > 0 ? "超過" : "予算内"}` : row.actualEntryCount > 0 ? "入力途中" : "-"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      ) : null}

      {budgetMode === "history" && (
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>{selectedYear}年の予算・実績推移</h2>
            <p>現在の月平均予算と各月の実績を並べ、年間の傾向を振り返ります。</p>
          </div>
          <span className="status-pill recurring">{annualRecordedMonths}/12か月に実績入力あり</span>
        </div>
        {budgetItems.length === 0 ? (
          <EmptyState title="予算項目はまだありません" detail="予算入力タブで項目を登録すると、年間推移を確認できます。" />
        ) : (
          <>
            <div className="budget-annual-summary">
              <Metric label="年間予算" value={manYen(summary.annualPlan)} helper="現在の予算設定" />
              <Metric label="入力済み実績" value={manYen(annualActual)} helper={`${annualRecordedMonths}か月に入力あり`} />
              <Metric label="実績入力月の平均" value={annualRecordedMonths > 0 ? manYen(annualActual / annualRecordedMonths) : "未入力"} helper="実績が1件以上ある月で計算" />
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
            <p className="budget-comparison-note">
              過去月の予算は現在の予算設定を月平均換算して表示します。予算を変更すると、過去月との比較値も更新されます。
            </p>
            <div className="table-wrap budget-history-table budget-scalable-table" tabIndex={0} aria-label="年間予算実績履歴表">
              <table>
                <thead><tr><th>月</th><th>現在の月平均予算</th><th>実績</th><th>差額</th><th>入力状況</th></tr></thead>
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
          <strong>レビューセンターとの連携</strong>
          <span>選択月の実績と現在の月平均予算との差は、月次レビュー時の見直しポイントとして使えます。</span>
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
