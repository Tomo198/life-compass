import { useState } from "react";
import { LineChart } from "../components/Charts";
import { EmptyState, Metric, MoneyInput, NumericInput, StepFlowNav, StepTitle } from "../components/CommonUi";
import { MAX_PLAN_REVISIONS, MAX_PLAN_YEAR } from "../config";
import { eventOwnerLabels, monthLabels } from "../data/labels";
import { featureTiers } from "../features";
import type {
  EventOwner,
  LifePlan,
  PlanNotes,
  PlanRevisionSource,
  ReviewNote,
  TimelineMemo,
  ViewKey
} from "../types";
import { getAssetSummary, getBudgetSummary, getCashflowSummary, manYen } from "../utils/calculations";
import {
  createReviewScenarioSnapshot,
  type ReviewScenarioOptions
} from "../utils/reviews";

const planRevisionSourceLabels: Record<PlanRevisionSource, string> = {
  manual: "手動保存",
  review: "レビュー作成時",
  scenarioAdoption: "シナリオ採用前",
  beforeRestore: "復元前"
};

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
  addScenarioFromReview,
  saveCurrentPlanRevision,
  restorePlanRevision,
  removePlanRevision
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
  addScenarioFromReview: (id: string, options: ReviewScenarioOptions) => boolean;
  saveCurrentPlanRevision: () => boolean;
  restorePlanRevision: (id: string) => boolean;
  removePlanRevision: (id: string) => boolean;
}) {
  const [reviewMessage, setReviewMessage] = useState("");
  const [revisionMessage, setRevisionMessage] = useState("");
  const [isReviewScenarioBuilderOpen, setIsReviewScenarioBuilderOpen] = useState(false);
  const [reviewScenarioOptions, setReviewScenarioOptions] = useState<ReviewScenarioOptions>({
    applyActualNetAssets: true,
    applyActualMonthlyExpenses: true
  });
  const sortedReviews = [...(plan.reviews || [])].sort((a, b) => b.date.localeCompare(a.date));
  const chronologicalReviews = [...(plan.reviews || [])].sort((a, b) => a.date.localeCompare(b.date));
  const previousReviewById = new Map<string, ReviewNote | undefined>();
  chronologicalReviews.forEach((review, index) => previousReviewById.set(review.id, chronologicalReviews[index - 1]));
  const latestReview = sortedReviews[0];
  const canApplyReviewNetAssets = latestReview?.actualNetAssets !== undefined;
  const canApplyReviewExpenses = latestReview?.actualMonthlyExpenses !== undefined;
  const hasSelectedReviewActual =
    (reviewScenarioOptions.applyActualNetAssets && canApplyReviewNetAssets) ||
    (reviewScenarioOptions.applyActualMonthlyExpenses && canApplyReviewExpenses);
  const reviewScenarioSnapshot = latestReview
    ? createReviewScenarioSnapshot(plan, latestReview, reviewScenarioOptions)
    : null;
  const reviewScenarioAssets = reviewScenarioSnapshot ? getAssetSummary(reviewScenarioSnapshot.assets) : null;
  const reviewScenarioCashflow = reviewScenarioSnapshot ? getCashflowSummary(reviewScenarioSnapshot.household) : null;
  const openTodoCount = (plan.reviews || []).filter((review) => review.todo && !review.todoDone).length;
  const reviewMonthKey = latestReview?.date ? latestReview.date.slice(0, 7) : new Date().toISOString().slice(0, 7);
  const reviewBudgetSummary = getBudgetSummary(plan.budgetItems || [], reviewMonthKey);
  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const currentMonthReview = sortedReviews.find(
    (review) => review.reviewType === "monthly" && review.date.slice(0, 7) === currentMonthKey
  );
  const activeScenarioName = plan.activeScenario?.name || latestReview?.scenarioName || "基本プラン";
  const scenarioLimitReached = (plan.scenarios || []).length >= featureTiers.pro.scenarioLimit;
  const sortedPlanRevisions = [...(plan.planRevisions || [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
    if (!latestReview) return;
    if (!addScenarioFromReview(latestReview.id, reviewScenarioOptions)) {
      setReviewMessage(
        scenarioLimitReached
          ? `比較案は最大${featureTiers.pro.scenarioLimit}件です。不要な案を削除してから追加してください。`
          : "見直し案を保存できませんでした。ブラウザの保存状態を確認してください。"
      );
      return;
    }
    setIsReviewScenarioBuilderOpen(false);
    setActiveView("scenarios");
  };

  const handleSaveCurrentRevision = () => {
    setReviewMessage(
      saveCurrentPlanRevision()
        ? "現在の計画を版履歴へ保存しました。"
        : "計画を保存できませんでした。ブラウザの保存状態を確認してください。"
    );
  };

  const handleRestoreRevision = (id: string, title: string) => {
    if (!window.confirm(`「${title}」へ戻しますか？ 現在の計画も復元前の版として保存します。`)) return;
    setRevisionMessage(
      restorePlanRevision(id)
        ? `「${title}」へ戻しました。レビュー履歴と比較案は残しています。`
        : "計画を復元できませんでした。ブラウザの保存状態を確認してください。"
    );
  };

  const handleRemoveRevision = (id: string, title: string) => {
    if (!window.confirm(`「${title}」を版履歴から削除しますか？`)) return;
    setRevisionMessage(
      removePlanRevision(id)
        ? "保存した版を削除しました。"
        : "保存した版を削除できませんでした。"
    );
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
            <button
              type="button"
              className="secondary"
              disabled={!latestReview}
              onClick={() => setIsReviewScenarioBuilderOpen((current) => !current)}
            >
              最新レビューから見直し案を作る
            </button>
            <button type="button" className="secondary" onClick={handleSaveCurrentRevision}>現在の計画を版として保存</button>
          </div>
          {reviewMessage && <p className="success-text" role="status">{reviewMessage}</p>}

          {latestReview && isReviewScenarioBuilderOpen && reviewScenarioAssets && reviewScenarioCashflow && (
            <section className="review-scenario-builder" aria-labelledby="review-scenario-builder-title">
              <div className="section-heading">
                <div>
                  <h3 id="review-scenario-builder-title">実績を反映する項目</h3>
                  <p>選んだ実績だけを比較案へ仮反映します。基本プランは採用するまで変わりません。</p>
                </div>
                <button type="button" className="text-button" onClick={() => setIsReviewScenarioBuilderOpen(false)}>閉じる</button>
              </div>
              <div className="review-scenario-options">
                <label>
                  <input
                    type="checkbox"
                    aria-label="実際の純資産を反映"
                    checked={reviewScenarioOptions.applyActualNetAssets && canApplyReviewNetAssets}
                    disabled={!canApplyReviewNetAssets}
                    onChange={(event) => setReviewScenarioOptions((current) => ({ ...current, applyActualNetAssets: event.target.checked }))}
                  />
                  <span>
                    <strong>実際の純資産を反映</strong>
                    <small>純資産差を資産内訳へ仮反映します。内訳はシナリオ画面で調整できます。</small>
                  </span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    aria-label="実際の月間支出を反映"
                    checked={reviewScenarioOptions.applyActualMonthlyExpenses && canApplyReviewExpenses}
                    disabled={!canApplyReviewExpenses}
                    onChange={(event) => setReviewScenarioOptions((current) => ({ ...current, applyActualMonthlyExpenses: event.target.checked }))}
                  />
                  <span>
                    <strong>実際の月間支出を反映</strong>
                    <small>今回の支出が今後も続く仮定で、固定費・変動費・年間特別支出の比率へ反映します。</small>
                  </span>
                </label>
              </div>
              <div className="calculation-band compact review-scenario-preview">
                <Metric
                  label="純資産"
                  value={manYen(reviewScenarioAssets.netAssets)}
                  helper={`現在プラン ${manYen(getAssetSummary(plan.assets).netAssets)}`}
                />
                <Metric
                  label="月間支出"
                  value={manYen(reviewScenarioCashflow.monthlyLivingCost)}
                  helper={`現在プラン ${manYen(getCashflowSummary(plan.household).monthlyLivingCost)}`}
                />
                <Metric
                  label="通常月の家計余剰"
                  value={manYen(reviewScenarioCashflow.monthlySavings)}
                  helper="収入前提は現在プランと同じ"
                />
              </div>
              <div className="notice-band check">
                <strong>比較用の仮前提です</strong>
                <span>一時的な支出や相場変動を今後の前提に含めたくない場合は、該当項目のチェックを外してください。</span>
              </div>
              <div className="button-row review-scenario-builder-actions">
                <button
                  type="button"
                  disabled={!hasSelectedReviewActual}
                  onClick={handleCreateReviewScenario}
                >
                  この内容で見直し案を作る
                </button>
              </div>
            </section>
          )}

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

      {mode === "reviews" && (
        <section className="panel plan-revision-section">
          <div className="section-heading">
            <div>
              <h2>計画の版履歴</h2>
              <p>レビュー作成時とシナリオ採用前の計画を保存します。復元してもレビュー履歴と比較案は残ります。</p>
            </div>
            <span className="status-pill recurring">{sortedPlanRevisions.length}/{MAX_PLAN_REVISIONS}件</span>
          </div>
          {revisionMessage && <p className="success-text" role="status">{revisionMessage}</p>}
          {sortedPlanRevisions.length === 0 ? (
            <EmptyState title="保存した版はありません" detail="今月のレビューを作成するか、現在の計画を手動で保存すると、ここから以前の前提へ戻せます。" />
          ) : (
            <div className="plan-revision-list">
              {sortedPlanRevisions.map((revision) => {
                const assets = getAssetSummary(revision.snapshot.assets);
                const cashflow = getCashflowSummary(revision.snapshot.household);
                return (
                  <article className="plan-revision-item" key={revision.id}>
                    <div className="plan-revision-head">
                      <div>
                        <strong>{revision.title}</strong>
                        <span>{new Date(revision.createdAt).toLocaleString("ja-JP")}・{planRevisionSourceLabels[revision.source]}</span>
                      </div>
                      <span className="status-pill">{revision.snapshot.activeScenario?.name || "基本プラン"}</span>
                    </div>
                    <dl className="plan-revision-summary">
                      <div><dt>純資産</dt><dd>{manYen(assets.netAssets)}</dd></div>
                      <div><dt>通常月の家計余剰</dt><dd>{manYen(cashflow.monthlySavings)}</dd></div>
                      <div><dt>目標</dt><dd>{revision.snapshot.goals.length}件</dd></div>
                      <div><dt>イベント</dt><dd>{revision.snapshot.events.length}件</dd></div>
                    </dl>
                    <div className="button-row plan-revision-actions">
                      <button type="button" className="secondary" onClick={() => handleRestoreRevision(revision.id, revision.title)}>この版へ戻す</button>
                      <button type="button" className="text-button danger-text" onClick={() => handleRemoveRevision(revision.id, revision.title)}>削除</button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
