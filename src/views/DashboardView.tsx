import { useMemo } from "react";
import { Metric } from "../components/CommonUi";
import { LineChart } from "../components/Charts";
import type { LifePlan, ViewKey } from "../types";
import {
  emergencyMonthsLabel,
  getAssetSummary,
  getCurrentCashflowSummary,
  getEmergencyFundResult,
  getGoalAchievement,
  getGoalAchievements,
  getInputCompletion,
  getNextEvent,
  getPrimaryGoal,
  getRecurrenceLabel,
  getTargetAgeForYear,
  manYen,
  percent,
  projectAssets
} from "../utils/calculations";

type DashboardReminder = {
  id: string;
  title: string;
  detail: string;
  view: ViewKey;
};

type DashboardViewProps = {
  plan: LifePlan;
  reminders: DashboardReminder[];
  setActiveView: (view: ViewKey) => void;
  startEmptyPlan: () => void;
  proAccess: boolean;
};

type DashboardGuidance = {
  title: string;
  detail: string;
  view: ViewKey;
  tone: "notice" | "check" | "good";
};

const isSamplePlan = (plan: LifePlan) =>
  plan.profile.name === "マイプラン" &&
  plan.profile.age === 35 &&
  plan.goals.some((goal) => goal.title === "5年後に資産500万円") &&
  plan.events.some((event) => event.title === "資格取得");

const getDashboardGuidance = ({
  plan,
  cashflow,
  assets,
  emergency,
  completion
}: {
  plan: LifePlan;
  cashflow: ReturnType<typeof getCurrentCashflowSummary>;
  assets: ReturnType<typeof getAssetSummary>;
  emergency: ReturnType<typeof getEmergencyFundResult>;
  completion: ReturnType<typeof getInputCompletion>;
}): DashboardGuidance[] => {
  const items: DashboardGuidance[] = [];

  if (cashflow.monthlySavings < 0) {
    items.push({
      title: "毎月の収支を確認",
      detail: "支出が収入を上回る前提です。固定費・変動費の入力を見直すと全体の見通しが整います。",
      view: "household",
      tone: "notice"
    });
  }

  if (emergency.status === "short") {
    items.push({
      title: "生活防衛資金を確認",
      detail: `${emergency.lowerMonths}ヶ月分の目安まであと ${manYen(emergency.shortageToLower)} です。`,
      view: "simulation",
      tone: "check"
    });
  }

  if (assets.netAssets < 0) {
    items.push({
      title: "負債を含めた純資産を確認",
      detail: "負債を差し引くと純資産がマイナスの前提です。資産入力の内訳を確認できます。",
      view: "assets",
      tone: "notice"
    });
  }

  if (plan.goals.length === 0) {
    items.push({
      title: "目標を1つ追加",
      detail: "住宅、旅行、副業、資産形成など、まず1つだけ整理すると見返しやすくなります。",
      view: "goals",
      tone: "check"
    });
  }

  if (plan.events.length === 0) {
    items.push({
      title: "年表に予定を追加",
      detail: "転職、引越し、旅行、住宅購入などを入れると資産見通しに反映できます。",
      view: "timeline",
      tone: "check"
    });
  }

  if (completion.percentage >= 85 && items.length === 0) {
    items.push({
      title: "見通しを保存して見返す",
      detail: "入力がかなり揃っています。JSONバックアップやメモで今の前提を残せます。",
      view: "data",
      tone: "good"
    });
  }

  return items.slice(0, 3);
};

