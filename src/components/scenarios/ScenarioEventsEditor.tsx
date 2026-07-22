import { useState, type FormEvent } from "react";
import { EmptyState, MoneyInput } from "../CommonUi";
import { YearAgeInput } from "../YearAgeInput";
import { createEventDraft } from "../../data/entryDrafts";
import {
  cashflowHelp,
  cashflowLabels,
  eventCategoryLabels,
  eventOwnerLabels,
  monthLabels
} from "../../data/labels";
import type {
  CashflowType,
  EventOwner,
  LifeEvent,
  LifeEventCategory,
  LifeEventDraft
} from "../../types";
import { getTargetAgeForYear, manYen } from "../../utils/calculations";

type ScenarioEventsEditorProps = {
  events: LifeEvent[];
  currentAge: number;
  onAdd: (draft: LifeEventDraft) => void;
  onUpdate: <K extends keyof LifeEvent>(id: string, key: K, value: LifeEvent[K]) => void;
  onScheduleChange: (id: string, year: number) => void;
  onRemove: (id: string) => void;
};

export function ScenarioEventsEditor({
  events,
  currentAge,
  onAdd,
  onUpdate,
  onScheduleChange,
  onRemove
}: ScenarioEventsEditorProps) {
  const [draft, setDraft] = useState<LifeEventDraft>(createEventDraft);
  const [status, setStatus] = useState("");
  const updateDraft = <K extends keyof LifeEventDraft>(key: K, value: LifeEventDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setStatus("");
  };
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title) return;
    onAdd({ ...draft, title });
    setDraft(createEventDraft());
    setStatus(`「${title}」を見直しプランへ登録しました。`);
  };

  return (
    <div className="scenario-editor-content">
      <form className="entry-creation-form" data-testid="scenario-event-create-form" onSubmit={handleSubmit}>
        <div className="entry-creation-heading">
          <div><h3>イベントを追加</h3><p>この選択肢で発生する予定と、その時点の金額を登録します。</p></div>
          <span>必須: イベント名</span>
        </div>
        <div className="entry-creation-grid event-entry-grid">
          <label className="entry-field-wide">イベント名<input required value={draft.title} onChange={(event) => updateDraft("title", event.target.value)} placeholder="例: 住宅購入、転職、家族旅行" /></label>
          <label>
            対象者
            <select value={draft.owner} onChange={(event) => updateDraft("owner", event.target.value as EventOwner)}>{Object.entries(eventOwnerLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </label>
          <label>
            種類
            <select value={draft.category} onChange={(event) => updateDraft("category", event.target.value as LifeEventCategory)}>{Object.entries(eventCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </label>
          <div className="entry-field-wide entry-control-field"><span>予定年</span><YearAgeInput year={draft.year} currentAge={currentAge} ageLabel="予定年齢" onChange={(value) => updateDraft("year", value)} /></div>
          <label>予定月<select value={draft.month} onChange={(event) => updateDraft("month", Number(event.target.value))}>{monthLabels.map((label, index) => <option value={index + 1} key={label}>{label}</option>)}</select></label>
          <label>
            家計への影響
            <select value={draft.cashflowType} onChange={(event) => updateDraft("cashflowType", event.target.value as CashflowType)}>{Object.entries(cashflowLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <small>{cashflowHelp[draft.cashflowType]}</small>
          </label>
          <div className="entry-control-field"><MoneyInput label="金額" value={draft.amount} onChange={(value) => updateDraft("amount", value)} /></div>
          <label className="entry-field-wide">メモ<input value={draft.memo} onChange={(event) => updateDraft("memo", event.target.value)} /></label>
        </div>
        <div className="entry-form-actions"><span role="status" aria-live="polite">{status}</span><button type="submit">イベントを登録</button></div>
      </form>

      <div className="registered-list-heading">
        <div><h3>見直しプラン内のイベント</h3><p>項目を開くと、予定月や家計への影響を変更できます。</p></div>
        <span>{events.length}件</span>
      </div>
      {events.length === 0 ? (
        <EmptyState title="この見直しプランにイベントはありません" detail="比較に必要な予定だけを追加できます。" />
      ) : (
        <div className="scenario-record-list">
          {[...events].sort((a, b) => a.year - b.year || a.month - b.month).map((item) => (
            <details className="scenario-record-editor" key={item.id}>
              <summary>
                <span><strong>{item.title || "名称未入力のイベント"}</strong><small>{item.year}年{item.month}月・{getTargetAgeForYear(currentAge, item.year)}歳頃</small></span>
                <span>{cashflowLabels[item.cashflowType]}{item.cashflowType !== "neutral" ? ` ${manYen(item.amount)}` : ""}</span>
              </summary>
              <div className="scenario-record-fields">
                <label className="entry-field-wide">イベント名<input value={item.title} onChange={(event) => onUpdate(item.id, "title", event.target.value)} /></label>
                <label>対象者<select value={item.owner || "household"} onChange={(event) => onUpdate(item.id, "owner", event.target.value as EventOwner)}>{Object.entries(eventOwnerLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label>種類<select value={item.category} onChange={(event) => onUpdate(item.id, "category", event.target.value as LifeEventCategory)}>{Object.entries(eventCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <div className="entry-field-wide entry-control-field"><span>予定年</span><YearAgeInput year={item.year} currentAge={currentAge} ageLabel="予定年齢" onChange={(value) => onScheduleChange(item.id, value)} /></div>
                <label>予定月<select value={item.month} onChange={(event) => onUpdate(item.id, "month", Number(event.target.value))}>{monthLabels.map((label, index) => <option value={index + 1} key={label}>{label}</option>)}</select></label>
                <label>家計への影響<select value={item.cashflowType} onChange={(event) => onUpdate(item.id, "cashflowType", event.target.value as CashflowType)}>{Object.entries(cashflowLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <MoneyInput label="金額" value={item.amount} onChange={(value) => onUpdate(item.id, "amount", value)} />
                <label className="entry-field-wide">メモ<input value={item.memo} onChange={(event) => onUpdate(item.id, "memo", event.target.value)} /></label>
              </div>
              <div className="scenario-record-footer"><span>{eventCategoryLabels[item.category]} / {eventOwnerLabels[item.owner || "household"]}</span><button type="button" className="text-button danger-text" onClick={() => onRemove(item.id)}>削除</button></div>
            </details>
          ))}
        </div>
      )}
      <div className="notice-band check cashflow-period-note">
        <strong>試算への反映</strong>
        <span>「支出」は予定年の資産から差し引き、「収入・資産増」は加算します。「記録のみ」は金額計算に含めません。</span>
      </div>
    </div>
  );
}
