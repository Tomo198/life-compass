import { EmptyState, Metric, MoneyInput, NumericInput, StepFlowNav, StepTitle } from "../components/CommonUi";
import { MAX_PLAN_YEAR } from "../config";
import { eventOwnerLabels, monthLabels } from "../data/labels";
import type {
  EventOwner,
  LifePlan,
  PlanNotes,
  ReviewNote,
  TimelineMemo,
  ViewKey
} from "../types";
import { getBudgetSummary, manYen } from "../utils/calculations";

export function NotesView({
  mode,
  plan,
  setActiveView,
  updateNotes,
  addTimelineMemo,
  updateTimelineMemo,
  removeTimelineMemo,
  addReview,
  updateReview,
  removeReview
}: {
  mode: "notes" | "reviews";
  plan: LifePlan;
  setActiveView: (view: ViewKey) => void;
  updateNotes: <K extends keyof PlanNotes>(key: K, value: PlanNotes[K]) => void;
  addTimelineMemo: () => void;
  updateTimelineMemo: <K extends keyof TimelineMemo>(id: string, key: K, value: TimelineMemo[K]) => void;
  removeTimelineMemo: (id: string) => void;
  addReview: () => void;
  updateReview: <K extends keyof ReviewNote>(id: string, key: K, value: ReviewNote[K]) => void;
  removeReview: (id: string) => void;
}) {
  const sortedReviews = [...(plan.reviews || [])].sort((a, b) => b.date.localeCompare(a.date));
  const chronologicalReviews = [...(plan.reviews || [])].sort((a, b) => a.date.localeCompare(b.date));
  const previousReviewById = new Map<string, ReviewNote | undefined>();
  chronologicalReviews.forEach((review, index) => previousReviewById.set(review.id, chronologicalReviews[index - 1]));
  const latestReview = sortedReviews[0];
  const latestPreviousReview = latestReview ? previousReviewById.get(latestReview.id) : undefined;
  const latestNetAssetDiff =
    latestReview?.actualNetAssets === undefined || latestPreviousReview?.actualNetAssets === undefined
      ? null
      : latestReview.actualNetAssets - latestPreviousReview.actualNetAssets;
  const openTodoCount = (plan.reviews || []).filter((review) => review.todo && !review.todoDone).length;
  const reviewMonthKey = latestReview?.date ? latestReview.date.slice(0, 7) : new Date().toISOString().slice(0, 7);
  const reviewBudgetSummary = getBudgetSummary(plan.budgetItems || [], reviewMonthKey);

  return (
    <div className="view-stack">
      {mode === "notes" && (
      <section className="panel form-panel">
        <StepTitle step="9" title="メモ" description="今の前提や次の見直しを1つのプラン内に保存できます。" />
        <div className="notes-grid">
          <label>
            現在の考え・見直しメモ
            <textarea
              value={plan.notes?.general || ""}
              onChange={(event) => updateNotes("general", event.target.value)}
              placeholder="例: 住宅購入は3年後に再検討。まず生活防衛資金を6ヶ月分まで増やす。"
            />
          </label>
          <label>
            支出見直しメモ
            <textarea
              value={plan.notes?.spendingReview || ""}
              onChange={(event) => updateNotes("spendingReview", event.target.value)}
              placeholder="例: 通信費、サブスク、保険、車、家賃など。"
            />
          </label>
        </div>
        <div className="section-heading timeline-memo-heading">
          <div>
            <h3>年表に表示する予定メモ</h3>
            <p>検討時期や確認したいことを月単位で登録できます。資産試算には影響しません。</p>
          </div>
          <button type="button" className="secondary" onClick={addTimelineMemo}>予定メモを追加</button>
        </div>
        {(plan.timelineMemos || []).length === 0 ? (
          <EmptyState title="年表用の予定メモはありません" detail="必要なときだけ追加できます。通常のメモはこのまま保存されます。" />
        ) : (
          <div className="timeline-memo-list">
            {(plan.timelineMemos || []).map((memo) => (
              <div className="timeline-memo-row" key={memo.id}>
                <label>
                  タイトル
                  <input value={memo.title} onChange={(event) => updateTimelineMemo(memo.id, "title", event.target.value)} />
                </label>
                <label>
                  年
                  <NumericInput value={memo.year} min={new Date().getFullYear()} max={MAX_PLAN_YEAR} onChange={(value) => updateTimelineMemo(memo.id, "year", value)} />
                </label>
                <label>
                  月
                  <select value={memo.month} onChange={(event) => updateTimelineMemo(memo.id, "month", Number(event.target.value))}>
                    {monthLabels.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
                  </select>
                </label>
                <label>
                  対象者
                  <select value={memo.owner} onChange={(event) => updateTimelineMemo(memo.id, "owner", event.target.value as EventOwner)}>
                    {Object.entries(eventOwnerLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="timeline-memo-text">
                  内容
                  <input value={memo.memo} onChange={(event) => updateTimelineMemo(memo.id, "memo", event.target.value)} />
                </label>
                <label className="timeline-memo-toggle">
                  <input type="checkbox" checked={memo.showOnTimeline} onChange={(event) => updateTimelineMemo(memo.id, "showOnTimeline", event.target.checked)} />
                  年表に表示
                </label>
                <button type="button" className="text-button" onClick={() => removeTimelineMemo(memo.id)}>削除</button>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {mode === "notes" && (
        <StepFlowNav
          setActiveView={setActiveView}
          previous={{ view: "timeline", label: "年表" }}
          next={{ view: "data", label: "データ管理" }}
        />
      )}

      {mode === "reviews" && (
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>レビュー履歴</h2>
            <p>月次・四半期で、予定値と実績値、前回比、次回TODOを残します。</p>
          </div>
          <button type="button" onClick={addReview}>
            レビューを追加
          </button>
        </div>
        {sortedReviews.length === 0 ? (
          <EmptyState title="まだレビューがありません" detail="レビューを追加すると、予定値と実績値、前回比、次回TODOを残せます。" />
        ) : (
          <>
          <div className="calculation-band compact">
            <Metric label="レビュー件数" value={`${sortedReviews.length}件`} helper="ブラウザ内保存" />
            <Metric label="未完了TODO" value={`${openTodoCount}件`} helper="次回確認すること" />
            <Metric label="最新の前回比" value={latestNetAssetDiff === null ? "-" : manYen(latestNetAssetDiff)} helper="実際の純資産" />
            <Metric
              label="予算との差"
              value={
                plan.budgetItems.length > 0 && reviewBudgetSummary.actualEntryCount === plan.budgetItems.length
                  ? manYen(reviewBudgetSummary.variance)
                  : reviewBudgetSummary.actualEntryCount > 0
                    ? "入力途中"
                    : "未入力"
              }
              helper={`${reviewMonthKey} / 全項目入力後に判定`}
            />
          </div>
          <div className="review-list">
            {sortedReviews.map((review) => {
              const previousReview = previousReviewById.get(review.id);
              const actualNetAssets = review.actualNetAssets ?? 0;
              const actualMonthlySavings = review.actualMonthlySavings ?? 0;
              const plannedNetAssets = review.plannedNetAssets ?? 0;
              const plannedMonthlySavings = review.plannedMonthlySavings ?? 0;
              const netAssetGap = actualNetAssets - plannedNetAssets;
              const monthlySavingsGap = actualMonthlySavings - plannedMonthlySavings;
              const previousNetAssetGap =
                previousReview?.actualNetAssets === undefined ? null : actualNetAssets - previousReview.actualNetAssets;

              return (
                <div className="review-record" key={review.id}>
                  <div className="review-record-head">
                    <label>
                      確認日
                      <input type="date" value={review.date} onChange={(event) => updateReview(review.id, "date", event.target.value)} />
                    </label>
                    <label>
                      確認区分
                      <select
                        value={review.reviewType || "monthly"}
                        onChange={(event) => updateReview(review.id, "reviewType", event.target.value as ReviewNote["reviewType"])}
                      >
                        <option value="monthly">月次レビュー</option>
                        <option value="quarterly">四半期レビュー</option>
                      </select>
                    </label>
                    <button type="button" className="text-button" onClick={() => removeReview(review.id)}>
                      削除
                    </button>
                  </div>
                  <div className="review-input-grid">
                    <MoneyInput
                      label="実際の純資産"
                      value={actualNetAssets}
                      onChange={(value) => updateReview(review.id, "actualNetAssets", value)}
                    />
                    <MoneyInput
                      label="実際の毎月貯蓄"
                      value={actualMonthlySavings}
                      onChange={(value) => updateReview(review.id, "actualMonthlySavings", value)}
                    />
                    <label className="review-memo-field">
                      メモ
                      <input
                        value={review.memo}
                        onChange={(event) => updateReview(review.id, "memo", event.target.value)}
                        placeholder="例: ボーナス支給、旅行支出、固定費見直しなど"
                      />
                    </label>
                    <label className="review-memo-field">
                      次回TODO
                      <input
                        value={review.todo || ""}
                        onChange={(event) => updateReview(review.id, "todo", event.target.value)}
                        placeholder="例: 通信費を確認、目標額を見直す"
                      />
                    </label>
                    <label className="todo-check-field">
                      <input
                        type="checkbox"
                        checked={Boolean(review.todoDone)}
                        onChange={(event) => updateReview(review.id, "todoDone", event.target.checked)}
                      />
                      <span>TODO完了</span>
                    </label>
                  </div>
                  <div className="review-metrics">
                    <Metric label="予定との差" value={manYen(netAssetGap)} helper={`予定純資産 ${manYen(plannedNetAssets)}`} />
                    <Metric label="毎月貯蓄の差" value={manYen(monthlySavingsGap)} helper={`予定 ${manYen(plannedMonthlySavings)}`} />
                    <Metric
                      label="前回比"
                      value={previousNetAssetGap === null ? "-" : manYen(previousNetAssetGap)}
                      helper={previousReview ? `${previousReview.date} と比較` : "次回から表示"}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          </>
        )}
      </section>
      )}

      {mode === "reviews" && (
      <section className="panel">
        <h2>無料版とPro版の境界</h2>
        <div className="boundary-grid">
          <div>
            <strong>無料版</strong>
            <p>単一プランのメモとして保存します。ブラウザ内保存とJSONバックアップに含まれます。</p>
          </div>
          <div>
            <strong>Pro予定</strong>
            <p>複数回のレビュー履歴、前回との差分、TODO管理、シナリオ別の見直し記録を拡張予定です。</p>
          </div>
        </div>
      </section>
      )}
    </div>
  );
}
