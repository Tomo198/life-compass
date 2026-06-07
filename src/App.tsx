import { useEffect, useMemo, useRef, useState } from "react";
import { createId, defaultPlan } from "./data/defaultPlan";
import { proPriceLabel } from "./features";
import type {
  Assets,
  CashflowType,
  FamilyType,
  Goal,
  Household,
  Housing,
  LifeEvent,
  LifeEventCategory,
  LifePlan,
  PlanNotes,
  Priority,
  Profile,
  RecurrenceInterval,
  SimulationSettings,
  ViewKey,
  WorkStyle
} from "./types";
import {
  getAssetSummary,
  getAnnualProjectionRows,
  getCashflowSummary,
  getEmergencyFundResult,
  getGoalAchievement,
  getGoalAchievements,
  getInputCompletion,
  getNextEvent,
  getPrimaryGoal,
  getRecurrenceLabel,
  manYen,
  percent,
  projectAssets,
  simulateContribution
} from "./utils/calculations";
import { clearPlan, exportPlan, loadPlan, savePlan, validateImportedPlan } from "./utils/storage";

const navItems: { key: ViewKey; label: string }[] = [
  { key: "dashboard", label: "ダッシュボード" },
  { key: "profile", label: "ライフプラン" },
  { key: "household", label: "家計入力" },
  { key: "assets", label: "資産入力" },
  { key: "goals", label: "目標管理" },
  { key: "timeline", label: "年表" },
  { key: "simulation", label: "シミュレーション" },
  { key: "notes", label: "メモ" },
  { key: "data", label: "データ管理" },
  { key: "pro", label: "Pro機能" },
  { key: "legal", label: "法務" }
];

type ThemePreference = "light" | "dark" | "system";

type AppSettings = {
  theme: ThemePreference;
};

const SETTINGS_KEY = "life-compass-app-settings-v1";

const defaultSettings: AppSettings = {
  theme: "system"
};

const loadAppSettings = (): AppSettings => {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    return saved ? { ...defaultSettings, ...JSON.parse(saved) } : defaultSettings;
  } catch {
    return defaultSettings;
  }
};

const saveAppSettings = (settings: AppSettings) => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
};

