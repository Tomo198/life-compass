import { useState } from "react";
import { LineChart } from "../components/Charts";
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
  removeReview,
  applyBudgetActualsToReviewRecord,
  addScenarioFromReview
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
  applyBudgetActualsToReviewRecord: (id: string) => boolean;
  addScenarioFromReview: (id: string) => boolean;
}) {
  const [reviewMessage, setReviewMessage] = useState("");
  const sortedReviews = [...(plan.reviews || [])].sort((a, b) => b.date.localeCompare(a.date));
  const chronologicalReviews = [...(plan.reviews || [])].sort((a, b) => a.date.localeCompare(b.date));
  const previousReviewById = new Map<string, ReviewNote | undefined>();
  chronologicalReviews.forEach((review, index) => previousReviewById.set(review.id, chronologicalReviews[index - 1]));
  const latestReview = sortedReviews[0];
  const openTodoCount = (plan.reviews || []).filter((review) => review.todo && !review.todoDone).length;
  const reviewMonthKey = latestReview?.date ? latestReview.date.slice(0, 7) : new Date().toISOString().slice(0, 7);
  const reviewBudgetSummary = getBudgetSummary(plan.budgetItems || [], reviewMonthKey);
  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const currentMonthReview = sortedReviews.find(
    (review) => review.reviewType === "monthly" && review.date.slice(0, 7) === currentMonthKey
  );
  const activeScenarioName = plan.activeScenario?.name || latestReview?.scenarioName || "基本プラン";
  const reviewTrendPoints = chronologicalReviews
    .filter((review) => review.actualNetAssets !== undefined)
    .map((review, index) => ({
      year: index,
      label: review.date.slice(0, 7).replace("-", "/"),
      value: review.actualNetAssets ?? 0
    }));

  const handleApplyBudgetActuals = (review: ReviewNote) => {
    if (applyBudgetActualsToReviewRecord(review.id)) {
      setReviewMessage(`${review.date.slice(0, 7)}の予算・実績をレビューへ反映しました。`);
      return;
    }
    setReviewMessage("対象月の予算・実績を全項目入力してから反映してください。");
  };

  const handleCreateReviewScenario = () => {
    if (!latestReview || !addScenarioFromReview(latestReview.id)) return;
    setActiveView("scenarios");
  };

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
        <section className="pro-hero">
          <div>
            <p className="eyebrow">Pro / レビューセンター</p>
            <h2>計画と実績の差を、次の見直しへつなげる</h2>
            <p>月次・四半期の実績、採用したシナリオ、将来見通し、次回TODOを同じ履歴として残します。</p>
          </div>
          <span className="lock-badge">Pro</span>
        </section>
      )}

      {mode === "reviews" && (
        <section className="panel review-center">
          <div className="section-heading">
            <div>
              <h2>今月の見直し</h2>
              <p>現在の計画を基準として保存し、実際の純資産と家計余剰を比較します。</p>
            </div>
            <button type="button" disabled={Boolean(currentMonthReview)} onClick={addReview}>
              {currentMonthReview ? "今月分は作成済み" : "今月のレビューを作成"}
            </button>
          </div>

          <div className="calculation-band compact">
            <Metric label="採用中の計画" value={activeScenarioName} helper={plan.activeScenario ? `${plan.activeScenario.adoptedAt.slice(0, 10)} 採用` : "基本プラン"} />
            <Metric label="最終レビュー" value={latestReview?.date || "未実施"} helper={`${sortedReviews.length}件の履歴`} />
            <Metric label="未完了TODO" value={`${openTodoCount}件`} helper="次回確認すること" />
            <Metric
              label="予算実績"
              value={
                plan.budgetItems.length > 0 && reviewBudgetSummary.actualEntryCount === plan.budgetItems.length
                  ? "入力済み"
                  : `${reviewBudgetSummary.actualEntryCount}/${plan.budgetItems.length}件`
              }
              helper={`${reviewMonthKey}の入力状況`}
            />
          </div>

          <div className="review-cycle-actions">
            <button type="button" className="secondary" onClick={() => setActiveView("budget")}>予算・実績を確認</button>
            <button type="button" className="secondary" disabled={!latestReview} onClick={handleCreateReviewScenario}>最新レビューから見直し案を作る</button>
          </div>
          {reviewMessage && <p className="success-text" role="status">{reviewMessage}</p>}

          {sortedReviews.length === 0 ? (
            <EmptyState title="まだレビューがありません" detail="最初のレビューを作ると、その時点の10年・30年見通しと目標到達目安も一緒に保存されます。" />
          ) : (
            <>
              {reviewTrendPoints.length >= 2 && (
                <div className="review-trend-section">
                  <div className="section-heading">
                    <div>
                      <h3>純資産の実績推移</h3>
                      <p>レビューごとに入力した実際の純資産を確認します。</p>
                    </div>
                    <span className="status-pill recurring">{reviewTrendPoints.length}回分</span>
                  </div>
                  <LineChart points={reviewTrendPoints} />
                </div>
              )}

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
                        <span className="status-pill recurring">基準: {review.scenarioName || "基本プラン"}</span>
                        <button type="button" className="text-button" onClick={() => removeReview(review.id)}>削除</button>
                      </div>
                      <div className="review-input-grid">
                        <MoneyInput label="実際の純資産" value={actualNetAssets} onChange={(value) => updateReview(review.id, "actualNetAssets", value)} />
                        <MoneyInput label="実際の通常月の家計余剰" value={actualMonthlySavings} onChange={(value) => updateReview(review.id, "actualMonthlySavings", value)} />
                        <MoneyInput label="実際の支出（月合計）" value={review.actualMonthlyExpenses ?? 0} onChange={(value) => updateReview(review.id, "actualMonthlyExpenses", value)} />
                        <label className="review-memo-field">
                          メモ
                          <input value={review.memo} onChange={(event) => updateReview(review.id, "memo", event.target.value)} placeholder="例: ボーナス支給、旅行支出、固定費見直しなど" />
                        </label>
                        <label className="review-memo-field">
                          次回TODO
                          <input value={review.todo || ""} onChange={(event) => updateReview(review.id, "todo", event.target.value)} placeholder="例: 通信費を確認、目標額を見直す" />
                        </label>
                        <label className="todo-check-field">
                          <input type="checkbox" checked={Boolean(review.todoDone)} onChange={(event) => updateReview(review.id, "todoDone", event.target.checked)} />
                          <span>TODO完了</span>
                        </label>
                      </div>
                      <div className="review-record-actions">
                        <button type="button" className="secondary" onClick={() => handleApplyBudgetActuals(review)}>この月の予算・実績を反映</button>
                      </div>
                      <div className="review-metrics">
                        <Metric label="純資産の計画差" value={manYen(netAssetGap)} helper={`予定 ${manYen(plannedNetAssets)}`} />
                        <Metric label="家計余剰の計画差" value={manYen(monthlySavingsGap)} helper={`予定 ${manYen(plannedMonthlySavings)}`} />
                        <Metric label="前回レビュー比" value={previousNetAssetGap === null ? "-" : manYen(previousNetAssetGap)} helper={previousReview ? `${previousReview.date} と比較` : "次回から表示"} />
                        <Metric label="10年後見通し" value={review.plannedTenYearAssets === undefined ? "-" : manYen(review.plannedTenYearAssets)} helper="レビュー作成時の試算" />
                        <Metric label="30年後見通し" value={review.plannedThirtyYearAssets === undefined ? "-" : manYen(review.plannedThirtyYearAssets)} helper="レビュー作成時の試算" />
                        <Metric
                          label="主要目標の目安"
                          value={review.plannedGoalTargetAge == null ? "-" : `${review.plannedGoalTargetAge}歳頃`}
                          helper={review.plannedGoalTitle || "目標未設定"}
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
    </div>
  );
}
