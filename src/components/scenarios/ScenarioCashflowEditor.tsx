import { useState, type FormEvent } from "react";
import { EmptyState, MoneyInput, NumericInput } from "../CommonUi";
import { MAX_PLAN_YEAR } from "../../config";
import { createCashflowPeriodDraft } from "../../data/entryDrafts";
import {
  cashflowPeriodTargetLabels,
  cashflowPeriodTargetUnits,
  eventOwnerLabels
} from "../../data/labels";
import type { CashflowPeriod, CashflowPeriodDraft, Household } from "../../types";
import { getTargetAgeForYear, manYen } from "../../utils/calculations";

type ScenarioCashflowEditorProps = {
  household: Household;
  periods: CashflowPeriod[];
  currentAge: number;
  onAdd: (draft: CashflowPeriodDraft) => void;
  onUpdate: <K extends keyof CashflowPeriod>(id: string, key: K, value: CashflowPeriod[K]) => void;
  onRemove: (id: string) => void;
};

export function ScenarioCashflowEditor({
  household,
  periods,
  currentAge,
  onAdd,
  onUpdate,
  onRemove
}: ScenarioCashflowEditorProps) {
  const [draft, setDraft] = useState<CashflowPeriodDraft>(() => createCashflowPeriodDraft(household));
  const [status, setStatus] = useState("");
  const updateDraft = <K extends keyof CashflowPeriodDraft>(key: K, value: CashflowPeriodDraft[K]) => {
    setDraft((current) => {
      if (key === "startYear") {
        const startYear = value as number;
        return { ...current, startYear, endYear: Math.max(startYear, current.endYear) };
      }
      return { ...current, [key]: value };
    });
    setStatus("");
  };
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title) return;
    onAdd({ ...draft, title });
    setDraft(createCashflowPeriodDraft(household));
    setStatus(`「${title}」をシナリオへ登録しました。`);
  };

  return (
    <div className="scenario-editor-content">
      <form className="entry-creation-form" data-testid="scenario-cashflow-create-form" onSubmit={handleSubmit}>
        <div className="entry-creation-heading">
          <div>
            <h3>時期別の収支を追加</h3>
            <p>育休、転職、教育費、住宅費など、期間中だけ変わる金額を登録します。</p>
          </div>
          <span>必須: 変更名</span>
        </div>
        <div className="entry-creation-grid">
          <label className="entry-field-wide">
            変更名
            <input required value={draft.title} onChange={(event) => updateDraft("title", event.target.value)} />
          </label>
          <label>
            対象者
            <select value={draft.owner} onChange={(event) => updateDraft("owner", event.target.value as CashflowPeriod["owner"])}>
              {Object.entries(eventOwnerLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
          <label>
            変更する項目
            <select value={draft.target} onChange={(event) => updateDraft("target", event.target.value as CashflowPeriod["target"])}>
              {Object.entries(cashflowPeriodTargetLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
          <label>
            開始年
            <NumericInput value={draft.startYear} min={new Date().getFullYear()} max={MAX_PLAN_YEAR} onChange={(value) => updateDraft("startYear", value)} />
          </label>
          <label>
            終了年
            <NumericInput value={draft.endYear} min={draft.startYear} max={MAX_PLAN_YEAR} onChange={(value) => updateDraft("endYear", value)} />
          </label>
          <div className="entry-control-field">
            <MoneyInput label={`期間中の金額（${cashflowPeriodTargetUnits[draft.target]}）`} value={draft.amount} onChange={(value) => updateDraft("amount", value)} />
          </div>
          <label className="entry-field-wide">
            メモ
            <input value={draft.memo} onChange={(event) => updateDraft("memo", event.target.value)} placeholder="例: 育休中、大学在学中" />
          </label>
        </div>
        <div className="entry-form-actions">
          <span role="status" aria-live="polite">{status}</span>
          <button type="submit">時期別収支を登録</button>
        </div>
      </form>

      <div className="registered-list-heading">
        <div><h3>シナリオ内の時期別収支</h3><p>登録内容はこのシナリオだけの年次見通しへ反映されます。</p></div>
        <span>{periods.length}件</span>
      </div>
      {periods.length === 0 ? (
        <EmptyState title="時期別の変更はありません" detail="基本収支が将来も続く前提で比較しています。" />
      ) : (
        <div className="cashflow-period-list">
          {periods.map((period) => (
            <div className="cashflow-period-row" key={period.id}>
              <div className="cashflow-period-heading">
                <label>変更名<input value={period.title} onChange={(event) => onUpdate(period.id, "title", event.target.value)} /></label>
                <button type="button" className="text-button danger-text" onClick={() => onRemove(period.id)}>削除</button>
              </div>
              <div className="form-grid cashflow-period-fields">
                <label>
                  対象者
                  <select value={period.owner} onChange={(event) => onUpdate(period.id, "owner", event.target.value as CashflowPeriod["owner"])}>
                    {Object.entries(eventOwnerLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                  </select>
                </label>
                <label>
                  変更する項目
                  <select value={period.target} onChange={(event) => onUpdate(period.id, "target", event.target.value as CashflowPeriod["target"])}>
                    {Object.entries(cashflowPeriodTargetLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                  </select>
                </label>
                <label>開始年<NumericInput value={period.startYear} min={new Date().getFullYear()} max={MAX_PLAN_YEAR} onChange={(value) => onUpdate(period.id, "startYear", value)} /></label>
                <label>終了年<NumericInput value={period.endYear} min={period.startYear} max={MAX_PLAN_YEAR} onChange={(value) => onUpdate(period.id, "endYear", value)} /></label>
                <MoneyInput label={`期間中の金額（${cashflowPeriodTargetUnits[period.target]}）`} value={period.amount} onChange={(value) => onUpdate(period.id, "amount", value)} />
                <label>メモ<input value={period.memo} onChange={(event) => onUpdate(period.id, "memo", event.target.value)} /></label>
              </div>
              <p className="cashflow-period-summary">
                {period.startYear}年（{getTargetAgeForYear(currentAge, period.startYear)}歳）から{period.endYear}年（{getTargetAgeForYear(currentAge, period.endYear)}歳）まで、{cashflowPeriodTargetLabels[period.target]}を{manYen(period.amount)}として試算します。
              </p>
            </div>
          ))}
        </div>
      )}
      <div className="notice-band check cashflow-period-note">
        <strong>基本プランとは別に保存</strong>
        <span>ここでの変更は比較中のシナリオだけに反映され、「このシナリオを採用」するまで基本プランは変わりません。</span>
      </div>
    </div>
  );
}
