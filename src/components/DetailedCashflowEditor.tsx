import { useMemo, useState, type FormEvent } from "react";
import { MAX_DETAILED_CASHFLOW_ITEMS, MAX_PLAN_YEAR } from "../config";
import { createDetailedCashflowDraft } from "../utils/detailedCashflow";
import { cashflowPeriodTargetLabels, cashflowPeriodTargetUnits } from "../data/labels";
import type {
  CashflowPeriodTarget,
  DetailedCashflowItem,
  DetailedCashflowItemDraft,
  HouseholdMember
} from "../types";
import { getTargetAgeForYear, manYen } from "../utils/calculations";
import { EmptyState, MoneyInput, NumericInput } from "./CommonUi";

type DetailedCashflowEditorProps = {
  items: DetailedCashflowItem[];
  members: HouseholdMember[];
  currentAge: number;
  onAdd: (draft: DetailedCashflowItemDraft) => boolean;
  onUpdate: <K extends keyof DetailedCashflowItem>(
    id: string,
    key: K,
    value: DetailedCashflowItem[K]
  ) => void;
  onRemove: (id: string) => void;
};

export function DetailedCashflowEditor({
  items,
  members,
  currentAge,
  onAdd,
  onUpdate,
  onRemove
}: DetailedCashflowEditorProps) {
  const primaryMemberId = members.find((member) => member.relationship === "self")?.id ?? null;
  const [draft, setDraft] = useState<DetailedCashflowItemDraft>(() =>
    createDetailedCashflowDraft(currentAge, primaryMemberId)
  );
  const [query, setQuery] = useState("");
  const [targetFilter, setTargetFilter] = useState<"all" | CashflowPeriodTarget>("all");
  const [status, setStatus] = useState("");
  const memberNames = useMemo(
    () => new Map(members.map((member) => [member.id, member.displayName])),
    [members]
  );
  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ja-JP");
    return [...items]
      .filter((item) => targetFilter === "all" || item.target === targetFilter)
      .filter((item) => {
        if (!normalizedQuery) return true;
        const memberName = item.memberId ? memberNames.get(item.memberId) || "" : "世帯共通";
        return `${item.title} ${item.memo} ${memberName}`.toLocaleLowerCase("ja-JP").includes(normalizedQuery);
      })
      .sort((a, b) => a.startYear - b.startYear || a.target.localeCompare(b.target) || a.title.localeCompare(b.title));
  }, [items, memberNames, query, targetFilter]);

  const updateDraft = <K extends keyof DetailedCashflowItemDraft>(
    key: K,
    value: DetailedCashflowItemDraft[K]
  ) => {
    setDraft((current) => {
      if (key === "startYear") {
        const startYear = value as number;
        return { ...current, startYear, endYear: Math.max(startYear, current.endYear) };
      }
      if (key === "target") {
        const target = value as CashflowPeriodTarget;
        return { ...current, target };
      }
      return { ...current, [key]: value };
    });
    setStatus("");
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title) return;
    if (!onAdd({ ...draft, title })) {
      setStatus(`登録上限は${MAX_DETAILED_CASHFLOW_ITEMS}件です。`);
      return;
    }
    setDraft(createDetailedCashflowDraft(currentAge, primaryMemberId));
    setStatus(`「${title}」を登録しました。`);
  };

  return (
    <div className="detailed-cashflow-editor">
      <form className="entry-creation-form" data-testid="detailed-cashflow-create-form" onSubmit={handleSubmit}>
        <div className="entry-creation-heading">
          <div>
            <h3>収入・支出の期間を登録</h3>
            <p>対象者、金額、開始年と終了年を設定します。</p>
          </div>
          <span>必須: 項目名</span>
        </div>
        <div className="entry-creation-grid">
          <label className="entry-field-wide">
            項目名
            <input
              required
              value={draft.title}
              onChange={(event) => updateDraft("title", event.target.value)}
              placeholder="例: 本人の給与、住宅費、教育費"
            />
          </label>
          <label>
            対象者
            <select
              value={draft.memberId ?? ""}
              onChange={(event) => updateDraft("memberId", event.target.value || null)}
            >
              <option value="">世帯共通</option>
              {members.map((member) => (
                <option value={member.id} key={member.id}>{member.displayName}</option>
              ))}
            </select>
          </label>
          <label>
            収支の種類
            <select
              value={draft.target}
              onChange={(event) => updateDraft("target", event.target.value as CashflowPeriodTarget)}
            >
              {Object.entries(cashflowPeriodTargetLabels).map(([value, label]) => (
                <option value={value} key={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            開始年
            <NumericInput
              value={draft.startYear}
              min={new Date().getFullYear()}
              max={MAX_PLAN_YEAR}
              onChange={(value) => updateDraft("startYear", value)}
            />
          </label>
          <label>
            終了年
            <NumericInput
              value={draft.endYear}
              min={draft.startYear}
              max={MAX_PLAN_YEAR}
              onChange={(value) => updateDraft("endYear", value)}
            />
          </label>
          <div className="entry-control-field">
            <MoneyInput
              label={`金額（${cashflowPeriodTargetUnits[draft.target]}）`}
              value={draft.amount}
              onChange={(value) => updateDraft("amount", value)}
            />
          </div>
          <label className="entry-field-wide">
            メモ
            <input value={draft.memo} onChange={(event) => updateDraft("memo", event.target.value)} />
          </label>
        </div>
        <div className="entry-form-actions">
          <span role="status" aria-live="polite">{status}</span>
          <button type="submit">収支項目を登録</button>
        </div>
      </form>

      <div className="registered-list-heading">
        <div>
          <h3>登録済みの詳細収支</h3>
          <p>開始年順に表示しています。項目を開くと編集できます。</p>
        </div>
        <span>{items.length}件</span>
      </div>
      {items.length > 0 ? (
        <div className="detailed-cashflow-toolbar">
          <label>
            項目を検索
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="項目名・対象者・メモ" />
          </label>
          <label>
            種類
            <select
              value={targetFilter}
              onChange={(event) => setTargetFilter(event.target.value as "all" | CashflowPeriodTarget)}
            >
              <option value="all">すべて</option>
              {Object.entries(cashflowPeriodTargetLabels).map(([value, label]) => (
                <option value={value} key={value}>{label}</option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState title="詳細収支はまだありません" detail="上の入力欄から収入または支出を登録してください。" />
      ) : visibleItems.length === 0 ? (
        <EmptyState title="条件に一致する項目はありません" detail="検索語または種類を変更してください。" />
      ) : (
        <div className="scenario-record-list detailed-cashflow-list">
          {visibleItems.map((item) => {
            const memberName = item.memberId ? memberNames.get(item.memberId) || "世帯共通" : "世帯共通";
            return (
              <details className="scenario-record-editor" key={item.id}>
                <summary>
                  <span>
                    <strong>{item.title || "名称未入力の収支項目"}</strong>
                    <small>{memberName}・{item.startYear}年から{item.endYear}年</small>
                  </span>
                  <span>{cashflowPeriodTargetLabels[item.target]} {manYen(item.amount)}</span>
                </summary>
                <div className="scenario-record-fields">
                  <label className="entry-field-wide">
                    項目名
                    <input value={item.title} onChange={(event) => onUpdate(item.id, "title", event.target.value)} />
                  </label>
                  <label>
                    対象者
                    <select
                      value={item.memberId ?? ""}
                      onChange={(event) => onUpdate(item.id, "memberId", event.target.value || null)}
                    >
                      <option value="">世帯共通</option>
                      {members.map((member) => (
                        <option value={member.id} key={member.id}>{member.displayName}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    収支の種類
                    <select
                      value={item.target}
                      onChange={(event) => onUpdate(item.id, "target", event.target.value as CashflowPeriodTarget)}
                    >
                      {Object.entries(cashflowPeriodTargetLabels).map(([value, label]) => (
                        <option value={value} key={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    開始年
                    <NumericInput
                      value={item.startYear}
                      min={new Date().getFullYear()}
                      max={MAX_PLAN_YEAR}
                      onChange={(value) => onUpdate(item.id, "startYear", value)}
                    />
                  </label>
                  <label>
                    終了年
                    <NumericInput
                      value={item.endYear}
                      min={item.startYear}
                      max={MAX_PLAN_YEAR}
                      onChange={(value) => onUpdate(item.id, "endYear", value)}
                    />
                  </label>
                  <MoneyInput
                    label={`金額（${cashflowPeriodTargetUnits[item.target]}）`}
                    value={item.amount}
                    onChange={(value) => onUpdate(item.id, "amount", value)}
                  />
                  <label className="entry-field-wide">
                    メモ
                    <input value={item.memo} onChange={(event) => onUpdate(item.id, "memo", event.target.value)} />
                  </label>
                </div>
                <div className="scenario-record-footer">
                  <span>
                    {item.startYear}年（{getTargetAgeForYear(currentAge, item.startYear)}歳）から
                    {item.endYear}年（{getTargetAgeForYear(currentAge, item.endYear)}歳）
                  </span>
                  <button type="button" className="text-button danger-text" onClick={() => onRemove(item.id)}>削除</button>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
