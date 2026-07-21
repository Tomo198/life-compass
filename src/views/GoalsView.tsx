import { useMemo, useState, type FormEvent } from "react";
import { EmptyState, MoneyInput, NumericInput, StepFlowNav, StepTitle } from "../components/CommonUi";
import { YearAgeInput } from "../components/YearAgeInput";
import { MAX_MONEY_AMOUNT } from "../config";
import { createGoalDraft } from "../data/entryDrafts";
import { monthLabels, priorityLabels } from "../data/labels";
import type { Goal, GoalDraft, LifePlan, Priority, RecurrenceInterval, ViewKey } from "../types";
import {
  getGoalAchievement,
  getGoalAchievements,
  getGoalFundingSummary,
  getGoalPreparedPercent,
  getTargetAgeForYear,
  manYen
} from "../utils/calculations";

export function GoalsView({
  plan,
  setActiveView,
  addGoal,
  updateGoal,
  removeGoal
}: {
  plan: LifePlan;
  setActiveView: (view: ViewKey) => void;
  addGoal: (draft: GoalDraft) => void;
  updateGoal: <K extends keyof Goal>(id: string, key: K, value: Goal[K]) => void;
  removeGoal: (id: string) => void;
}) {
  const [goalSearch, setGoalSearch] = useState("");
  const [goalSort, setGoalSort] = useState<"dueYear" | "priority" | "progress" | "title">("dueYear");
  const [goalViewMode, setGoalViewMode] = useState<"detail" | "compact">("detail");
  const [goalDraft, setGoalDraft] = useState<GoalDraft>(createGoalDraft);
  const [goalFormStatus, setGoalFormStatus] = useState("");
  const priorityRank: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
  const goalFunding = useMemo(() => getGoalFundingSummary(plan), [plan]);
  const goalAchievements = useMemo(() => {
    const normalizedSearch = goalSearch.trim().toLowerCase();
    return getGoalAchievements(plan)
      .filter(({ goal }) =>
        normalizedSearch
          ? `${goal.title} ${goal.memo}`.toLowerCase().includes(normalizedSearch)
          : true
      )
      .sort((a, b) => {
        if (goalSort === "priority") return priorityRank[a.goal.priority] - priorityRank[b.goal.priority] || a.goal.dueYear - b.goal.dueYear;
        if (goalSort === "progress") return getGoalPreparedPercent(b.goal) - getGoalPreparedPercent(a.goal);
        if (goalSort === "title") return a.goal.title.localeCompare(b.goal.title, "ja");
        return a.goal.dueYear - b.goal.dueYear || a.goal.title.localeCompare(b.goal.title, "ja");
      });
  }, [goalSearch, goalSort, plan]);
  const updateGoalDraft = <K extends keyof GoalDraft>(key: K, value: GoalDraft[K]) => {
    setGoalDraft((current) => ({ ...current, [key]: value }));
    setGoalFormStatus("");
  };
  const handleGoalSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = goalDraft.title.trim();
    if (!title) return;
    addGoal({ ...goalDraft, title });
    setGoalDraft(createGoalDraft());
    setGoalFormStatus(`「${title}」を登録しました。`);
  };

  return (
    <div className="view-stack">
      <section className="panel">
        <div className="section-heading">
          <StepTitle step="5" title="目標管理" description="期限、目標額、優先度、準備状況を整理します。" />
        </div>
        <form className="entry-creation-form" data-testid="goal-create-form" onSubmit={handleGoalSubmit}>
          <div className="entry-creation-heading">
            <div>
              <h2>新しい目標</h2>
              <p>内容を入力して登録すると、下の一覧と年表に追加されます。</p>
            </div>
            <span>必須: 目標名</span>
          </div>
          <div className="entry-creation-grid goal-entry-grid">
            <label className="entry-field-wide">
              目標名
              <input
                required
                value={goalDraft.title}
                onChange={(event) => updateGoalDraft("title", event.target.value)}
                placeholder="例: 5年後に資産500万円"
              />
            </label>
            <label>
              種類
              <select value={goalDraft.goalType} onChange={(event) => updateGoalDraft("goalType", event.target.value as Goal["goalType"])}>
                <option value="oneTime">1回限り</option>
                <option value="recurring">繰り返し</option>
              </select>
            </label>
            <label>
              優先度
              <select value={goalDraft.priority} onChange={(event) => updateGoalDraft("priority", event.target.value as Priority)}>
                {Object.entries(priorityLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <div className="entry-field-wide entry-control-field">
              <span>期限</span>
              <GoalDeadlineInput
                dueYear={goalDraft.dueYear}
                dueMonth={goalDraft.dueMonth}
                currentAge={plan.profile.age}
                onYearChange={(value) => updateGoalDraft("dueYear", value)}
                onMonthChange={(value) => updateGoalDraft("dueMonth", value)}
              />
            </div>
            <div className="entry-control-field">
              <MoneyInput
                label={goalDraft.goalType === "recurring" ? "1回あたり予算" : "目標額"}
                value={goalDraft.requiredAmount}
                onChange={(value) => updateGoalDraft("requiredAmount", value)}
              />
            </div>
            {goalDraft.goalType === "recurring" ? (
              <label>
                頻度
                <select value={goalDraft.recurrence} onChange={(event) => updateGoalDraft("recurrence", event.target.value as RecurrenceInterval)}>
                  <option value="yearly">年1回</option>
                  <option value="halfYearly">半年に1回</option>
                  <option value="quarterly">3ヶ月に1回</option>
                  <option value="monthly">毎月</option>
                </select>
              </label>
            ) : (
              <div className="entry-control-field">
                <MoneyInput label="達成済み額" value={goalDraft.savedAmount} onChange={(value) => updateGoalDraft("savedAmount", value)} />
              </div>
            )}
            <div className="entry-control-field">
              <MoneyInput
                label={goalDraft.goalType === "recurring" ? "毎月確保する額" : "毎月この目標に回す額"}
                value={goalDraft.monthlyAllocation}
                onChange={(value) => updateGoalDraft("monthlyAllocation", value)}
              />
            </div>
            <label className="entry-field-wide">
              メモ
              <input value={goalDraft.memo} onChange={(event) => updateGoalDraft("memo", event.target.value)} placeholder="前提や目的を残せます" />
            </label>
          </div>
          <div className="entry-form-actions">
            <span role="status" aria-live="polite">{goalFormStatus}</span>
            <button type="submit">目標を登録</button>
          </div>
        </form>
        <div className="registered-list-heading">
          <div>
            <h2>登録済みの目標</h2>
            <p>登録後も、一覧から内容を変更できます。</p>
          </div>
          <span>{plan.goals.length}件</span>
        </div>
        {plan.goals.length > 0 && (
          <div className={`notice-band ${goalFunding.overAllocatedAmount > 0 ? "notice" : "check"}`}>
            <strong>
              {goalFunding.monthlyAvailable < 0
                ? "目標配分の前に家計収支を確認してください"
                : goalFunding.overAllocatedAmount > 0
                  ? "目標への配分が毎月の家計余剰を上回っています"
                  : "目標への毎月配分は家計余剰の範囲内です"}
            </strong>
            <span>
              {goalFunding.monthlyAvailable < 0
                ? `通常月の家計収支が${manYen(Math.abs(goalFunding.monthlyAvailable))}不足し、目標には毎月${manYen(goalFunding.monthlyAllocated)}を配分中です。`
                : goalFunding.overAllocatedAmount > 0
                  ? `目標配分 ${manYen(goalFunding.monthlyAllocated)} / 家計余剰 ${manYen(goalFunding.monthlyAvailable)}。毎月 ${manYen(goalFunding.overAllocatedAmount)} 超過しています。`
                  : `目標配分 ${manYen(goalFunding.monthlyAllocated)} / 家計余剰 ${manYen(goalFunding.monthlyAvailable)} / 配分後 ${manYen(goalFunding.monthlyRemaining)}。`}
              ボーナス年額はこの毎月配分の比較に含めていません。
            </span>
          </div>
        )}
        <div className="list-toolbar" aria-label="目標の検索と並び替え">
          <label>
            目標を検索
            <input value={goalSearch} onChange={(event) => setGoalSearch(event.target.value)} placeholder="目標名やメモで検索" />
          </label>
          <label>
            並び替え
            <select value={goalSort} onChange={(event) => setGoalSort(event.target.value as "dueYear" | "priority" | "progress" | "title")}>
              <option value="dueYear">期限が近い順</option>
              <option value="priority">優先度順</option>
              <option value="progress">達成率が高い順</option>
              <option value="title">名前順</option>
            </select>
          </label>
          <label>
            表示
            <select value={goalViewMode} onChange={(event) => setGoalViewMode(event.target.value as "detail" | "compact")}>
              <option value="detail">詳細編集</option>
              <option value="compact">短いリスト</option>
            </select>
          </label>
          <span>{goalAchievements.length}件表示 / 全{plan.goals.length}件</span>
        </div>
        {goalViewMode === "compact" ? (
          <div className="compact-list" aria-label="目標の短いリスト">
            {plan.goals.length === 0 ? (
              <EmptyState title="まだ目標がありません" detail="上の入力欄に内容を入力し、「目標を登録」を押してください。" />
            ) : goalAchievements.length === 0 ? (
              <EmptyState title="条件に合う目標がありません" detail="検索文字を変えるか、並び替えを戻して確認してください。" />
            ) : (
              goalAchievements.map(({ goal, achievement }) => {
                const preparedPercent = getGoalPreparedPercent(goal);
                return (
                  <div className="compact-list-row" key={goal.id}>
                    <label className="compact-title-field">
                      目標名
                      <input value={goal.title} onChange={(event) => updateGoal(goal.id, "title", event.target.value)} />
                    </label>
                    <div className="compact-summary">
                      <span>{goal.goalType === "recurring" ? "繰り返し" : "1回限り"}</span>
                      <strong>{goal.dueYear}年{goal.dueMonth}月 / {getTargetAgeForYear(plan.profile.age, goal.dueYear)}歳頃</strong>
                      <small>{achievement.status === "recurring" ? `年間必要額 ${manYen(achievement.annualRequiredAmount)}` : `残り ${manYen(achievement.shortfall)}`}</small>
                    </div>
                    <label>
                      目標額
                      <NumericInput value={goal.requiredAmount} min={0} max={MAX_MONEY_AMOUNT} onChange={(value) => updateGoal(goal.id, "requiredAmount", value)} />
                    </label>
                    <label>
                      優先度
                      <select value={goal.priority} onChange={(event) => updateGoal(goal.id, "priority", event.target.value as Priority)}>
                        {Object.entries(priorityLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="compact-progress">
                      <span>{goal.goalType === "recurring" ? "年間準備率" : "達成率"} {preparedPercent}%</span>
                      <div className="goal-progress-track">
                        <span style={{ width: `${preparedPercent}%` }} />
                      </div>
                    </div>
                    <button type="button" className="text-button" onClick={() => removeGoal(goal.id)}>
                      削除
                    </button>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <>
          <div className="table-wrap desktop-table goal-table-wrap">
        <table className="goal-table">
          <thead>
            <tr>
              <th>目標名</th>
              <th>種類</th>
              <th>期限</th>
              <th>金額</th>
              <th>優先度</th>
              <th>準備/頻度</th>
              <th>達成目安</th>
              <th>メモ</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {plan.goals.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  <EmptyState title="まだ目標がありません" detail="上の入力欄に内容を入力し、「目標を登録」を押してください。" />
                </td>
              </tr>
            ) : goalAchievements.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  <EmptyState title="条件に合う目標がありません" detail="検索文字を変えるか、並び替えを戻して確認してください。" />
                </td>
              </tr>
            ) : (
              goalAchievements.map(({ goal }) => (
                <tr key={goal.id}>
                  <td>
                    <input value={goal.title} onChange={(event) => updateGoal(goal.id, "title", event.target.value)} />
                  </td>
                  <td>
                    <select value={goal.goalType} onChange={(event) => updateGoal(goal.id, "goalType", event.target.value as Goal["goalType"])}>
                      <option value="oneTime">1回限り</option>
                      <option value="recurring">繰り返し</option>
                    </select>
                  </td>
                  <td>
                    <GoalDeadlineInput
                      dueYear={goal.dueYear}
                      dueMonth={goal.dueMonth}
                      currentAge={plan.profile.age}
                      onYearChange={(value) => updateGoal(goal.id, "dueYear", value)}
                      onMonthChange={(value) => updateGoal(goal.id, "dueMonth", value)}
                    />
                  </td>
                  <td>
                    <GoalAmountInput goal={goal} updateGoal={updateGoal} />
                  </td>
                  <td>
                    <select value={goal.priority} onChange={(event) => updateGoal(goal.id, "priority", event.target.value as Priority)}>
                      {Object.entries(priorityLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <GoalPreparationInput goal={goal} updateGoal={updateGoal} />
                  </td>
                  <td>
                    <GoalAchievementSummary goal={goal} achievement={getGoalAchievement(plan, goal)} />
                  </td>
                  <td>
                    <input value={goal.memo} onChange={(event) => updateGoal(goal.id, "memo", event.target.value)} />
                  </td>
                  <td>
                    <button type="button" className="text-button" onClick={() => removeGoal(goal.id)}>
                      削除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
        <div className="mobile-card-list">
        {plan.goals.length === 0 ? (
          <EmptyState title="まだ目標がありません" detail="上の入力欄に内容を入力し、「目標を登録」を押してください。" />
        ) : goalAchievements.length === 0 ? (
          <EmptyState title="条件に合う目標がありません" detail="検索文字を変えるか、並び替えを戻して確認してください。" />
        ) : (
          goalAchievements.map(({ goal, achievement }) => (
            <div className="mobile-record" key={goal.id}>
              <div className="mobile-record-head">
                <label className="mobile-record-title">
                  目標名
                  <input value={goal.title} onChange={(event) => updateGoal(goal.id, "title", event.target.value)} />
                </label>
                <GoalAchievementBadge achievement={achievement} />
              </div>
              <div className="mobile-edit-grid">
                <label>
                  種類
                  <select value={goal.goalType} onChange={(event) => updateGoal(goal.id, "goalType", event.target.value as Goal["goalType"])}>
                    <option value="oneTime">1回限り</option>
                    <option value="recurring">繰り返し</option>
                  </select>
                </label>
                <label>
                  優先度
                  <select value={goal.priority} onChange={(event) => updateGoal(goal.id, "priority", event.target.value as Priority)}>
                    {Object.entries(priorityLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="mobile-field-wide">
                  <span>期限</span>
                  <GoalDeadlineInput
                    dueYear={goal.dueYear}
                    dueMonth={goal.dueMonth}
                    currentAge={plan.profile.age}
                    onYearChange={(value) => updateGoal(goal.id, "dueYear", value)}
                    onMonthChange={(value) => updateGoal(goal.id, "dueMonth", value)}
                  />
                </div>
                <div className="mobile-field-wide">
                  <GoalAmountInput goal={goal} updateGoal={updateGoal} />
                </div>
                <div className="mobile-field-wide">
                  <GoalPreparationInput goal={goal} updateGoal={updateGoal} />
                </div>
                <label className="mobile-field-wide">
                  メモ
                  <input value={goal.memo} onChange={(event) => updateGoal(goal.id, "memo", event.target.value)} />
                </label>
              </div>
              <GoalAchievementSummary goal={goal} achievement={achievement} />
              <button type="button" className="text-button mobile-delete-button" onClick={() => removeGoal(goal.id)}>
                削除
              </button>
            </div>
          ))
        )}
        </div>
          </>
        )}
      </section>
      <StepFlowNav
        setActiveView={setActiveView}
        previous={{ view: "budget", label: "予算・実績" }}
        next={{ view: "simulation", label: "シミュレーション" }}
      />
    </div>
  );
}

function GoalDeadlineInput({
  dueYear,
  dueMonth,
  currentAge,
  onYearChange,
  onMonthChange
}: {
  dueYear: number;
  dueMonth: number;
  currentAge: number;
  onYearChange: (value: number) => void;
  onMonthChange: (value: number) => void;
}) {
  return (
    <div className="goal-deadline-control">
      <YearAgeInput year={dueYear} currentAge={currentAge} ageLabel="達成したい年齢" onChange={onYearChange} />
      <label>
        達成したい月
        <select value={dueMonth} onChange={(event) => onMonthChange(Number(event.target.value))}>
          {monthLabels.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
        </select>
      </label>
    </div>
  );
}

function GoalAmountInput({
  goal,
  updateGoal
}: {
  goal: Goal;
  updateGoal: <K extends keyof Goal>(id: string, key: K, value: Goal[K]) => void;
}) {
  return (
    <div className="goal-field-stack">
      <MoneyInput
        label={goal.goalType === "recurring" ? "1回あたり予算" : "目標額"}
        value={goal.requiredAmount}
        onChange={(value) => updateGoal(goal.id, "requiredAmount", value)}
      />
      {goal.goalType === "recurring" && <small>年間目安: {manYen(goal.requiredAmount * recurrenceCount(goal.recurrence))}</small>}
    </div>
  );
}

function GoalPreparationInput({
  goal,
  updateGoal
}: {
  goal: Goal;
  updateGoal: <K extends keyof Goal>(id: string, key: K, value: Goal[K]) => void;
}) {
  if (goal.goalType === "recurring") {
    return (
      <div className="goal-field-stack">
        <label>
          頻度
          <select
            value={goal.recurrence}
            onChange={(event) => updateGoal(goal.id, "recurrence", event.target.value as RecurrenceInterval)}
          >
            <option value="yearly">年1回</option>
            <option value="halfYearly">半年に1回</option>
            <option value="quarterly">3ヶ月に1回</option>
            <option value="monthly">毎月</option>
          </select>
        </label>
        <MoneyInput
          label="毎月確保する額"
          value={goal.monthlyAllocation}
          onChange={(value) => updateGoal(goal.id, "monthlyAllocation", value)}
        />
      </div>
    );
  }

  return (
    <div className="goal-field-stack">
      <MoneyInput label="達成済み額" value={goal.savedAmount} onChange={(value) => updateGoal(goal.id, "savedAmount", value)} />
      <MoneyInput
        label="毎月この目標に回す額"
        value={goal.monthlyAllocation}
        onChange={(value) => updateGoal(goal.id, "monthlyAllocation", value)}
      />
    </div>
  );
}

function GoalAchievementSummary({ goal, achievement }: { goal: Goal; achievement: ReturnType<typeof getGoalAchievement> }) {
  const preparedPercent = getGoalPreparedPercent(goal);

  return (
    <div className="goal-achievement-summary">
      <div className="goal-progress">
        <div>
          <span>{goal.goalType === "recurring" ? "年間準備率" : "達成率"}</span>
          <strong>{preparedPercent}%</strong>
        </div>
        <div className="goal-progress-track" aria-label={`${goal.goalType === "recurring" ? "年間準備率" : "達成率"} ${preparedPercent}%`}>
          <span style={{ width: `${preparedPercent}%` }} />
        </div>
      </div>
      <GoalAchievementBadge achievement={achievement} />
      <small>{achievement.note}</small>
      {achievement.status === "recurring" && <small>年間必要額: {manYen(achievement.annualRequiredAmount)}</small>}
      {achievement.monthsToTarget ? <small>到達まで: 約{achievement.monthsToTarget}ヶ月</small> : null}
    </div>
  );
}

function recurrenceCount(recurrence: RecurrenceInterval) {
  const counts: Record<RecurrenceInterval, number> = {
    monthly: 12,
    quarterly: 4,
    halfYearly: 2,
    yearly: 1
  };
  return counts[recurrence];
}

function GoalAchievementBadge({ achievement }: { achievement: ReturnType<typeof getGoalAchievement> }) {
  const label =
    achievement.status === "recurring"
      ? "継続目標"
      : achievement.status === "achieved"
      ? "達成済み"
      : achievement.targetAge
        ? `${achievement.targetAge}歳頃`
        : "毎月の配分未設定";

  return <span className={`status-pill ${achievement.status}`}>{label}</span>;
}