export function DashboardView({ plan, reminders, setActiveView, startEmptyPlan, proAccess }: DashboardViewProps) {
  const cashflow = getCurrentCashflowSummary(plan);
  const assets = getAssetSummary(plan.assets);
  const emergency = getEmergencyFundResult(plan);
  const projection = useMemo(() => projectAssets(plan, 30), [plan]);
  const tenYear = projection[10]?.value ?? assets.netAssets;
  const thirtyYear = projection[30]?.value ?? assets.netAssets;
  const primaryGoal = getPrimaryGoal(plan);
  const primaryGoalAchievement = primaryGoal ? getGoalAchievement(plan, primaryGoal) : null;
  const goalAchievements = getGoalAchievements(plan);
  const nextEvent = getNextEvent(plan.events);
  const completion = getInputCompletion(plan);
  const guidanceItems = getDashboardGuidance({ plan, cashflow, assets, emergency, completion });
  const missingItems = completion.items.filter((item) => !item.complete).slice(0, 3);
  const firstMissingView = completion.items.find((item) => !item.complete)?.view ?? "profile";
  const samplePlan = isSamplePlan(plan);
  const showStarterGuide = samplePlan || completion.percentage < 85;
  const sortedReviews = [...(plan.reviews || [])].sort((a, b) => b.date.localeCompare(a.date));
  const latestReview = sortedReviews[0];
  const latestReviewGap = latestReview
    ? (latestReview.actualNetAssets ?? 0) - (latestReview.plannedNetAssets ?? 0)
    : null;
  const openReviewTodoCount = sortedReviews.filter((review) => review.todo && !review.todoDone).length;
  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const hasCurrentMonthReview = sortedReviews.some(
    (review) => review.reviewType === "monthly" && review.date.slice(0, 7) === currentMonthKey
  );

  const handleStartEmptyPlan = () => {
    if (window.confirm("サンプルデータを消して、空のプランから入力を始めます。必要な場合は先にJSONエクスポートしてください。")) {
      startEmptyPlan();
      setActiveView("profile");
    }
  };

  return (
    <div className="view-stack">
      {showStarterGuide && (
        <section className="panel onboarding-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{samplePlan ? "サンプルプラン表示中" : "はじめての使い方"}</p>
              <h2>{samplePlan ? "自分のプランは空の状態から順番に作れます" : "まずは生活の全体像を入力します"}</h2>
              <p>
                {samplePlan
                  ? "現在の数値は使い方を確認するためのサンプルです。自分用に作る場合は、空のプランに切り替えて基本情報から入力すると迷いにくくなります。"
                  : "すべてを一度に埋めなくても大丈夫です。基本情報、資産、家計、予算・実績、目標、シミュレーション、イベント設定、年表の順に進められます。"}
              </p>
            </div>
            <div className="button-row">
              {samplePlan && (
                <button type="button" onClick={handleStartEmptyPlan}>
                  空のプランで始める
                </button>
              )}
              <button type="button" className={samplePlan ? "secondary" : ""} onClick={() => setActiveView(samplePlan ? "profile" : firstMissingView)}>
                {samplePlan ? "サンプルを編集する" : "次の入力へ"}
              </button>
            </div>
          </div>
          <div className="onboarding-steps" aria-label="入力の流れ">
            <button type="button" onClick={() => setActiveView("profile")}>
              <span>1</span>
              <strong>基本情報</strong>
              <small>年齢、家族構成、働き方</small>
            </button>
            <button type="button" onClick={() => setActiveView("assets")}>
              <span>2</span>
              <strong>資産・負債</strong>
              <small>現金、資産、ローン</small>
            </button>
            <button type="button" onClick={() => setActiveView("household")}>
              <span>3</span>
              <strong>家計</strong>
              <small>収入、生活費、特別支出</small>
            </button>
            <button type="button" onClick={() => setActiveView("budget")}>
              <span>4</span>
              <strong>予算・実績</strong>
              <small>月の予算と月末実績</small>
            </button>
            <button type="button" onClick={() => setActiveView("goals")}>
              <span>5</span>
              <strong>目標</strong>
              <small>目標額、期限、準備状況</small>
            </button>
            <button type="button" onClick={() => setActiveView("simulation")}>
              <span>6</span>
              <strong>シミュレーション</strong>
              <small>資産推移と生活防衛資金</small>
            </button>
            <button type="button" onClick={() => setActiveView("events")}>
              <span>7</span>
              <strong>イベント設定</strong>
              <small>時期、対象者、家計への影響</small>
            </button>
            <button type="button" onClick={() => setActiveView("timeline")}>
              <span>8</span>
              <strong>年表</strong>
              <small>目標と予定を月ごとに確認</small>
            </button>
          </div>
        </section>
      )}

      {reminders.length > 0 && (
        <section className="panel reminder-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">リマインダー</p>
              <h2>確認する項目が{reminders.length}件あります</h2>
            </div>
            <button type="button" className="secondary" onClick={() => setActiveView("settings")}>通知設定</button>
          </div>
          <div className="reminder-list">
            {reminders.map((reminder) => (
              <button type="button" key={reminder.id} onClick={() => setActiveView(reminder.view)}>
                <strong>{reminder.title}</strong>
                <span>{reminder.detail}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="dashboard-overview" aria-label="ホーム概要">
        <div className="dashboard-overview-header">
          <div>
            <p className="eyebrow">Life Compass</p>
            <h2>いまの家計と将来見通し</h2>
          </div>
          <span>入力完了度 {completion.percentage}%</span>
        </div>
        <div className="summary-grid" aria-label="主要指標">
          <Metric label="通常月の家計余剰" value={manYen(cashflow.monthlySavings)} helper={`収入 - 生活費 / ${percent(cashflow.savingsRate)}`} />
          <Metric label="現在の純資産" value={manYen(assets.netAssets)} helper={`総資産 ${manYen(assets.grossAssets)}`} />
          <Metric
            label="主要目標の到達目安"
            value={
              !primaryGoal
                ? "未設定"
                : primaryGoalAchievement?.status === "achieved"
                  ? "達成済み"
                  : primaryGoalAchievement?.targetAge !== null
                    ? `${primaryGoalAchievement?.targetAge}歳頃`
                    : "毎月の配分未設定"
            }
            helper={primaryGoal?.title ?? "目標を追加すると表示"}
          />
          <Metric
            label="生活防衛資金"
            value={emergency.status === "short" ? `あと ${manYen(emergency.shortageToLower)}` : "目安を確保"}
            helper={emergencyMonthsLabel(emergency.lowerMonths, emergency.upperMonths)}
          />
          <Metric label="30年後の見通し" value={manYen(thirtyYear)} helper="前提条件に基づく試算" />
        </div>

        <div className="quick-action-grid" aria-label="よく使う操作">
          <button type="button" onClick={() => setActiveView(firstMissingView)}>
            <strong>入力を続ける</strong>
            <span>{completion.percentage >= 100 ? "入力済み項目を見直す" : `入力完了度 ${completion.percentage}%`}</span>
          </button>
          <button type="button" onClick={() => setActiveView("goals")}>
            <strong>目標を整える</strong>
            <span>{plan.goals.length > 0 ? `${plan.goals.length}件の目標` : "目標を登録すると表示"}</span>
          </button>
          <button type="button" onClick={() => setActiveView("timeline")}>
            <strong>年表を確認</strong>
            <span>{plan.events.length > 0 ? `${plan.events.length}件のイベント` : "予定を追加"}</span>
          </button>
          <button type="button" onClick={() => setActiveView("data")}>
            <strong>バックアップ</strong>
            <span>JSONで保存</span>
          </button>
        </div>
      </section>

      {proAccess && (
        <section className="panel pro-review-dashboard">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Proレビュー</p>
              <h2>計画を見直すタイミング</h2>
              <p>採用中の計画と最新実績を確認し、必要な場合は次のシナリオへ更新します。</p>
            </div>
            <span className={`status-pill${hasCurrentMonthReview ? " recurring" : ""}`}>
              {hasCurrentMonthReview ? "今月確認済み" : "今月の確認待ち"}
            </span>
          </div>
          <div className="calculation-band compact">
            <Metric
              label="採用中の計画"
              value={plan.activeScenario?.name || "基本プラン"}
              helper={plan.activeScenario ? `${plan.activeScenario.adoptedAt.slice(0, 10)} 採用` : "シナリオ未採用"}
            />
            <Metric label="最終レビュー" value={latestReview?.date || "未実施"} helper={`${sortedReviews.length}件の履歴`} />
            <Metric label="最新の計画差" value={latestReviewGap === null ? "-" : manYen(latestReviewGap)} helper="実際の純資産 - 予定" />
            <Metric label="未完了TODO" value={`${openReviewTodoCount}件`} helper="次回確認すること" />
          </div>
          <div className="button-row">
            <button type="button" onClick={() => setActiveView("reviews")}>{hasCurrentMonthReview ? "レビュー履歴を確認" : "今月のレビューを始める"}</button>
            <button type="button" className="secondary" onClick={() => setActiveView("scenarios")}>シナリオを見直す</button>
            <button type="button" className="secondary" onClick={() => setActiveView("data")}>バックアップを確認</button>
          </div>
        </section>
      )}

      <section className="split-layout">
        <div className="panel wide-panel">
          <div className="section-heading">
            <div>
              <h2>将来資産の見通し</h2>
              <p>現在の入力条件とライフイベントを反映した参考試算です。</p>
            </div>
            <button type="button" className="secondary" onClick={() => setActiveView("simulation")}>
              試算を確認
            </button>
          </div>
          <LineChart points={projection.filter((_, index) => index % 3 === 0 || index === 30)} />
          <div className="compare-row">
            <span>10年後: {manYen(tenYear)}</span>
            <span>30年後: {manYen(thirtyYear)}</span>
          </div>
        </div>

        <div className="panel">
          <h2>次に確認する項目</h2>
          <div className="focus-list">
            <button type="button" onClick={() => setActiveView("goals")}>
              <strong>{primaryGoal?.title ?? "目標を追加"}</strong>
              <span>{primaryGoal ? `${primaryGoal.dueYear}年 / ${getTargetAgeForYear(plan.profile.age, primaryGoal.dueYear)}歳まで` : "期限と目標額を整理"}</span>
            </button>
            <button type="button" onClick={() => setActiveView("timeline")}>
              <strong>{nextEvent?.title ?? "ライフイベントを追加"}</strong>
              <span>{nextEvent ? `${nextEvent.year}年${nextEvent.month}月 / ${manYen(nextEvent.amount)}` : "年表で将来イベントを確認"}</span>
            </button>
            <button type="button" onClick={() => setActiveView("household")}>
              <strong>家計入力</strong>
              <span>固定費と変動費を見直す</span>
            </button>
            <button type="button" onClick={() => setActiveView("notes")}>
              <strong>メモ</strong>
              <span>{plan.notes?.general ? plan.notes.general.slice(0, 34) : "気になる点や次の見直しを残す"}</span>
            </button>
          </div>
          <div className="guidance-list" aria-label="見直しポイント">
            {guidanceItems.map((item) => (
              <button type="button" className={`guidance-item ${item.tone}`} key={item.title} onClick={() => setActiveView(item.view)}>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="dashboard-lower">
        <div className="panel">
          <div className="section-heading">
            <div>
              <h2>目標達成の目安</h2>
              <p>目標ごとの達成済み額と毎月まわす額から見た、前提条件に基づく目安です。</p>
            </div>
            <button type="button" className="secondary" onClick={() => setActiveView("goals")}>
              目標を編集
            </button>
          </div>
          <div className="goal-insights">
            {goalAchievements.length === 0 ? (
              <p>目標を追加すると、達成年齢の目安を確認できます。</p>
            ) : (
              goalAchievements.slice(0, 3).map(({ goal, achievement }) => (
                <div className="insight-row" key={goal.id}>
                  <div>
                    <strong>{goal.title}</strong>
                    <span>
                      {goal.goalType === "recurring"
                        ? `${getRecurrenceLabel(goal.recurrence)} / 年間 ${manYen(achievement.annualRequiredAmount)}`
                        : `目標額 ${manYen(goal.requiredAmount)} / 残り ${manYen(achievement.shortfall)}`}
                    </span>
                  </div>
                  <b>
                    {achievement.status === "achieved"
                      ? "達成済み"
                      : achievement.targetAge
                        ? `${achievement.targetAge}歳頃`
                        : "毎月の配分未設定"}
                  </b>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="panel">
          <h2>入力完了度</h2>
          <div className="completion-meter" aria-label={`入力完了度 ${completion.percentage}%`}>
            <span style={{ width: `${completion.percentage}%` }} />
          </div>
          <p className="completion-text">
            {completion.completed}/{completion.total} 項目入力済み
          </p>
          <div className="completion-list">
            {completion.items.map((item) => (
              <button
                type="button"
                className={item.complete ? "complete" : ""}
                key={item.label}
                onClick={() => setActiveView(item.view)}
              >
                <span>{item.label}</span>
                <small>{item.complete ? "入力済み" : "確認する"}</small>
              </button>
            ))}
          </div>
          {missingItems.length > 0 && (
            <div className="missing-guide">
              <strong>次に入力するとよい項目</strong>
              <p>未入力のうち、見通しに影響しやすい項目です。入力できる範囲だけで問題ありません。</p>
              {missingItems.map((item) => (
                <button type="button" className="secondary" key={item.label} onClick={() => setActiveView(item.view)}>
                  {item.label}を確認
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