const resolveTheme = (theme: ThemePreference) => {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

const familyLabels: Record<FamilyType, string> = {
  single: "単身",
  couple: "夫婦",
  children: "子どもあり",
  care: "親の支援/介護あり",
  other: "その他"
};

const workLabels: Record<WorkStyle, string> = {
  employee: "会社員",
  freelance: "フリーランス",
  selfEmployed: "自営業",
  variable: "収入変動が大きい",
  retired: "退職後",
  other: "その他"
};

const housingLabels: Record<Housing, string> = {
  rent: "賃貸",
  owned: "持ち家",
  mortgage: "住宅ローンあり",
  family: "家族と同居",
  other: "その他"
};

const priorityLabels: Record<Priority, string> = {
  high: "高",
  medium: "中",
  low: "低"
};

const eventCategoryLabels: Record<LifeEventCategory, string> = {
  career: "転職",
  move: "引越し",
  marriage: "結婚",
  birth: "出産",
  home: "住宅購入",
  car: "車購入",
  education: "教育費",
  care: "親の介護",
  sideBusiness: "独立/副業",
  retirement: "退職",
  travel: "大きな旅行",
  qualification: "資格取得",
  other: "その他"
};

const cashflowLabels: Record<CashflowType, string> = {
  expense: "支出として反映",
  income: "収入・資産増として反映",
  neutral: "記録のみ"
};

const cashflowHelp: Record<CashflowType, string> = {
  expense: "その年の資産見通しから差し引きます。",
  income: "その年の資産見通しに加算します。",
  neutral: "年表に残すだけで、試算には反映しません。"
};

const normalizeNumericText = (value: string, allowDecimal = false) => {
  const withoutCommas = value.replace(/,/g, "");
  const allowed = withoutCommas.replace(allowDecimal ? /[^\d.-]/g : /[^\d-]/g, "");
  const sign = allowed.startsWith("-") ? "-" : "";
  const unsigned = allowed.replace(/-/g, "");

  if (!allowDecimal) return `${sign}${unsigned}`;

  const [integerPart, ...decimalParts] = unsigned.split(".");
  const decimal = decimalParts.join("");
  return decimalParts.length > 0 ? `${sign}${integerPart}.${decimal}` : `${sign}${integerPart}`;
};

const parseNumericText = (value: string) => {
  if (value === "" || value === "-" || value === "." || value === "-.") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const clampNumber = (value: number, min?: number, max?: number) => {
  if (typeof min === "number" && value < min) return min;
  if (typeof max === "number" && value > max) return max;
  return value;
};

const formatNumericText = (value: number, allowDecimal = false) =>
  new Intl.NumberFormat("ja-JP", {
    maximumFractionDigits: allowDecimal ? 2 : 0
  }).format(value || 0);

const exactYenLabel = (value: number) => {
  const rounded = Math.round(value || 0);
  const sign = rounded < 0 ? "-" : "";
  const absolute = Math.abs(rounded);
  const oku = Math.floor(absolute / 100000000);
  const man = Math.floor((absolute % 100000000) / 10000);
  const yen = absolute % 10000;
  const parts: string[] = [];

  if (oku > 0) parts.push(`${new Intl.NumberFormat("ja-JP").format(oku)}億`);
  if (man > 0) parts.push(`${new Intl.NumberFormat("ja-JP").format(man)}万`);
  if (yen > 0 || parts.length === 0) parts.push(`${new Intl.NumberFormat("ja-JP").format(yen)}`);

  return `${sign}${parts.join("")}円`;
};

const getTargetAgeForYear = (currentAge: number, dueYear: number) => {
  const currentYear = new Date().getFullYear();
  return currentAge + Math.max(0, dueYear - currentYear);
};

const cloneDefaultPlan = () => JSON.parse(JSON.stringify(defaultPlan)) as LifePlan;

function App() {
  const [plan, setPlan] = useState<LifePlan>(() => loadPlan());
  const [activeView, setActiveView] = useState<ViewKey>("dashboard");
  const [importMessage, setImportMessage] = useState("");
  const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings());

  useEffect(() => {
    const applyTheme = () => {
      document.documentElement.dataset.theme = resolveTheme(settings.theme);
    };
    applyTheme();

    if (settings.theme !== "system") return undefined;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [settings.theme]);

  const commitPlan = (nextPlan: LifePlan) => {
    const saved = savePlan(nextPlan);
    setPlan(saved);
  };

  const updateSettings = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const nextSettings = { ...settings, [key]: value };
    saveAppSettings(nextSettings);
    setSettings(nextSettings);
  };

  const updateProfile = <K extends keyof Profile>(key: K, value: Profile[K]) => {
    commitPlan({ ...plan, profile: { ...plan.profile, [key]: value } });
  };

  const updateHousehold = <K extends keyof Household>(key: K, value: Household[K]) => {
    commitPlan({ ...plan, household: { ...plan.household, [key]: value } });
  };

  const updateAssets = <K extends keyof Assets>(key: K, value: Assets[K]) => {
    commitPlan({ ...plan, assets: { ...plan.assets, [key]: value } });
  };

  const updateSimulation = <K extends keyof SimulationSettings>(key: K, value: SimulationSettings[K]) => {
    commitPlan({ ...plan, simulation: { ...plan.simulation, [key]: value } });
  };

  const updateNotes = <K extends keyof PlanNotes>(key: K, value: PlanNotes[K]) => {
    commitPlan({ ...plan, notes: { ...(plan.notes || { general: "", spendingReview: "" }), [key]: value } });
  };

  const addGoal = () => {
    const nextGoal: Goal = {
      id: createId(),
      title: "新しい目標",
      goalType: "oneTime",
      dueYear: new Date().getFullYear() + 3,
      requiredAmount: 1000000,
      savedAmount: 0,
      monthlyAllocation: 30000,
      recurrence: "yearly",
      priority: "medium",
      progress: 0,
      memo: ""
    };
    commitPlan({ ...plan, goals: [...plan.goals, nextGoal] });
  };

  const updateGoal = <K extends keyof Goal>(id: string, key: K, value: Goal[K]) => {
    commitPlan({
      ...plan,
      goals: plan.goals.map((goal) => (goal.id === id ? { ...goal, [key]: value } : goal))
    });
  };

  const removeGoal = (id: string) => {
    commitPlan({ ...plan, goals: plan.goals.filter((goal) => goal.id !== id) });
  };

  const addEvent = () => {
    const year = new Date().getFullYear() + 1;
    const nextEvent: LifeEvent = {
      id: createId(),
      title: "新しいライフイベント",
      category: "other",
      year,
      age: plan.profile.age + 1,
      amount: 0,
      cashflowType: "neutral",
      memo: ""
    };
    commitPlan({ ...plan, events: [...plan.events, nextEvent] });
  };

  const updateEvent = <K extends keyof LifeEvent>(id: string, key: K, value: LifeEvent[K]) => {
    commitPlan({
      ...plan,
      events: plan.events.map((event) => (event.id === id ? { ...event, [key]: value } : event))
    });
  };

  const updateEventSchedule = (id: string, year: number) => {
    commitPlan({
      ...plan,
      events: plan.events.map((event) =>
        event.id === id ? { ...event, year, age: getTargetAgeForYear(plan.profile.age, year) } : event
      )
    });
  };

  const removeEvent = (id: string) => {
    commitPlan({ ...plan, events: plan.events.filter((event) => event.id !== id) });
  };

  const resetPlan = () => {
    clearPlan();
    const next = cloneDefaultPlan();
    commitPlan(next);
    setImportMessage("初期データに戻しました。");
  };

  const renderView = () => {
    switch (activeView) {
      case "dashboard":
        return <Dashboard plan={plan} setActiveView={setActiveView} />;
      case "profile":
        return <ProfileView plan={plan} updateProfile={updateProfile} />;
      case "household":
        return <HouseholdView plan={plan} updateHousehold={updateHousehold} />;
      case "assets":
        return <AssetsView plan={plan} updateAssets={updateAssets} />;
      case "goals":
        return <GoalsView plan={plan} addGoal={addGoal} updateGoal={updateGoal} removeGoal={removeGoal} />;
      case "timeline":
        return (
          <TimelineView
            plan={plan}
            addEvent={addEvent}
            updateEvent={updateEvent}
            updateEventSchedule={updateEventSchedule}
            removeEvent={removeEvent}
          />
        );
      case "simulation":
        return <SimulationView plan={plan} updateSimulation={updateSimulation} />;
      case "notes":
        return <NotesView plan={plan} updateNotes={updateNotes} />;
      case "data":
        return (
          <DataView
            plan={plan}
            commitPlan={commitPlan}
            importMessage={importMessage}
            setImportMessage={setImportMessage}
            resetPlan={resetPlan}
          />
        );
      case "pro":
        return <ProView plan={plan} />;
      case "settings":
        return <SettingsView settings={settings} updateSettings={updateSettings} setActiveView={setActiveView} />;
      case "legal":
        return <LegalView />;
      default:
        return null;
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="メインナビゲーション">
        <div className="brand">
          <span className="brand-mark">LC</span>
          <div>
            <strong>Life Compass</strong>
            <small>生活設計の見える化</small>
          </div>
        </div>
        <nav className="nav-list">
          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={activeView === item.key ? "active" : ""}
              onClick={() => setActiveView(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <p className="sidebar-note">保存先: このブラウザ内</p>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div>
            <p className="eyebrow">ライフプラン管理ツール</p>
            <h1>{activeView === "settings" ? "設定" : navItems.find((item) => item.key === activeView)?.label}</h1>
          </div>
          <div className="topbar-actions">
            <button type="button" className="secondary" onClick={() => exportPlan(plan)}>
              JSONエクスポート
            </button>
            <button type="button" onClick={() => setActiveView("settings")}>
              設定
            </button>
          </div>
        </header>
        {renderView()}
      </main>
    </div>
  );
}

type DashboardProps = {
  plan: LifePlan;
  setActiveView: (view: ViewKey) => void;
};

type DashboardGuidance = {
  title: string;
  detail: string;
  view: ViewKey;
  tone: "notice" | "check" | "good";
};

const getDashboardGuidance = ({
  plan,
  cashflow,
  assets,
  emergency,
  completion
}: {
  plan: LifePlan;
  cashflow: ReturnType<typeof getCashflowSummary>;
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

function Dashboard({ plan, setActiveView }: DashboardProps) {
  const cashflow = getCashflowSummary(plan.household);
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

  return (
    <div className="view-stack">
      {completion.percentage < 85 && (
        <section className="panel onboarding-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">はじめての使い方</p>
              <h2>まずは生活の全体像を入力します</h2>
              <p>すべてを一度に埋めなくても大丈夫です。プロフィール、家計、資産、目標、年表の順に入れると見通しが作りやすくなります。</p>
            </div>
            <button type="button" onClick={() => setActiveView(completion.items.find((item) => !item.complete)?.view ?? "profile")}>
              次の入力へ
            </button>
          </div>
          <div className="onboarding-steps" aria-label="入力の流れ">
            <button type="button" onClick={() => setActiveView("profile")}>
              <span>1</span>
              <strong>基本情報</strong>
              <small>年齢、家族構成、働き方</small>
            </button>
            <button type="button" onClick={() => setActiveView("household")}>
              <span>2</span>
              <strong>家計</strong>
              <small>収入、生活費、特別支出</small>
            </button>
            <button type="button" onClick={() => setActiveView("assets")}>
              <span>3</span>
              <strong>資産</strong>
              <small>現金、資産、負債</small>
            </button>
            <button type="button" onClick={() => setActiveView("goals")}>
              <span>4</span>
              <strong>目標と年表</strong>
              <small>達成したいこと、将来イベント</small>
            </button>
          </div>
        </section>
      )}

      <section className="summary-grid" aria-label="主要指標">
        <Metric label="毎月の見込み貯蓄" value={manYen(cashflow.monthlySavings)} helper={`貯蓄率 ${percent(cashflow.savingsRate)}`} />
        <Metric label="現在の純資産" value={manYen(assets.netAssets)} helper={`総資産 ${manYen(assets.grossAssets)}`} />
        <Metric
          label="主要目標の到達目安"
          value={primaryGoalAchievement?.targetAge ? `${primaryGoalAchievement.targetAge}歳頃` : primaryGoal ? "未達見込み" : "未設定"}
          helper={primaryGoal?.title ?? "目標を追加すると表示"}
        />
        <Metric
          label="生活防衛資金"
          value={emergency.status === "short" ? `あと ${manYen(emergency.shortageToLower)}` : "目安範囲内"}
          helper={`${emergency.lowerMonths}〜${emergency.upperMonths}ヶ月分`}
        />
        <Metric label="30年後の見通し" value={manYen(thirtyYear)} helper="前提条件に基づく試算" />
      </section>

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
              <span>{nextEvent ? `${nextEvent.year}年 ${manYen(nextEvent.amount)}` : "年表で将来イベントを確認"}</span>
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
                        : "未達見込み"}
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
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </div>
  );
}

function ProfileView({
  plan,
  updateProfile
}: {
  plan: LifePlan;
  updateProfile: <K extends keyof Profile>(key: K, value: Profile[K]) => void;
}) {
  return (
    <section className="panel form-panel">
      <StepTitle step="1" title="基本プロフィール" description="生活防衛資金や年表の年齢表示に使います。" />
      <div className="form-grid">
        <label>
          プラン名
          <input value={plan.profile.name} onChange={(event) => updateProfile("name", event.target.value)} />
        </label>
        <label>
          現在の年齢
          <NumericInput value={plan.profile.age} min={0} onChange={(value) => updateProfile("age", value)} />
        </label>
        <label>
          家族構成
          <select value={plan.profile.familyType} onChange={(event) => updateProfile("familyType", event.target.value as FamilyType)}>
            {Object.entries(familyLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          働き方
          <select value={plan.profile.workStyle} onChange={(event) => updateProfile("workStyle", event.target.value as WorkStyle)}>
            {Object.entries(workLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          住居形態
          <select value={plan.profile.housing} onChange={(event) => updateProfile("housing", event.target.value as Housing)}>
            {Object.entries(housingLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

function HouseholdView({
  plan,
  updateHousehold
}: {
  plan: LifePlan;
  updateHousehold: <K extends keyof Household>(key: K, value: Household[K]) => void;
}) {
  const cashflow = getCashflowSummary(plan.household);
  return (
    <div className="view-stack">
      <section className="panel form-panel">
        <StepTitle step="2" title="基本収支" description="月単位の収支と年間特別支出を整理します。" />
        <div className="form-grid">
          <MoneyInput label="月収" value={plan.household.monthlyIncome} onChange={(value) => updateHousehold("monthlyIncome", value)} />
          <MoneyInput label="ボーナス年額" value={plan.household.annualBonus} onChange={(value) => updateHousehold("annualBonus", value)} />
          <MoneyInput label="副業収入 月額" value={plan.household.sideIncome} onChange={(value) => updateHousehold("sideIncome", value)} />
          <MoneyInput label="固定費 月額" value={plan.household.fixedCost} onChange={(value) => updateHousehold("fixedCost", value)} />
          <MoneyInput label="変動費 月額" value={plan.household.variableCost} onChange={(value) => updateHousehold("variableCost", value)} />
          <MoneyInput
            label="年間特別支出"
            value={plan.household.annualSpecialCost}
            onChange={(value) => updateHousehold("annualSpecialCost", value)}
          />
        </div>
      </section>
      <section className="calculation-band">
        <Metric label="月間生活費" value={manYen(cashflow.monthlyLivingCost)} helper={`年間 ${manYen(cashflow.annualLivingCost)}`} />
        <Metric label="毎月貯蓄額" value={manYen(cashflow.monthlySavings)} helper={`貯蓄率 ${percent(cashflow.savingsRate)}`} />
        <Metric label="年間収入" value={manYen(cashflow.annualIncome)} helper="ボーナス込み" />
      </section>
    </div>
  );
}

function AssetsView({
  plan,
  updateAssets
}: {
  plan: LifePlan;
  updateAssets: <K extends keyof Assets>(key: K, value: Assets[K]) => void;
}) {
  const assets = getAssetSummary(plan.assets);
  return (
    <div className="view-stack">
      <section className="panel form-panel">
        <StepTitle step="3" title="資産入力" description="現金、投資資産、その他資産、負債を分けて整理します。" />
        <div className="form-grid">
          <MoneyInput label="現金" value={plan.assets.cash} onChange={(value) => updateAssets("cash", value)} />
          <MoneyInput label="投資資産" value={plan.assets.investment} onChange={(value) => updateAssets("investment", value)} />
          <MoneyInput label="その他資産" value={plan.assets.other} onChange={(value) => updateAssets("other", value)} />
          <MoneyInput label="負債" value={plan.assets.debt} onChange={(value) => updateAssets("debt", value)} />
        </div>
      </section>
      <section className="calculation-band">
        <Metric label="資産合計" value={exactYenLabel(assets.grossAssets)} helper="現金 + 投資資産 + その他資産" />
        <Metric label="負債" value={exactYenLabel(plan.assets.debt)} helper="住宅ローン、借入など" />
        <Metric label="純資産" value={exactYenLabel(assets.netAssets)} helper="資産合計 - 負債" />
      </section>
      <section className="asset-formula">
        <span>計算式</span>
        <strong>
          {exactYenLabel(assets.grossAssets)} - {exactYenLabel(plan.assets.debt)} = {exactYenLabel(assets.netAssets)}
        </strong>
      </section>
    </div>
  );
}

function GoalsView({
  plan,
  addGoal,
  updateGoal,
  removeGoal
}: {
  plan: LifePlan;
  addGoal: () => void;
  updateGoal: <K extends keyof Goal>(id: string, key: K, value: Goal[K]) => void;
  removeGoal: (id: string) => void;
}) {
  const goalAchievements = getGoalAchievements(plan);

  return (
    <section className="panel">
      <div className="section-heading">
        <StepTitle step="4" title="目標管理" description="期限、目標額、優先度、準備状況を整理します。" />
        <button type="button" onClick={addGoal}>
          目標を追加
        </button>
      </div>
      <div className="table-wrap desktop-table">
        <table>
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
            {plan.goals.map((goal) => (
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
                    currentAge={plan.profile.age}
                    onChange={(value) => updateGoal(goal.id, "dueYear", value)}
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
                  <GoalAchievementSummary achievement={getGoalAchievement(plan, goal)} />
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
            ))}
          </tbody>
        </table>
      </div>
      <div className="mobile-card-list">
        {goalAchievements.map(({ goal, achievement }) => (
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
                  currentAge={plan.profile.age}
                  onChange={(value) => updateGoal(goal.id, "dueYear", value)}
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
            <GoalAchievementSummary achievement={achievement} />
            <button type="button" className="text-button mobile-delete-button" onClick={() => removeGoal(goal.id)}>
              削除
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function GoalDeadlineInput({
  dueYear,
  currentAge,
  onChange
}: {
  dueYear: number;
  currentAge: number;
  onChange: (value: number) => void;
}) {
  return <YearAgeInput year={dueYear} currentAge={currentAge} ageLabel="達成したい年齢" onChange={onChange} />;
}

function YearAgeInput({
  year,
  currentAge,
  ageLabel,
  onChange
}: {
  year: number;
  currentAge: number;
  ageLabel: string;
  onChange: (value: number) => void;
}) {
  const currentYear = new Date().getFullYear();
  const targetAge = getTargetAgeForYear(currentAge, year);
  const updateYear = (value: number) => onChange(Math.max(currentYear, value));

  return (
    <div className="year-age-control">
      <div className="year-stepper">
        <button type="button" className="stepper-button" aria-label="1年早める" onClick={() => updateYear(year - 1)}>
          -
        </button>
        <NumericInput value={year} min={currentYear} onChange={updateYear} />
        <button type="button" className="stepper-button" aria-label="1年遅らせる" onClick={() => updateYear(year + 1)}>
          +
        </button>
      </div>
      <small>
        {ageLabel}: {targetAge}歳
      </small>
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

function GoalAchievementSummary({ achievement }: { achievement: ReturnType<typeof getGoalAchievement> }) {
  return (
    <div className="goal-achievement-summary">
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
        : "未達見込み";

  return <span className={`status-pill ${achievement.status}`}>{label}</span>;
}

function TimelineView({
  plan,
  addEvent,
  updateEvent,
  updateEventSchedule,
  removeEvent
}: {
  plan: LifePlan;
  addEvent: () => void;
  updateEvent: <K extends keyof LifeEvent>(id: string, key: K, value: LifeEvent[K]) => void;
  updateEventSchedule: (id: string, year: number) => void;
  removeEvent: (id: string) => void;
}) {
  const sortedEvents = [...plan.events].sort((a, b) => a.year - b.year);
  return (
    <section className="panel">
      <div className="section-heading">
        <StepTitle step="5" title="ライフイベント年表" description="予定年、金額、家計への影響を整理し、資産見通しに反映できます。" />
        <button type="button" onClick={addEvent}>
          イベントを追加
        </button>
      </div>
      <div className="timeline">
        {sortedEvents.map((event) => (
          <div className="timeline-row" key={event.id}>
            <div className="timeline-year">
              <strong>{event.year}</strong>
              <span>{getTargetAgeForYear(plan.profile.age, event.year)}歳</span>
            </div>
            <div className="timeline-fields">
              <label className="timeline-field title-field">
                イベント名
                <input value={event.title} onChange={(input) => updateEvent(event.id, "title", input.target.value)} />
                <small>例: 住宅購入、車購入、転職、旅行など</small>
              </label>
              <label className="timeline-field">
                種類
                <select
                  value={event.category}
                  onChange={(input) => updateEvent(event.id, "category", input.target.value as LifeEventCategory)}
                >
                  {Object.entries(eventCategoryLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <small>年表で見分けるための分類です。</small>
              </label>
              <div className="timeline-field">
                <span>予定年</span>
                <YearAgeInput
                  year={event.year}
                  currentAge={plan.profile.age}
                  ageLabel="予定年齢"
                  onChange={(value) => updateEventSchedule(event.id, value)}
                />
              </div>
              <label className="timeline-field">
                金額
                <NumericInput value={event.amount} min={0} onChange={(value) => updateEvent(event.id, "amount", value)} />
                <small>支出または収入変化として反映する金額です。</small>
              </label>
              <label className="timeline-field impact-field">
                家計への影響
                <select
                  value={event.cashflowType}
                  onChange={(input) => updateEvent(event.id, "cashflowType", input.target.value as CashflowType)}
                >
                  {Object.entries(cashflowLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <small>{cashflowHelp[event.cashflowType]}</small>
              </label>
              <label className="timeline-field memo-field">
                メモ
                <input value={event.memo} onChange={(input) => updateEvent(event.id, "memo", input.target.value)} />
                <small>前提や検討中のことを残せます。</small>
              </label>
              <button type="button" className="text-button" onClick={() => removeEvent(event.id)}>
                削除
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SimulationView({
  plan,
  updateSimulation
}: {
  plan: LifePlan;
  updateSimulation: <K extends keyof SimulationSettings>(key: K, value: SimulationSettings[K]) => void;
}) {
  const [projectionYears, setProjectionYears] = useState<10 | 30>(30);
  const projection10 = useMemo(() => projectAssets(plan, 10), [plan]);
  const projection30 = useMemo(() => projectAssets(plan, 30), [plan]);
  const annualRows = useMemo(() => getAnnualProjectionRows(plan, projectionYears), [plan, projectionYears]);
  const emergency = getEmergencyFundResult(plan);
  const contribution = simulateContribution(plan.simulation);

  return (
    <div className="view-stack">
      <section className="panel">
        <div className="section-heading">
          <StepTitle step="6" title="基本資産推移" description="入力条件に基づく10年/30年の見通しです。" />
          <div className="segmented-control" aria-label="表示期間">
            <button type="button" className={projectionYears === 10 ? "active" : ""} onClick={() => setProjectionYears(10)}>
              10年
            </button>
            <button type="button" className={projectionYears === 30 ? "active" : ""} onClick={() => setProjectionYears(30)}>
              30年
            </button>
          </div>
        </div>
        <LineChart points={annualRows} />
        <div className="calculation-band compact">
          <Metric label="10年後" value={manYen(projection10[10]?.value ?? 0)} helper="前提条件に基づく試算" />
          <Metric label="30年後" value={manYen(projection30[30]?.value ?? 0)} helper="前提条件に基づく試算" />
        </div>
      </section>

      <section className="panel">
        <StepTitle step="7" title="生活防衛資金チェック" description={emergency.note} />
        <div className="calculation-band compact">
          <Metric label="月間生活費" value={manYen(getCashflowSummary(plan.household).monthlyLivingCost)} helper="固定費 + 変動費 + 特別支出月割" />
          <Metric label="推奨生活防衛資金" value={`${manYen(emergency.lowerAmount)}〜${manYen(emergency.upperAmount)}`} helper={`${emergency.lowerMonths}〜${emergency.upperMonths}ヶ月分`} />
          <Metric
            label="現在の現金"
            value={manYen(plan.assets.cash)}
            helper={
              emergency.status === "short"
                ? `${emergency.lowerMonths}ヶ月分まであと ${manYen(emergency.shortageToLower)}`
                : "目安範囲を満たしています"
            }
          />
          <Metric
            label="到達目安"
            value={emergency.monthsToLower ? `約${emergency.monthsToLower}ヶ月` : "-"}
            helper="毎月貯蓄額が正の場合"
          />
        </div>
      </section>

      <section className="panel form-panel">
        <StepTitle step="8" title="簡易積立シミュレーション" description="前提条件に基づく参考試算です。個別の商品名は扱いません。" />
        <div className="form-grid">
          <MoneyInput
            label="毎月積立額"
            value={plan.simulation.monthlyContribution}
            onChange={(value) => updateSimulation("monthlyContribution", value)}
          />
          <MoneyInput
            label="ボーナス積立 年額"
            value={plan.simulation.bonusContribution}
            onChange={(value) => updateSimulation("bonusContribution", value)}
          />
          <label>
            想定利回り %
            <NumericInput
              value={plan.simulation.annualReturnRate}
              min={0}
              allowDecimal
              onChange={(value) => updateSimulation("annualReturnRate", value)}
            />
          </label>
          <label>
            積立期間 年
            <NumericInput value={plan.simulation.years} min={1} onChange={(value) => updateSimulation("years", value)} />
          </label>
        </div>
        <div className="calculation-band compact">
          <Metric label="積立元本" value={manYen(contribution.totalContribution)} helper="毎月 + ボーナス" />
          <Metric label="試算結果" value={manYen(contribution.finalValue)} helper={`想定利回り ${plan.simulation.annualReturnRate}%`} />
          <Metric label="積立しない場合との差" value={manYen(contribution.finalValue - contribution.noReturnValue)} helper="利回りありとの差" />
          <Metric
            label="月1万円増やした場合"
            value={manYen(contribution.increasedByTenThousand - contribution.finalValue)}
            helper="現在の前提との差"
          />
        </div>
        <div className="table-wrap narrow">
          <table>
            <thead>
              <tr>
                <th>利回り</th>
                <th>試算結果</th>
              </tr>
            </thead>
            <tbody>
              {contribution.rateComparisons.map((item) => (
                <tr key={item.rate}>
                  <td>{item.rate}%</td>
                  <td>{manYen(item.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function NotesView({
  plan,
  updateNotes
}: {
  plan: LifePlan;
  updateNotes: <K extends keyof PlanNotes>(key: K, value: PlanNotes[K]) => void;
}) {
  return (
    <div className="view-stack">
      <section className="panel form-panel">
        <StepTitle step="9" title="メモ" description="無料版では、今の前提や次の見直しを1つのプラン内に保存できます。" />
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
      </section>

      <section className="panel">
        <h2>無料版とPro版の境界</h2>
        <div className="boundary-grid">
          <div>
            <strong>無料版</strong>
            <p>単一プランのメモとして保存します。ブラウザ内保存とJSONバックアップに含まれます。</p>
          </div>
          <div>
            <strong>Pro予定</strong>
            <p>月次/四半期レビュー、前回との差分、TODO、PDFレポートへの反映を追加予定です。</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function DataView({
  plan,
  commitPlan,
  importMessage,
  setImportMessage,
  resetPlan
}: {
  plan: LifePlan;
  commitPlan: (plan: LifePlan) => void;
  importMessage: string;
  setImportMessage: (message: string) => void;
  resetPlan: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const updatedAt = new Date(plan.updatedAt).toLocaleString("ja-JP");
  const backupSizeKb = Math.max(1, Math.ceil(new Blob([JSON.stringify(plan)]).size / 1024));

  const handleImport = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const imported = validateImportedPlan(parsed);
        commitPlan(imported);
        setImportMessage("JSONをインポートしました。");
      } catch (error) {
        setImportMessage(error instanceof Error ? error.message : "インポートできませんでした。");
      }
    };
    reader.readAsText(file);
  };

  const handleReset = () => {
    if (window.confirm("現在の入力内容を初期データに戻します。必要な場合は先にJSONエクスポートしてください。")) {
      resetPlan();
    }
  };

  return (
    <div className="view-stack">
      <section className="panel">
        <StepTitle step="10" title="データ管理" description="初期版では収入・支出・資産・家族情報をサーバーに保存しません。" />
        <div className="data-status-grid" aria-label="保存状態">
          <div>
            <span>保存先</span>
            <strong>このブラウザ内</strong>
            <small>ログインやクラウド保存は未実装です。</small>
          </div>
          <div>
            <span>最終保存</span>
            <strong>{updatedAt}</strong>
            <small>入力変更時に自動保存されます。</small>
          </div>
          <div>
            <span>バックアップ目安</span>
            <strong>約{backupSizeKb}KB</strong>
            <small>JSONとして手元に保存できます。</small>
          </div>
        </div>
        <div className="data-actions">
          <button type="button" onClick={() => exportPlan(plan)}>
            JSONエクスポート
          </button>
          <button type="button" className="secondary" onClick={() => fileInputRef.current?.click()}>
            JSONインポート
          </button>
          <button type="button" className="danger" onClick={handleReset}>
            初期化
          </button>
          <input
            ref={fileInputRef}
            className="hidden-input"
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              handleImport(event.target.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
        </div>
        <div className="data-guide">
          <div>
            <strong>バックアップするとき</strong>
            <span>JSONエクスポートを押すと、現在の入力内容をファイルとして保存できます。端末変更、ブラウザ変更、閲覧データ削除の前に使います。</span>
          </div>
          <div>
            <strong>復元するとき</strong>
            <span>JSONインポートから保存済みファイルを選ぶと、このブラウザ内のプランに反映されます。</span>
          </div>
          <div>
            <strong>初期化するとき</strong>
            <span>現在の入力内容を初期データに戻します。必要なデータは先にエクスポートしてください。</span>
          </div>
        </div>
        {importMessage && <p className="message">{importMessage}</p>}
      </section>
      <DisclaimerPanel />
    </div>
  );
}

function ProView({ plan }: { plan: LifePlan }) {
  const projection = projectAssets(plan, 30);
  const tenYear = projection[10]?.value ?? 0;
  const thirtyYear = projection[30]?.value ?? 0;
  return (
    <div className="view-stack">
      <section className="pro-hero">
        <div>
          <p className="eyebrow">Coming soon</p>
          <h2>複数シナリオを比較し、定期的に見直すPro版</h2>
          <p>{proPriceLabel}。初期版では課金機能を実装せず、無料版との機能境界を明確にしています。</p>
        </div>
        <span className="lock-badge">Pro予定</span>
      </section>

      <section className="panel">
        <h2>シナリオ比較プレビュー</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>比較項目</th>
                <th>現状プラン</th>
                <th>変更プラン例</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>毎月貯蓄額</td>
                <td>{manYen(getCashflowSummary(plan.household).monthlySavings)}</td>
                <td>固定費見直し後の差分を表示予定</td>
              </tr>
              <tr>
                <td>10年後資産</td>
                <td>{manYen(tenYear)}</td>
                <td>支出削減・転職・副業などの差分を表示予定</td>
              </tr>
              <tr>
                <td>30年後資産</td>
                <td>{manYen(thirtyYear)}</td>
                <td>複数シナリオを横並び比較予定</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="pro-grid">
        {[
          "複数シナリオ保存",
          "固定費見直しインパクト",
          "詳細収入変化",
          "詳細取り崩しシミュレーション",
          "月次/四半期レビュー",
          "家族/世帯モード",
          "PDFレポート",
          "クラウド保存予定"
        ].map((feature) => (
          <div className="pro-item" key={feature}>
            <strong>{feature}</strong>
            <span>Coming soon</span>
          </div>
        ))}
      </section>
    </div>
  );
}

function SettingsView({
  settings,
  updateSettings,
  setActiveView
}: {
  settings: AppSettings;
  updateSettings: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  setActiveView: (view: ViewKey) => void;
}) {
  return (
    <div className="view-stack">
      <section className="panel">
        <StepTitle step="1" title="表示スタイル" description="ライト、ダーク、端末設定に合わせる表示を選べます。" />
        <div className="setting-options" role="radiogroup" aria-label="表示スタイル">
          {[
            { value: "system", label: "システムに合わせる", helper: "端末やブラウザの設定を使います" },
            { value: "light", label: "ライト", helper: "明るい背景で表示します" },
            { value: "dark", label: "ダーク", helper: "暗い背景で表示します" }
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              className={settings.theme === option.value ? "setting-option active" : "setting-option"}
              onClick={() => updateSettings("theme", option.value as ThemePreference)}
            >
              <strong>{option.label}</strong>
              <span>{option.helper}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <StepTitle step="2" title="基本的な使い方" description="無料版で1つのライフプランを作る流れです。" />
        <ol className="manual-list">
          <li>ライフプランで年齢、家族構成、働き方、住居形態を入力します。</li>
          <li>家計入力と資産入力で、現在の収支と資産を整理します。</li>
          <li>目標管理で目標額と期限を入力し、達成したい年齢と達成年齢の目安を確認します。</li>
          <li>年表に住宅、教育、車、転職などのイベントを追加し、予定年齢を確認します。</li>
          <li>シミュレーションで年次見通しを確認し、グラフの点をタップして詳細を見ます。</li>
          <li>メモに次の見直しや判断の理由を残します。</li>
          <li>データ管理からJSONをエクスポートしてバックアップします。</li>
        </ol>
      </section>

      <section className="settings-grid">
        <div className="panel">
          <h2>データとプライバシー</h2>
          <p>初期版では入力データをサーバーに保存しません。データはこのブラウザ内に保存され、JSONでバックアップできます。</p>
          <button type="button" className="secondary" onClick={() => setActiveView("data")}>
            データ管理を開く
          </button>
        </div>
        <div className="panel">
          <h2>Pro機能</h2>
          <p>複数シナリオ比較、見直し履歴、PDFレポートなどを予定しています。初期版では課金処理は実装していません。</p>
          <button type="button" className="secondary" onClick={() => setActiveView("pro")}>
            Pro機能を見る
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>グラフの詳細表示</h2>
        <p>シミュレーション画面の年次見通しは、グラフ上の点をタップすると年末資産、前年差、年間貯蓄、イベント影響を確認できます。</p>
      </section>
    </div>
  );
}

function LegalView() {
  return (
    <div className="legal-layout">
      <LegalSection
        title="利用規約"
        items={[
          "Life Compass は教育・参考目的のライフプラン管理ツールです。",
          "ユーザーが入力した条件に基づき、家計、資産、目標、ライフイベントを整理するための表示を行います。",
          "表示される結果は将来の収益、資産形成、生活状況を保証するものではありません。",
          "実際の判断は必要に応じて専門家に相談してください。"
        ]}
      />
      <LegalSection
        title="プライバシーポリシー"
        items={[
          "初期版では、収入・支出・資産・家族情報などをサーバーに保存しません。",
          "データはユーザーのブラウザ内に保存されます。",
          "JSONエクスポートしたファイルの管理はユーザー自身で行います。",
          "将来クラウド保存を導入する場合は、保存先、利用目的、削除方法を明示します。"
        ]}
      />
      <LegalSection
        title="特定商取引法に基づく表記"
        items={[
          "初期版では課金機能を実装していません。",
          "Pro版は Coming soon であり、販売価格、提供条件、解約方法、事業者情報は正式提供時に表示します。",
          "月額500円程度を想定していますが、正式な提供条件ではありません。"
        ]}
      />
      <DisclaimerPanel />
    </div>
  );
}

function LegalSection({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="panel legal-section">
      <h2>{title}</h2>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function DisclaimerPanel() {
  return (
    <section className="panel legal-section">
      <h2>免責事項</h2>
      <ul>
        <li>このアプリは教育・参考目的のライフプラン管理ツールです。</li>
        <li>表示される結果は入力条件に基づく試算です。</li>
        <li>投資助言、税務助言、法律助言、保険助言ではありません。</li>
        <li>個別の金融商品、銘柄、保険商品等を推奨しません。</li>
        <li>実際の判断は必要に応じて専門家に相談してください。</li>
        <li>将来の収益や資産形成を保証するものではありません。</li>
      </ul>
    </section>
  );
}

function StepTitle({ step, title, description }: { step: string; title: string; description: string }) {
  return (
    <div className="step-title">
      <span>{step}</span>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  );
}

function MoneyInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label>
      {label}
      <NumericInput value={value} min={0} onChange={onChange} />
    </label>
  );
}

function NumericInput({
  value,
  onChange,
  min,
  max,
  allowDecimal = false
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  allowDecimal?: boolean;
}) {
  const [draft, setDraft] = useState(formatNumericText(value, allowDecimal));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setDraft(formatNumericText(value, allowDecimal));
    }
  }, [allowDecimal, isFocused, value]);

  const commitDraft = (nextDraft: string) => {
    const normalized = normalizeNumericText(nextDraft, allowDecimal);
    setDraft(normalized);
    onChange(clampNumber(parseNumericText(normalized), min, max));
  };

  return (
    <input
      inputMode={allowDecimal ? "decimal" : "numeric"}
      value={draft}
      onFocus={() => {
        setIsFocused(true);
        if (value === 0) {
          setDraft("");
        }
      }}
      onChange={(event) => commitDraft(event.target.value)}
      onBlur={() => {
        setIsFocused(false);
        const nextValue = clampNumber(parseNumericText(draft), min, max);
        onChange(nextValue);
        setDraft(formatNumericText(nextValue, allowDecimal));
      }}
    />
  );
}

type ChartPoint = {
  year: number;
  value: number;
  age?: number;
  annualSavings?: number;
  eventImpact?: number;
  eventTitles?: string[];
};

function LineChart({ points }: { points: ChartPoint[] }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  useEffect(() => {
    if (selectedIndex !== null && selectedIndex >= points.length) {
      setSelectedIndex(null);
    }
  }, [points.length, selectedIndex]);

  if (points.length === 0) return null;

  const width = 900;
  const height = 330;
  const padding = {
    top: 54,
    right: 42,
    bottom: 50,
    left: 76
  };
  const minValue = Math.min(...points.map((point) => point.value), 0);
  const maxValue = Math.max(...points.map((point) => point.value), 1);
  const valueRange = maxValue - minValue || 1;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const xStep = chartWidth / Math.max(points.length - 1, 1);
  const coordinates = points.map((point, index) => {
    const x = padding.left + index * xStep;
    const y = height - padding.bottom - ((point.value - minValue) / valueRange) * chartHeight;
    return { ...point, x, y };
  });
  const path = coordinates.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const selectedPoint = selectedIndex === null ? null : coordinates[selectedIndex];
  const previousPoint = selectedIndex !== null && selectedIndex > 0 ? coordinates[selectedIndex - 1] : undefined;
  const labelStep = points.length > 20 ? 5 : points.length > 12 ? 3 : 1;
  const selectedLabelY = selectedPoint ? (selectedPoint.y < padding.top + 28 ? selectedPoint.y + 26 : selectedPoint.y - 16) : 0;

  return (
    <div className="chart-block">
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="将来資産の見通しグラフ">
          <line
            x1={padding.left}
            y1={height - padding.bottom}
            x2={width - padding.right}
            y2={height - padding.bottom}
            className="axis"
          />
          <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} className="axis" />
          <text x={padding.left - 10} y={padding.top + 4} textAnchor="end" className="axis-label">
            {manYen(maxValue)}
          </text>
          <text x={padding.left - 10} y={height - padding.bottom + 4} textAnchor="end" className="axis-label">
            {manYen(minValue)}
          </text>
          <path d={path} className="chart-line" />
          {coordinates.map((point, index) => {
            const isSelected = selectedIndex === index;
            const showYearLabel = index % labelStep === 0 || index === coordinates.length - 1 || isSelected;
            return (
              <g key={point.year}>
                <g
                  role="button"
                  tabIndex={0}
                  className="chart-hit-button"
                  aria-label={`${point.year}年 ${manYen(point.value)}`}
                  onClick={() => setSelectedIndex(index)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedIndex(index);
                    }
                  }}
                >
                  <circle cx={point.x} cy={point.y} r="16" className="chart-hit-area" />
                  <circle cx={point.x} cy={point.y} r={isSelected ? "6" : "4"} className={isSelected ? "chart-dot selected" : "chart-dot"} />
                </g>
                {isSelected && (
                  <text x={point.x} y={selectedLabelY} textAnchor="middle" className="point-value-label">
                    {manYen(point.value)}
                  </text>
                )}
                {showYearLabel && (
                  <text x={point.x} y={height - 16} textAnchor="middle" className="year-label">
                    {point.year}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="chart-selection-panel" aria-live="polite">
        {selectedPoint ? (
          <>
            <div>
              <span>{selectedPoint.year}年{selectedPoint.age ? ` / ${selectedPoint.age}歳` : ""}</span>
              <strong>{manYen(selectedPoint.value)}</strong>
            </div>
            <div>
              <span>前年差</span>
              <strong>{previousPoint ? manYen(selectedPoint.value - previousPoint.value) : "-"}</strong>
            </div>
            {"annualSavings" in selectedPoint && (
              <div>
                <span>年間貯蓄</span>
                <strong>{selectedPoint.annualSavings ? manYen(selectedPoint.annualSavings) : "-"}</strong>
              </div>
            )}
            {"eventImpact" in selectedPoint && (
              <div>
                <span>イベント影響</span>
                <strong>{selectedPoint.eventImpact ? manYen(selectedPoint.eventImpact) : "-"}</strong>
              </div>
            )}
            {selectedPoint.eventTitles && selectedPoint.eventTitles.length > 0 && (
              <div className="chart-selection-wide">
                <span>イベント</span>
                <strong>{selectedPoint.eventTitles.join(" / ")}</strong>
              </div>
            )}
          </>
        ) : (
          <p>グラフ上の点をタップすると、その年の試算額を確認できます。</p>
        )}
      </div>
    </div>
  );
}

export default App;
