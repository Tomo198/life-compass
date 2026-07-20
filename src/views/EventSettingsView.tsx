import { useMemo, useState, type FormEvent } from "react";
import { EmptyState, MoneyInput, NumericInput, StepFlowNav, StepTitle } from "../components/CommonUi";
import { YearAgeInput } from "../components/YearAgeInput";
import { MAX_MONEY_AMOUNT, MAX_PLAN_YEAR } from "../config";
import {
  cashflowHelp,
  cashflowLabels,
  eventCategoryLabels,
  eventOwnerLabels,
  monthLabels
} from "../data/labels";
import type {
  CashflowType,
  EventOwner,
  LifeEvent,
  LifeEventDraft,
  LifeEventCategory,
  LifePlan,
  ViewKey
} from "../types";
import { getTargetAgeForYear } from "../utils/calculations";

const createEventDraft = (): LifeEventDraft => ({
  title: "",
  owner: "household",
  category: "other",
  year: new Date().getFullYear() + 1,
  month: new Date().getMonth() + 1,
  amount: 0,
  cashflowType: "neutral",
  memo: ""
});

export function EventSettingsView({
  plan,
  setActiveView,
  addEvent,
  updateEvent,
  updateEventSchedule,
  removeEvent
}: {
  plan: LifePlan;
  setActiveView: (view: ViewKey) => void;
  addEvent: (draft: LifeEventDraft) => void;
  updateEvent: <K extends keyof LifeEvent>(id: string, key: K, value: LifeEvent[K]) => void;
  updateEventSchedule: (id: string, year: number) => void;
  removeEvent: (id: string) => void;
}) {
  const [eventSearch, setEventSearch] = useState("");
  const [eventSort, setEventSort] = useState<"yearAsc" | "yearDesc" | "title" | "type">("yearAsc");
  const [eventViewMode, setEventViewMode] = useState<"detail" | "compact">("detail");
  const [eventOwner, setEventOwner] = useState<EventOwner | "all">("all");
  const [eventDraft, setEventDraft] = useState<LifeEventDraft>(createEventDraft);
  const [eventFormStatus, setEventFormStatus] = useState("");
  const sortedEvents = useMemo(() => {
    const normalizedSearch = eventSearch.trim().toLowerCase();
    return [...plan.events]
      .filter((event) => (eventOwner === "all" ? true : (event.owner || "household") === eventOwner))
      .filter((event) =>
        normalizedSearch
          ? `${event.title} ${event.memo} ${event.month}月 ${eventCategoryLabels[event.category]} ${eventOwnerLabels[event.owner || "household"]}`.toLowerCase().includes(normalizedSearch)
          : true
      )
      .sort((a, b) => {
        if (eventSort === "yearDesc") return b.year - a.year || b.month - a.month || a.title.localeCompare(b.title, "ja");
        if (eventSort === "title") return a.title.localeCompare(b.title, "ja") || a.year - b.year || a.month - b.month;
        if (eventSort === "type") return eventCategoryLabels[a.category].localeCompare(eventCategoryLabels[b.category], "ja") || a.year - b.year || a.month - b.month;
        return a.year - b.year || a.month - b.month || a.title.localeCompare(b.title, "ja");
      });
  }, [eventOwner, eventSearch, eventSort, plan.events]);
  const updateEventDraft = <K extends keyof LifeEventDraft>(key: K, value: LifeEventDraft[K]) => {
    setEventDraft((current) => ({ ...current, [key]: value }));
    setEventFormStatus("");
  };
  const handleEventSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = eventDraft.title.trim();
    if (!title) return;
    addEvent({ ...eventDraft, title });
    setEventDraft(createEventDraft());
    setEventFormStatus(`「${title}」を登録しました。`);
  };
  return (
    <div className="view-stack">
      <section className="panel">
        <div className="section-heading">
          <StepTitle step="7" title="イベント設定" description="予定の時期、対象者、金額、家計への影響を整理します。" />
        </div>
        <form className="entry-creation-form" data-testid="event-create-form" onSubmit={handleEventSubmit}>
          <div className="entry-creation-heading">
            <div>
              <h2>新しいイベント</h2>
              <p>予定を入力して登録すると、下の一覧と年表に追加されます。</p>
            </div>
            <span>必須: イベント名</span>
          </div>
          <div className="entry-creation-grid event-entry-grid">
            <label className="entry-field-wide">
              イベント名
              <input
                required
                value={eventDraft.title}
                onChange={(event) => updateEventDraft("title", event.target.value)}
                placeholder="例: 住宅購入、転職、家族旅行"
              />
            </label>
            <label>
              対象者
              <select value={eventDraft.owner} onChange={(event) => updateEventDraft("owner", event.target.value as EventOwner)}>
                {Object.entries(eventOwnerLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              種類
              <select value={eventDraft.category} onChange={(event) => updateEventDraft("category", event.target.value as LifeEventCategory)}>
                {Object.entries(eventCategoryLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <div className="entry-field-wide entry-control-field">
              <span>予定年</span>
              <YearAgeInput
                year={eventDraft.year}
                currentAge={plan.profile.age}
                ageLabel="予定年齢"
                onChange={(value) => updateEventDraft("year", value)}
              />
            </div>
            <label>
              予定月
              <select value={eventDraft.month} onChange={(event) => updateEventDraft("month", Number(event.target.value))}>
                {monthLabels.map((label, index) => (
                  <option value={index + 1} key={label}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              家計への影響
              <select value={eventDraft.cashflowType} onChange={(event) => updateEventDraft("cashflowType", event.target.value as CashflowType)}>
                {Object.entries(cashflowLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <small>{cashflowHelp[eventDraft.cashflowType]}</small>
            </label>
            <div className="entry-control-field">
              <MoneyInput label="金額" value={eventDraft.amount} onChange={(value) => updateEventDraft("amount", value)} />
            </div>
            <label className="entry-field-wide">
              メモ
              <input value={eventDraft.memo} onChange={(event) => updateEventDraft("memo", event.target.value)} placeholder="前提や検討中のことを残せます" />
            </label>
          </div>
          <details className="entry-help-details">
            <summary>家計への影響の使い分け</summary>
            <section className="helper-grid compact">
              <div><strong>支出として反映</strong><span>住宅購入、車購入、旅行、教育費など、その時期に出る支出に使います。</span></div>
              <div><strong>収入・資産増として反映</strong><span>退職金、売却益、補助金など、その時期に増える金額に使います。</span></div>
              <div><strong>記録のみ</strong><span>転職や結婚など、金額をまだ決めない予定を年表に残すときに使います。</span></div>
            </section>
          </details>
          <div className="entry-form-actions">
            <span role="status" aria-live="polite">{eventFormStatus}</span>
            <button type="submit">イベントを登録</button>
          </div>
        </form>
        <div className="registered-list-heading">
          <div>
            <h2>登録済みのイベント</h2>
            <p>登録後も、一覧から時期や金額を変更できます。</p>
          </div>
          <span>{plan.events.length}件</span>
        </div>
        <div className="list-toolbar" aria-label="イベントの検索と並び替え">
          <label>
            イベントを検索
            <input value={eventSearch} onChange={(event) => setEventSearch(event.target.value)} placeholder="イベント名やメモで検索" />
          </label>
          <label>
            並び替え
            <select value={eventSort} onChange={(event) => setEventSort(event.target.value as "yearAsc" | "yearDesc" | "title" | "type")}>
              <option value="yearAsc">時期が近い順</option>
              <option value="yearDesc">時期が遠い順</option>
              <option value="title">名前順</option>
              <option value="type">種類順</option>
            </select>
          </label>
          <label>
            表示
            <select value={eventViewMode} onChange={(event) => setEventViewMode(event.target.value as "detail" | "compact")}>
              <option value="detail">詳細編集</option>
              <option value="compact">短いリスト</option>
            </select>
          </label>
          <label>
            対象者
            <select value={eventOwner} onChange={(event) => setEventOwner(event.target.value as EventOwner | "all")}>
              <option value="all">すべて</option>
              {Object.entries(eventOwnerLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <span>{sortedEvents.length}件表示 / 全{plan.events.length}件</span>
        </div>
        {eventViewMode === "compact" ? (
          <div className="compact-list" aria-label="イベントの短いリスト">
            {plan.events.length === 0 ? (
              <EmptyState title="まだイベントがありません" detail="上の入力欄に予定を入力し、「イベントを登録」を押してください。" />
            ) : sortedEvents.length === 0 ? (
              <EmptyState title="条件に合うイベントがありません" detail="検索文字を変えるか、並び替えを戻して確認してください。" />
            ) : (
              sortedEvents.map((event) => (
                <div className="compact-list-row" key={event.id}>
                  <label className="compact-title-field">
                    イベント名
                    <input value={event.title} onChange={(input) => updateEvent(event.id, "title", input.target.value)} />
                  </label>
                  <div className="compact-date-fields">
                    <label>
                      年
                      <NumericInput value={event.year} min={new Date().getFullYear()} max={MAX_PLAN_YEAR} onChange={(value) => updateEventSchedule(event.id, value)} />
                    </label>
                    <label>
                      月
                      <select value={event.month} onChange={(input) => updateEvent(event.id, "month", Number(input.target.value))}>
                        {monthLabels.map((label, index) => (
                          <option value={index + 1} key={label}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label>
                    対象者
                    <select value={event.owner || "household"} onChange={(input) => updateEvent(event.id, "owner", input.target.value as EventOwner)}>
                      {Object.entries(eventOwnerLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    種類
                    <select value={event.category} onChange={(input) => updateEvent(event.id, "category", input.target.value as LifeEventCategory)}>
                      {Object.entries(eventCategoryLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    金額
                    <NumericInput value={event.amount} min={0} max={MAX_MONEY_AMOUNT} onChange={(value) => updateEvent(event.id, "amount", value)} />
                  </label>
                  <label>
                    影響
                    <select value={event.cashflowType} onChange={(input) => updateEvent(event.id, "cashflowType", input.target.value as CashflowType)}>
                      {Object.entries(cashflowLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="text-button" onClick={() => removeEvent(event.id)}>
                    削除
                  </button>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="timeline">
        {plan.events.length === 0 ? (
          <EmptyState title="まだイベントがありません" detail="上の入力欄に予定を入力し、「イベントを登録」を押してください。" />
        ) : sortedEvents.length === 0 ? (
          <EmptyState title="条件に合うイベントがありません" detail="検索文字を変えるか、並び替えを戻して確認してください。" />
        ) : (
          sortedEvents.map((event) => (
            <div className="timeline-row" key={event.id}>
              <div className="timeline-year">
                <strong>{event.year}</strong>
                <span>{event.month}月 / {getTargetAgeForYear(plan.profile.age, event.year)}歳</span>
              </div>
              <div className="timeline-fields">
                <label className="timeline-field title-field">
                  イベント名
                  <input value={event.title} onChange={(input) => updateEvent(event.id, "title", input.target.value)} />
                  <small>例: 住宅購入、車購入、転職、旅行など</small>
                </label>
                <label className="timeline-field">
                  対象者
                  <select
                    value={event.owner || "household"}
                    onChange={(input) => updateEvent(event.id, "owner", input.target.value as EventOwner)}
                  >
                    {Object.entries(eventOwnerLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <small>本人、配偶者、子ども、親など、誰に関する予定かを分けます。</small>
                </label>
                <label className="timeline-field">
                  種類
                  <select
                    value={event.category}
                    onChange={(input) => updateEvent(event.id, "category", input.target.value as LifeEventCategory)}
                  >
                    {Object.entries(eventCategoryLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <small>年表で見分けるための分類です。</small>
                </label>
                <div className="timeline-field">
                  <span>予定年</span>
                  <YearAgeInput
                    year={event.year}
                    currentAge={plan.profile.age}
                    ageLabel="予定年齢"
                    onChange={(value) => updateEventSchedule(event.id, value)}
                  />
                </div>
                <label className="timeline-field">
                  予定月
                  <select value={event.month} onChange={(input) => updateEvent(event.id, "month", Number(input.target.value))}>
                    {monthLabels.map((label, index) => (
                      <option value={index + 1} key={label}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <small>スケジュール帳のように月単位で整理します。</small>
                </label>
                <label className="timeline-field">
                  金額
                  <NumericInput value={event.amount} min={0} max={MAX_MONEY_AMOUNT} onChange={(value) => updateEvent(event.id, "amount", value)} />
                  <small>支出または収入変化として反映する金額です。</small>
                </label>
                <label className="timeline-field impact-field">
                  家計への影響
                  <select
                    value={event.cashflowType}
                    onChange={(input) => updateEvent(event.id, "cashflowType", input.target.value as CashflowType)}
                  >
                    {Object.entries(cashflowLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <small>{cashflowHelp[event.cashflowType]}</small>
                </label>
                <label className="timeline-field memo-field">
                  メモ
                  <input value={event.memo} onChange={(input) => updateEvent(event.id, "memo", input.target.value)} />
                  <small>前提や検討中のことを残せます。</small>
                </label>
                <button type="button" className="text-button" onClick={() => removeEvent(event.id)}>
                  削除
                </button>
              </div>
            </div>
          ))
        )}
          </div>
        )}
      </section>
      <StepFlowNav
        setActiveView={setActiveView}
        previous={{ view: "simulation", label: "シミュレーション" }}
        next={{ view: "timeline", label: "年表" }}
      />
    </div>
  );
}
