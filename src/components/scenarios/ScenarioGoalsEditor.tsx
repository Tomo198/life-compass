import { useState, type FormEvent } from "react";
import { EmptyState, MoneyInput } from "../CommonUi";
import { YearAgeInput } from "../YearAgeInput";
import { createGoalDraft } from "../../data/entryDrafts";
import { monthLabels, priorityLabels } from "../../data/labels";
import type { Goal, GoalDraft, Priority, RecurrenceInterval } from "../../types";
import { getGoalPreparedPercent, getTargetAgeForYear, manYen } from "../../utils/calculations";

type ScenarioGoalsEditorProps = {
  goals: Goal[];
  currentAge: number;
  onAdd: (draft: GoalDraft) => void;
  onUpdate: <K extends keyof Goal>(id: string, key: K, value: Goal[K]) => void;
  onRemove: (id: string) => void;
};

export function ScenarioGoalsEditor({ goals, currentAge, onAdd, onUpdate, onRemove }: ScenarioGoalsEditorProps) {
  const [draft, setDraft] = useState<GoalDraft>(createGoalDraft);
  const [status, setStatus] = useState("");
  const updateDraft = <K extends keyof GoalDraft>(key: K, value: GoalDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setStatus("");
  };
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title) return;
    onAdd({ ...draft, title });
    setDraft(createGoalDraft());
    setStatus(`「${title}」をシナリオへ登録しました。`);
  };

  return (
    <div className="scenario-editor-content">
      <form className="entry-creation-form" data-testid="scenario-goal-create-form" onSubmit={handleSubmit}>
        <div className="entry-creation-heading">
          <div><h3>目標を追加</h3><p>この選択肢で目指す金額や時期を設定します。</p></div>
          <span>必須: 目標名</span>
        </div>
        <div className="entry-creation-grid goal-entry-grid">
          <label className="entry-field-wide">目標名<input required value={draft.title} onChange={(event) => updateDraft("title", event.target.value)} placeholder="例: 住宅購入の頭金" /></label>
          <label>
            種類
            <select value={draft.goalType} onChange={(event) => updateDraft("goalType", event.target.value as Goal["goalType"])}>
              <option value="oneTime">1回限り</option><option value="recurring">繰り返し</option>
            </select>
          </label>
          <label>
            優先度
            <select value={draft.priority} onChange={(event) => updateDraft("priority", event.target.value as Priority)}>
              {Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <div className="entry-field-wide entry-control-field">
            <span>期限</span>
            <div className="scenario-deadline-fields">
              <YearAgeInput year={draft.dueYear} currentAge={currentAge} ageLabel="達成年齢" onChange={(value) => updateDraft("dueYear", value)} />
              <label>月<select value={draft.dueMonth} onChange={(event) => updateDraft("dueMonth", Number(event.target.value))}>{monthLabels.map((label, index) => <option value={index + 1} key={label}>{label}</option>)}</select></label>
            </div>
          </div>
          <div className="entry-control-field"><MoneyInput label={draft.goalType === "recurring" ? "1回あたり予算" : "目標額"} value={draft.requiredAmount} onChange={(value) => updateDraft("requiredAmount", value)} /></div>
          {draft.goalType === "recurring" ? (
            <label>
              頻度
              <select value={draft.recurrence} onChange={(event) => updateDraft("recurrence", event.target.value as RecurrenceInterval)}>
                <option value="yearly">年1回</option><option value="halfYearly">半年に1回</option><option value="quarterly">3ヶ月に1回</option><option value="monthly">毎月</option>
              </select>
            </label>
          ) : (
            <div className="entry-control-field"><MoneyInput label="達成済み額" value={draft.savedAmount} onChange={(value) => updateDraft("savedAmount", value)} /></div>
          )}
          <div className="entry-control-field"><MoneyInput label="毎月この目標に回す額" value={draft.monthlyAllocation} onChange={(value) => updateDraft("monthlyAllocation", value)} /></div>
          <label className="entry-field-wide">メモ<input value={draft.memo} onChange={(event) => updateDraft("memo", event.target.value)} /></label>
        </div>
        <div className="entry-form-actions"><span role="status" aria-live="polite">{status}</span><button type="submit">目標を登録</button></div>
      </form>

      <div className="registered-list-heading">
        <div><h3>シナリオ内の目標</h3><p>項目を開くと、金額や期限を変更できます。</p></div>
        <span>{goals.length}件</span>
      </div>
      {goals.length === 0 ? (
        <EmptyState title="このシナリオに目標はありません" detail="必要な目標だけを追加して比較できます。" />
      ) : (
        <div className="scenario-record-list">
          {goals.map((goal) => (
            <details className="scenario-record-editor" key={goal.id}>
              <summary>
                <span><strong>{goal.title || "名称未入力の目標"}</strong><small>{goal.dueYear}年{goal.dueMonth}月・{getTargetAgeForYear(currentAge, goal.dueYear)}歳頃</small></span>
                <span>{goal.goalType === "recurring" ? "繰り返し" : `準備 ${getGoalPreparedPercent(goal)}%`}</span>
              </summary>
              <div className="scenario-record-fields">
                <label className="entry-field-wide">目標名<input value={goal.title} onChange={(event) => onUpdate(goal.id, "title", event.target.value)} /></label>
                <label>
                  種類
                  <select value={goal.goalType} onChange={(event) => onUpdate(goal.id, "goalType", event.target.value as Goal["goalType"])}><option value="oneTime">1回限り</option><option value="recurring">繰り返し</option></select>
                </label>
                <label>
                  優先度
                  <select value={goal.priority} onChange={(event) => onUpdate(goal.id, "priority", event.target.value as Priority)}>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                </label>
                <div className="entry-field-wide entry-control-field">
                  <span>期限</span>
                  <div className="scenario-deadline-fields">
                    <YearAgeInput year={goal.dueYear} currentAge={currentAge} ageLabel="達成年齢" onChange={(value) => onUpdate(goal.id, "dueYear", value)} />
                    <label>月<select value={goal.dueMonth} onChange={(event) => onUpdate(goal.id, "dueMonth", Number(event.target.value))}>{monthLabels.map((label, index) => <option value={index + 1} key={label}>{label}</option>)}</select></label>
                  </div>
                </div>
                <MoneyInput label={goal.goalType === "recurring" ? "1回あたり予算" : "目標額"} value={goal.requiredAmount} onChange={(value) => onUpdate(goal.id, "requiredAmount", value)} />
                {goal.goalType === "recurring" ? (
                  <label>頻度<select value={goal.recurrence} onChange={(event) => onUpdate(goal.id, "recurrence", event.target.value as RecurrenceInterval)}><option value="yearly">年1回</option><option value="halfYearly">半年に1回</option><option value="quarterly">3ヶ月に1回</option><option value="monthly">毎月</option></select></label>
                ) : (
                  <MoneyInput label="達成済み額" value={goal.savedAmount} onChange={(value) => onUpdate(goal.id, "savedAmount", value)} />
                )}
                <MoneyInput label="毎月この目標に回す額" value={goal.monthlyAllocation} onChange={(value) => onUpdate(goal.id, "monthlyAllocation", value)} />
                <label className="entry-field-wide">メモ<input value={goal.memo} onChange={(event) => onUpdate(goal.id, "memo", event.target.value)} /></label>
              </div>
              <div className="scenario-record-footer"><span>{goal.goalType === "recurring" ? `1回 ${manYen(goal.requiredAmount)}` : `目標 ${manYen(goal.requiredAmount)} / 準備済み ${manYen(goal.savedAmount)}`}</span><button type="button" className="text-button danger-text" onClick={() => onRemove(goal.id)}>削除</button></div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
