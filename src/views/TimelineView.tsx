import { useMemo, useState } from "react";
import { EmptyState, StepFlowNav, StepTitle } from "../components/CommonUi";
import { cashflowLabels, eventOwnerLabels, monthLabels } from "../data/labels";
import type { EventOwner, LifePlan, ViewKey } from "../types";
import {
  getGoalPreparedPercent,
  getRecurrenceLabel,
  getTargetAgeForYear,
  manYen
} from "../utils/calculations";

type CalendarEntry = {
  id: string;
  year: number;
  month: number;
  title: string;
  owner: EventOwner | "goal";
  kind: "goal" | "event" | "memo";
  detail: string;
  amount?: number;
  tone: "goal" | "expense" | "income" | "neutral" | "memo";
  progress?: number;
};

const getYearsUntilLabel = (year: number) => {
  const diff = year - new Date().getFullYear();
  if (diff < 0) return `${Math.abs(diff)}年前`;
  if (diff === 0) return "今年";
  return `あと約${diff}年`;
};

function LifeCalendar({ plan }: { plan: LifePlan }) {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [entrySearch, setEntrySearch] = useState("");
  const [entryKind, setEntryKind] = useState<"all" | "goal" | "event" | "memo">("all");
  const [entryOwner, setEntryOwner] = useState<EventOwner | "all">("all");
  const [entrySort, setEntrySort] = useState<"yearAsc" | "yearDesc" | "title">("yearAsc");
  const currentYear = new Date().getFullYear();
  const entries = useMemo<CalendarEntry[]>(() => {
    const goalEntries = plan.goals.map((goal) => {
      const preparedPercent = getGoalPreparedPercent(goal);
      return {
        id: `goal-${goal.id}`,
        year: goal.dueYear,
        month: goal.dueMonth,
        title: goal.title,
        owner: "goal" as const,
        kind: "goal" as const,
        detail:
          goal.goalType === "recurring"
            ? `${getRecurrenceLabel(goal.recurrence)} / 年間準備率 ${preparedPercent}%`
            : `達成率 ${preparedPercent}% / 残り ${manYen(Math.max(0, goal.requiredAmount - goal.savedAmount))}`,
        amount: goal.requiredAmount,
        tone: "goal" as const,
        progress: preparedPercent
      };
    });

    const eventEntries = plan.events.map((event) => ({
      id: `event-${event.id}`,
      year: event.year,
      month: event.month,
      title: event.title,
      owner: event.owner || "household",
      kind: "event" as const,
      detail: `${eventOwnerLabels[event.owner || "household"]} / ${cashflowLabels[event.cashflowType]}`,
      amount: event.amount,
      tone: event.cashflowType
    }));

    const memoEntries = (plan.timelineMemos || [])
      .filter((memo) => memo.showOnTimeline)
      .map((memo) => ({
        id: `memo-${memo.id}`,
        year: memo.year,
        month: memo.month,
        title: memo.title,
        owner: memo.owner,
        kind: "memo" as const,
        detail: `${eventOwnerLabels[memo.owner]} / ${memo.memo || "予定メモ"}`,
        tone: "memo" as const
      }));

    return [...goalEntries, ...eventEntries, ...memoEntries].sort((a, b) => a.year - b.year || a.month - b.month || a.title.localeCompare(b.title, "ja"));
  }, [plan.events, plan.goals, plan.timelineMemos]);
  const visibleEntries = useMemo(() => {
    const normalizedSearch = entrySearch.trim().toLowerCase();
    return entries
      .filter((entry) => (entryKind === "all" ? true : entry.kind === entryKind))
      .filter((entry) => (entryOwner === "all" || entry.kind === "goal" ? true : entry.owner === entryOwner))
      .filter((entry) => (normalizedSearch ? `${entry.title} ${entry.detail}`.toLowerCase().includes(normalizedSearch) : true))
      .sort((a, b) => {
        if (entrySort === "yearDesc") return b.year - a.year || b.month - a.month || a.title.localeCompare(b.title, "ja");
        if (entrySort === "title") return a.title.localeCompare(b.title, "ja") || a.year - b.year || a.month - b.month;
        return a.year - b.year || a.month - b.month || a.title.localeCompare(b.title, "ja");
      });
  }, [entries, entryKind, entryOwner, entrySearch, entrySort]);
  const selectableYears = useMemo(() => {
    const entryYears = entries.map((entry) => entry.year);
    const firstYear = Math.min(currentYear - 2, ...entryYears);
    const lastYear = Math.max(currentYear + 30, ...entryYears);
    return Array.from({ length: lastYear - firstYear + 1 }, (_, index) => firstYear + index);
  }, [currentYear, entries]);
  const selectedYearEntries = visibleEntries.filter((entry) => entry.year === selectedYear);
  const selectedMonthEntries = selectedYearEntries.filter((entry) => entry.month === selectedMonth);
  const getEntryKindLabel = (entry: CalendarEntry) => entry.kind === "goal" ? "目標" : entry.kind === "event" ? "イベント" : "メモ";
  const moveToYear = (year: number) => {
    setSelectedYear(year);
    setSelectedMonth(year === currentYear ? new Date().getMonth() + 1 : 1);
  };

  return (
    <section className="life-calendar" aria-label="ライフカレンダー">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ライフカレンダー</p>
          <h3>目標・イベント・予定メモを月単位で確認</h3>
          <p>年を選んで12か月の予定を確認できます。月を選ぶと、その月の全件を下に表示します。</p>
        </div>
        <div className="calendar-year-navigation" aria-label="表示する年を変更">
          <button type="button" className="secondary" aria-label="前年を表示" onClick={() => moveToYear(selectedYear - 1)}>‹</button>
          <label>
            表示年
            <select aria-label="表示する年" value={selectedYear} onChange={(event) => moveToYear(Number(event.target.value))}>
              {selectableYears.map((year) => <option key={year} value={year}>{year}年</option>)}
            </select>
          </label>
          <button type="button" className="secondary" aria-label="翌年を表示" onClick={() => moveToYear(selectedYear + 1)}>›</button>
          <button type="button" className="secondary calendar-today-button" onClick={() => moveToYear(currentYear)}>今年</button>
        </div>
      </div>

      <div className="calendar-year-detail" aria-label={`${selectedYear}年の月別予定`}>
        <div className="calendar-detail-head">
          <div>
            <strong>{selectedYear}年 年間カレンダー</strong>
            <span>{getTargetAgeForYear(plan.profile.age, selectedYear)}歳頃 / {selectedYearEntries.length}件</span>
          </div>
          <small>月を選ぶと、その月の予定を下に詳しく表示します。</small>
        </div>
        <div className="calendar-month-grid">
          {monthLabels.map((label, index) => {
            const month = index + 1;
            const monthEntries = selectedYearEntries.filter((entry) => entry.month === month);
            const shownMonthEntries = monthEntries.slice(0, 3);
            const hiddenMonthCount = Math.max(0, monthEntries.length - shownMonthEntries.length);
            return (
              <button
                type="button"
                className={`calendar-month-card${selectedMonth === month ? " selected" : ""}`}
                key={label}
                onClick={() => setSelectedMonth(month)}
                aria-pressed={selectedMonth === month}
              >
                <div className="calendar-month-head">
                  <strong>{label}</strong>
                  {monthEntries.length > 0 && <span>{monthEntries.length}件</span>}
                </div>
                {monthEntries.length === 0 ? (
                  <span>予定なし</span>
                ) : (
                  shownMonthEntries.map((entry) => (
                    <div className={`calendar-month-entry ${entry.tone}`} key={entry.id}>
                      <span>{getEntryKindLabel(entry)}</span>
                      <strong>{entry.title}</strong>
                    </div>
                  ))
                )}
                {hiddenMonthCount > 0 && <span className="calendar-more">ほか{hiddenMonthCount}件</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="calendar-month-agenda" aria-label={`${selectedYear}年${selectedMonth}月の予定`}>
        <div className="calendar-month-agenda-head">
          <strong>{selectedYear}年{selectedMonth}月</strong>
          <span>{selectedMonthEntries.length}件</span>
        </div>
        {selectedMonthEntries.length === 0 ? (
          <p>この月の予定はありません。</p>
        ) : (
          selectedMonthEntries.map((entry) => (
            <div className={`calendar-month-agenda-row ${entry.tone}`} key={entry.id}>
              <span>{getEntryKindLabel(entry)}</span>
              <strong>{entry.title}</strong>
              <small>{entry.detail}</small>
              {entry.amount ? <small>{manYen(entry.amount)}</small> : null}
            </div>
          ))
        )}
      </div>

      <details className="calendar-organize-panel">
        <summary>予定を検索・絞り込み</summary>
        <div className="list-toolbar" aria-label="カレンダーの検索と整理">
          <label>
            検索
            <input value={entrySearch} onChange={(event) => setEntrySearch(event.target.value)} placeholder="目標名・イベント名で検索" />
          </label>
          <label>
            種類
            <select value={entryKind} onChange={(event) => setEntryKind(event.target.value as "all" | "goal" | "event" | "memo")}>
              <option value="all">すべて</option>
              <option value="goal">目標のみ</option>
              <option value="event">イベントのみ</option>
              <option value="memo">予定メモのみ</option>
            </select>
          </label>
          <label>
            並び替え
            <select value={entrySort} onChange={(event) => setEntrySort(event.target.value as "yearAsc" | "yearDesc" | "title")}>
              <option value="yearAsc">時期が近い順</option>
              <option value="yearDesc">時期が遠い順</option>
              <option value="title">名前順</option>
            </select>
          </label>
          <label>
            対象者
            <select value={entryOwner} onChange={(event) => setEntryOwner(event.target.value as EventOwner | "all")}>
              <option value="all">すべて</option>
              {Object.entries(eventOwnerLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <span>{visibleEntries.length}件表示 / 全{entries.length}件</span>
        </div>
      </details>

      <div className="calendar-list-panel" aria-label="目標、イベント、予定メモの一覧">
        {visibleEntries.length === 0 ? (
          <EmptyState title="条件に合う予定がありません" detail="検索条件や表示年を変えて確認してください。" />
        ) : (
          visibleEntries.map((entry) => (
            <div className={`calendar-list-row ${entry.tone}`} key={entry.id}>
              <div>
                <span>{getEntryKindLabel(entry)}</span>
                <strong>{entry.title}</strong>
              </div>
              <div>
                <span>{entry.year}年{entry.month}月 / {getTargetAgeForYear(plan.profile.age, entry.year)}歳頃</span>
                <small>{getYearsUntilLabel(entry.year)}</small>
              </div>
              <div>
                <span>{entry.detail}</span>
                {entry.amount ? <small>{manYen(entry.amount)}</small> : null}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export function TimelineView({ plan, setActiveView }: { plan: LifePlan; setActiveView: (view: ViewKey) => void }) {
  return (
    <div className="view-stack">
      <section className="panel">
        <StepTitle step="8" title="年表" description="目標、イベント、予定メモを月ごとにまとめて確認します。" />
        <LifeCalendar plan={plan} />
      </section>
      <StepFlowNav
        setActiveView={setActiveView}
        previous={{ view: "events", label: "イベント設定" }}
        next={{ view: "notes", label: "メモ" }}
      />
    </div>
  );
}
