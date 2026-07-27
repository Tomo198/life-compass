import { useMemo, useState, type FormEvent } from "react";
import { MAX_DETAILED_CASHFLOW_ITEMS, MAX_PLAN_YEAR } from "../config";
import { createDetailedCashflowDraft } from "../utils/detailedCashflow";
import { cashflowPeriodTargetLabels, cashflowPeriodTargetUnits } from "../data/labels";
import { householdMemberRelationshipLabels } from "../data/householdMembers";
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

const getScheduleLabel = (startYear: number, endYear: number, currentYear: number) => {
  if (startYear <= currentYear && endYear === MAX_PLAN_YEAR) return "今から継続";
  if (endYear === MAX_PLAN_YEAR) return `${startYear}年から継続`;
  if (startYear <= currentYear) return `今から${endYear}年まで`;
  return `${startYear}年から${endYear}年まで`;
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
  const [showDraftSchedule, setShowDraftSchedule] = useState(false);
  const currentYear = new Date().getFullYear();
  const memberLabels = useMemo(
    () => new Map(members.map((member) => {
      const relationship = householdMemberRelationshipLabels[member.relationship];
      const label = member.displayName === relationship
        ? relationship
        : `${member.displayName}（${relationship}）`;
      return [member.id, label];
    })),
    [members]
  );
  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ja-JP");
    return [...items]
      .filter((item) => targetFilter === "all" || item.target === targetFilter)
      .filter((item) => {
        if (!normalizedQuery) return true;
        const memberName = item.memberId ? memberLabels.get(item.memberId) || "" : "世帯共通";
        return `${item.title} ${item.memo} ${memberName}`.toLocaleLowerCase("ja-JP").includes(normalizedQuery);
      })
      .sort((a, b) => a.startYear - b.startYear || a.target.localeCompare(b.target) || a.title.localeCompare(b.title));
  }, [items, memberLabels, query, targetFilter]);

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
    setShowDraftSchedule(false);
    setStatus(`「${title}」を登録しました。`);
  };

  return (
    <div className="detailed-cashflow-editor">
      <form className="entry-creation-form" data-testid="detailed-cashflow-create-form" onSubmit={handleSubmit}>
        <div className="entry-creation-heading">
          <div>
            <h3>家族の収入・支出を追加</h3>
            <p>まず対象者と金額を入力します。期間を指定しなければ、今から継続として扱います。</p>
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
          <label className="family-cashflow-member-field">
            誰の収支ですか？
            <select
              value={draft.memberId ?? ""}
              onChange={(event) => updateDraft("memberId", event.target.value || null)}
            >
              <option value="">世帯共通（住居費・生活費など）</option>
              {members.map((member) => (
                <option value={member.id} key={member.id}>{memberLabels.get(member.id)}</option>
              ))}
            </select>
          </label>
          <label>
            何を入力しますか？
            <select
              value={draft.target}
              onChange={(event) => updateDraft("target", event.target.value as CashflowPeriodTarget)}
            >
              {Object.entries(cashflowPeriodTargetLabels).map(([value, label]) => (
                <option value={value} key={value}>{label}</option>
              ))}
            </select>
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
          <div className="cashflow-schedule-control">
            <button
              type="button"
              className="secondary cashflow-schedule-toggle"
              aria-expanded={showDraftSchedule}
              onClick={() => setShowDraftSchedule((value) => !value)}
            >
              将来変わる予定
            </button>
            <span>{getScheduleLabel(draft.startYear, draft.endYear, currentYear)}</span>
          </div>
          {showDraftSchedule ? (
            <div className="cashflow-schedule-fields">
              <label>
                開始年
                <NumericInput
                  value={draft.startYear}
                  min={currentYear}
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
              <button
                type="button"
                className="text-button"
                onClick={() => setDraft((current) => ({
                  ...current,
                  startYear: currentYear,
                  endYear: MAX_PLAN_YEAR
                }))}
              >
                今から継続に戻す
              </button>
            </div>
          ) : null}
        </div>
        <div className="entry-form-actions">
          <span role="status" aria-live="polite">{status}</span>
          <button type="submit">収支項目を登録</button>
        </div>
      </form>

      <div className="registered-list-heading">
        <div>
          <h3>登録済みの家族別収支</h3>
          <p>対象者と項目を確認できます。将来変わる項目だけ期間を設定します。</p>
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
            const memberName = item.memberId ? memberLabels.get(item.memberId) || "世帯共通" : "世帯共通";
            return (
              <details className="scenario-record-editor" key={item.id}>
                <summary>
                  <span>
                    <strong>{item.title || "名称未入力の収支項目"}</strong>
                    <small>{memberName}・{getScheduleLabel(item.startYear, item.endYear, currentYear)}</small>
                  </span>
                  <span>{cashflowPeriodTargetLabels[item.target]} {manYen(item.amount)}</span>
                </summary>
                <div className="scenario-record-fields">
                  <label className="entry-field-wide">
                    項目名
                    <input value={item.title} onChange={(event) => onUpdate(item.id, "title", event.target.value)} />
                  </label>
                  <label className="family-cashflow-member-field">
                    誰の収支ですか？
                    <select
                      value={item.memberId ?? ""}
                      onChange={(event) => onUpdate(item.id, "memberId", event.target.value || null)}
                    >
                      <option value="">世帯共通（住居費・生活費など）</option>
                      {members.map((member) => (
                        <option value={member.id} key={member.id}>{memberLabels.get(member.id)}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    何を入力しますか？
                    <select
                      value={item.target}
                      onChange={(event) => onUpdate(item.id, "target", event.target.value as CashflowPeriodTarget)}
                    >
                      {Object.entries(cashflowPeriodTargetLabels).map(([value, label]) => (
                        <option value={value} key={value}>{label}</option>
                      ))}
                    </select>
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
                  <details className="cashflow-schedule-details">
                    <summary>
                      <span>将来変わる予定</span>
                      <small>{getScheduleLabel(item.startYear, item.endYear, currentYear)}</small>
                    </summary>
                    <div className="cashflow-schedule-fields">
                      <label>
                        開始年
                        <NumericInput
                          value={item.startYear}
                          min={currentYear}
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
                    </div>
                  </details>
                </div>
                <div className="scenario-record-footer">
                  <span>{getScheduleLabel(item.startYear, item.endYear, currentYear)}
                    {item.endYear !== MAX_PLAN_YEAR
                      ? `（${getTargetAgeForYear(currentAge, item.startYear)}歳〜${getTargetAgeForYear(currentAge, item.endYear)}歳）`
                      : ""}
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
