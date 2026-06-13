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
  ReviewNote,
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
  getGoalPreparedPercent,
  getInputCompletion,
  getMonthlyProjectionRows,
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
  { key: "pricing", label: "料金" },
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
  const normalized = value.replace(/,/g, "");
  if (normalized === "" || normalized === "-" || normalized === "." || normalized === "-.") return 0;
  const parsed = Number(normalized);
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

const getYearsUntilLabel = (year: number) => {
  const diff = year - new Date().getFullYear();
  if (diff < 0) return `${Math.abs(diff)}年前`;
  if (diff === 0) return "今年";
  return `あと約${diff}年`;
};

const cloneDefaultPlan = () => JSON.parse(JSON.stringify(defaultPlan)) as LifePlan;

const isSamplePlan = (plan: LifePlan) =>
  plan.profile.name === "マイプラン" &&
  plan.profile.age === 35 &&
  plan.goals.some((goal) => goal.title === "5年後に資産500万円") &&
  plan.events.some((event) => event.title === "資格取得");

const createEmptyPlan = (): LifePlan => ({
  version: 1,
  profile: {
    name: "新しいプラン",
    age: 0,
    familyType: "single",
    workStyle: "employee",
    housing: "rent"
  },
  household: {
    monthlyIncome: 0,
    annualBonus: 0,
    sideIncome: 0,
    fixedCost: 0,
    variableCost: 0,
    annualSpecialCost: 0
  },
  assets: {
    cash: 0,
    investment: 0,
    other: 0,
    debt: 0
  },
  goals: [],
  events: [],
  simulation: {
    monthlyContribution: 0,
    bonusContribution: 0,
    annualReturnRate: 0,
    years: 30
  },
  notes: {
    general: "",
    spendingReview: ""
  },
  reviews: [],
  updatedAt: new Date().toISOString()
});

type GoalTemplate = Omit<Goal, "id" | "dueYear" | "progress"> & {
  yearsFromNow: number;
};

const goalTemplates: GoalTemplate[] = [
  {
    title: "生活防衛資金を整える",
    goalType: "oneTime",
    yearsFromNow: 1,
    requiredAmount: 1500000,
    savedAmount: 0,
    monthlyAllocation: 50000,
    recurrence: "yearly",
    priority: "high",
    memo: "月間生活費をもとに、6〜12ヶ月分を目安として見直す"
  },
  {
    title: "住宅購入の頭金を準備",
    goalType: "oneTime",
    yearsFromNow: 5,
    requiredAmount: 5000000,
    savedAmount: 0,
    monthlyAllocation: 60000,
    recurrence: "yearly",
    priority: "medium",
    memo: "住宅購入の時期や必要額は定期的に見直す"
  },
  {
    title: "毎年旅行に行く",
    goalType: "recurring",
    yearsFromNow: 1,
    requiredAmount: 200000,
    savedAmount: 0,
    monthlyAllocation: 17000,
    recurrence: "yearly",
    priority: "medium",
    memo: "年1回の旅行予算として、年間特別支出にも反映する"
  },
  {
    title: "資格取得の費用を準備",
    goalType: "oneTime",
    yearsFromNow: 2,
    requiredAmount: 300000,
    savedAmount: 0,
    monthlyAllocation: 15000,
    recurrence: "yearly",
    priority: "low",
    memo: "受験料、教材費、講座費用などをまとめて確認する"
  }
];

type EventTemplate = Omit<LifeEvent, "id" | "year" | "age"> & {
  yearsFromNow: number;
};

const eventTemplates: EventTemplate[] = [
  {
    title: "転職",
    category: "career",
    yearsFromNow: 2,
    amount: 0,
    cashflowType: "neutral",
    memo: "年収や働き方の変化は家計入力も合わせて見直す"
  },
  {
    title: "引越し",
    category: "move",
    yearsFromNow: 1,
    amount: 500000,
    cashflowType: "expense",
    memo: "初期費用、家具家電、移動費など"
  },
  {
    title: "住宅購入",
    category: "home",
    yearsFromNow: 5,
    amount: 3000000,
    cashflowType: "expense",
    memo: "頭金や諸費用の概算。住宅ローンは資産入力の負債も確認する"
  },
  {
    title: "車購入",
    category: "car",
    yearsFromNow: 3,
    amount: 2000000,
    cashflowType: "expense",
    memo: "購入費、維持費、保険料など"
  },
  {
    title: "教育費",
    category: "education",
    yearsFromNow: 10,
    amount: 1000000,
    cashflowType: "expense",
    memo: "入学金、授業料、教材費など"
  },
  {
    title: "親の介護",
    category: "care",
    yearsFromNow: 8,
    amount: 600000,
    cashflowType: "expense",
    memo: "支援額や頻度は状況に合わせて見直す"
  }
];

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

  const addReview = () => {
    const assets = getAssetSummary(plan.assets);
    const cashflow = getCashflowSummary(plan.household);
    const nextReview: ReviewNote = {
      id: createId(),
      date: new Date().toISOString().slice(0, 10),
      plannedNetAssets: assets.netAssets,
      plannedMonthlySavings: cashflow.monthlySavings,
      actualNetAssets: assets.netAssets,
      actualMonthlySavings: cashflow.monthlySavings,
      memo: ""
    };
    commitPlan({ ...plan, reviews: [nextReview, ...(plan.reviews || [])] });
  };

  const updateReview = <K extends keyof ReviewNote>(id: string, key: K, value: ReviewNote[K]) => {
    commitPlan({
      ...plan,
      reviews: (plan.reviews || []).map((review) => (review.id === id ? { ...review, [key]: value } : review))
    });
  };

  const removeReview = (id: string) => {
    commitPlan({ ...plan, reviews: (plan.reviews || []).filter((review) => review.id !== id) });
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

  const addGoalFromTemplate = (template: GoalTemplate) => {
    const nextGoal: Goal = {
      id: createId(),
      title: template.title,
      goalType: template.goalType,
      dueYear: new Date().getFullYear() + template.yearsFromNow,
      requiredAmount: template.requiredAmount,
      savedAmount: template.savedAmount,
      monthlyAllocation: template.monthlyAllocation,
      recurrence: template.recurrence,
      priority: template.priority,
      progress: 0,
      memo: template.memo
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

  const addEventFromTemplate = (template: EventTemplate) => {
    const year = new Date().getFullYear() + template.yearsFromNow;
    const nextEvent: LifeEvent = {
      id: createId(),
      title: template.title,
      category: template.category,
      year,
      age: getTargetAgeForYear(plan.profile.age, year),
      amount: template.amount,
      cashflowType: template.cashflowType,
      memo: template.memo
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
    setImportMessage("サンプルプランに戻しました。");
  };

  const startEmptyPlan = () => {
    clearPlan();
    commitPlan(createEmptyPlan());
    setImportMessage("空のプランを作成しました。");
  };

  const renderView = () => {
    switch (activeView) {
      case "dashboard":
        return <Dashboard plan={plan} setActiveView={setActiveView} startEmptyPlan={startEmptyPlan} />;
      case "profile":
        return <ProfileView plan={plan} updateProfile={updateProfile} setActiveView={setActiveView} />;
      case "household":
        return <HouseholdView plan={plan} updateHousehold={updateHousehold} setActiveView={setActiveView} />;
      case "assets":
        return <AssetsView plan={plan} updateAssets={updateAssets} setActiveView={setActiveView} />;
      case "goals":
        return (
          <GoalsView
            plan={plan}
            setActiveView={setActiveView}
            addGoal={addGoal}
            addGoalFromTemplate={addGoalFromTemplate}
            updateGoal={updateGoal}
            removeGoal={removeGoal}
          />
        );
      case "timeline":
        return (
          <TimelineView
            plan={plan}
            setActiveView={setActiveView}
            addEvent={addEvent}
            addEventFromTemplate={addEventFromTemplate}
            updateEvent={updateEvent}
            updateEventSchedule={updateEventSchedule}
            removeEvent={removeEvent}
          />
        );
      case "simulation":
        return <SimulationView plan={plan} updateSimulation={updateSimulation} setActiveView={setActiveView} />;
      case "notes":
        return <NotesView plan={plan} updateNotes={updateNotes} addReview={addReview} updateReview={updateReview} removeReview={removeReview} />;
      case "data":
        return (
          <DataView
            plan={plan}
            commitPlan={commitPlan}
            importMessage={importMessage}
            setImportMessage={setImportMessage}
            resetPlan={resetPlan}
            startEmptyPlan={startEmptyPlan}
          />
        );
      case "pricing":
        return <PricingView setActiveView={setActiveView} />;
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
  startEmptyPlan: () => void;
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

function Dashboard({ plan, setActiveView, startEmptyPlan }: DashboardProps) {
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
  const missingItems = completion.items.filter((item) => !item.complete).slice(0, 3);
  const firstMissingView = completion.items.find((item) => !item.complete)?.view ?? "profile";
  const samplePlan = isSamplePlan(plan);
  const showStarterGuide = samplePlan || completion.percentage < 85;

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
                  : "すべてを一度に埋めなくても大丈夫です。プロフィール、家計、資産、目標、年表の順に入れると見通しが作りやすくなります。"}
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

      <section className="quick-action-grid" aria-label="よく使う操作">
        <button type="button" onClick={() => setActiveView(firstMissingView)}>
          <strong>入力を続ける</strong>
          <span>{completion.percentage >= 100 ? "入力済み項目を見直す" : `入力完了度 ${completion.percentage}%`}</span>
        </button>
        <button type="button" onClick={() => setActiveView("goals")}>
          <strong>目標を整える</strong>
          <span>{plan.goals.length > 0 ? `${plan.goals.length}件の目標` : "テンプレートから追加"}</span>
        </button>
        <button type="button" onClick={() => setActiveView("timeline")}>
          <strong>年表を確認</strong>
          <span>{plan.events.length > 0 ? `${plan.events.length}件のイベント` : "予定を追加"}</span>
        </button>
        <button type="button" onClick={() => setActiveView("data")}>
          <strong>バックアップ</strong>
          <span>JSONで保存</span>
        </button>
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

function Metric({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function StepFlowNav({
  previous,
  next,
  setActiveView
}: {
  previous?: { view: ViewKey; label: string };
  next?: { view: ViewKey; label: string };
  setActiveView: (view: ViewKey) => void;
}) {
  return (
    <section className="step-flow-nav" aria-label="入力の移動">
      {previous ? (
        <button type="button" className="secondary" onClick={() => setActiveView(previous.view)}>
          前へ: {previous.label}
        </button>
      ) : (
        <span />
      )}
      {next && (
        <button type="button" onClick={() => setActiveView(next.view)}>
          次へ: {next.label}
        </button>
      )}
    </section>
  );
}

function ProfileView({
  plan,
  updateProfile,
  setActiveView
}: {
  plan: LifePlan;
  updateProfile: <K extends keyof Profile>(key: K, value: Profile[K]) => void;
  setActiveView: (view: ViewKey) => void;
}) {
  return (
    <div className="view-stack">
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
      <section className="helper-grid">
        <div>
          <strong>年齢</strong>
          <span>目標の達成年齢、年表の予定年齢、将来見通しの表示に使います。</span>
        </div>
        <div>
          <strong>家族構成と働き方</strong>
          <span>生活防衛資金の目安月数を決めるための前提として使います。</span>
        </div>
        <div>
          <strong>住居形態</strong>
          <span>住宅ローンありの場合は、生活防衛資金をやや厚めに見ます。</span>
        </div>
      </section>
      <StepFlowNav setActiveView={setActiveView} next={{ view: "household", label: "家計入力" }} />
    </div>
  );
}

function HouseholdView({
  plan,
  updateHousehold,
  setActiveView
}: {
  plan: LifePlan;
  updateHousehold: <K extends keyof Household>(key: K, value: Household[K]) => void;
  setActiveView: (view: ViewKey) => void;
}) {
  const cashflow = getCashflowSummary(plan.household);
  const monthlySavingsTone =
    cashflow.monthlySavings < 0 ? "notice" : cashflow.savingsRate >= 20 ? "good" : cashflow.monthlySavings > 0 ? "check" : "neutral";
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
      <section className={`notice-band ${monthlySavingsTone}`}>
        <strong>
          {cashflow.monthlySavings < 0
            ? "毎月の収支がマイナスです"
            : cashflow.savingsRate >= 20
              ? "貯蓄率は高めの前提です"
              : cashflow.monthlySavings > 0
                ? "毎月の貯蓄が見込めます"
                : "収支がほぼ同じです"}
        </strong>
        <span>
          {cashflow.monthlySavings < 0
            ? "入力ミスがないか確認し、固定費、変動費、年間特別支出のどこが大きいかを見直すと次の判断がしやすくなります。"
            : "この毎月貯蓄額が、目標達成目安、生活防衛資金の到達目安、将来資産の見通しに使われます。"}
        </span>
      </section>
      <section className="helper-grid">
        <div>
          <strong>固定費</strong>
          <span>家賃、通信費、保険、サブスク、ローンなど毎月おおむね決まって出る支出です。</span>
        </div>
        <div>
          <strong>変動費</strong>
          <span>食費、日用品、交際費、交通費など月によって変わる支出です。</span>
        </div>
        <div>
          <strong>年間特別支出</strong>
          <span>旅行、家電、帰省、税金、車検など年に数回ある支出を年額で入れます。</span>
        </div>
      </section>
      <StepFlowNav
        setActiveView={setActiveView}
        previous={{ view: "profile", label: "基本情報" }}
        next={{ view: "assets", label: "資産入力" }}
      />
    </div>
  );
}

function AssetsView({
  plan,
  updateAssets,
  setActiveView
}: {
  plan: LifePlan;
  updateAssets: <K extends keyof Assets>(key: K, value: Assets[K]) => void;
  setActiveView: (view: ViewKey) => void;
}) {
  const assets = getAssetSummary(plan.assets);
  const cashShare = assets.grossAssets > 0 ? Math.round((plan.assets.cash / assets.grossAssets) * 100) : 0;
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
      <section className="helper-grid">
        <div>
          <strong>現金比率</strong>
          <span>総資産のうち現金は約{cashShare}%です。生活防衛資金チェックでは現金額を使います。</span>
        </div>
        <div>
          <strong>負債の扱い</strong>
          <span>住宅ローンや借入は資産合計から差し引き、純資産として表示します。</span>
        </div>
        <div>
          <strong>入力の目安</strong>
          <span>細かく分けすぎず、まずは現金、投資資産、その他資産、負債の4つで整理します。</span>
        </div>
      </section>
      <StepFlowNav
        setActiveView={setActiveView}
        previous={{ view: "household", label: "家計入力" }}
        next={{ view: "goals", label: "目標管理" }}
      />
    </div>
  );
}

function GoalsView({
  plan,
  setActiveView,
  addGoal,
  addGoalFromTemplate,
  updateGoal,
  removeGoal
}: {
  plan: LifePlan;
  setActiveView: (view: ViewKey) => void;
  addGoal: () => void;
  addGoalFromTemplate: (template: GoalTemplate) => void;
  updateGoal: <K extends keyof Goal>(id: string, key: K, value: Goal[K]) => void;
  removeGoal: (id: string) => void;
}) {
  const [goalSearch, setGoalSearch] = useState("");
  const [goalSort, setGoalSort] = useState<"dueYear" | "priority" | "progress" | "title">("dueYear");
  const priorityRank: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
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

  return (
    <div className="view-stack">
      <section className="panel">
        <div className="section-heading">
          <StepTitle step="4" title="目標管理" description="期限、目標額、優先度、準備状況を整理します。" />
          <button type="button" onClick={addGoal}>
            目標を追加
          </button>
        </div>
        <div className="template-panel" aria-label="目標テンプレート">
          <div>
            <strong>テンプレートから追加</strong>
            <span>あとで金額や期限を自由に変更できます。</span>
          </div>
          <div className="template-actions">
            {goalTemplates.map((template) => (
              <button type="button" className="secondary" key={template.title} onClick={() => addGoalFromTemplate(template)}>
                {template.title}
              </button>
            ))}
          </div>
        </div>
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
          <span>{goalAchievements.length}件表示 / 全{plan.goals.length}件</span>
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
            {plan.goals.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  <EmptyState title="まだ目標がありません" detail="テンプレートから1つ追加するか、目標を追加ボタンで自由に作れます。" />
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
          <EmptyState title="まだ目標がありません" detail="テンプレートから1つ追加するか、目標を追加ボタンで自由に作れます。" />
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
              <GoalAchievementSummary goal={goal} achievement={achievement} />
              <button type="button" className="text-button mobile-delete-button" onClick={() => removeGoal(goal.id)}>
                削除
              </button>
            </div>
          ))
        )}
        </div>
      </section>
      <StepFlowNav
        setActiveView={setActiveView}
        previous={{ view: "assets", label: "資産入力" }}
        next={{ view: "timeline", label: "年表" }}
      />
    </div>
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
        : "未達見込み";

  return <span className={`status-pill ${achievement.status}`}>{label}</span>;
}

type CalendarEntry = {
  id: string;
  year: number;
  title: string;
  kind: "goal" | "event";
  detail: string;
  amount?: number;
  tone: "goal" | "expense" | "income" | "neutral";
  progress?: number;
};

function LifeCalendar({ plan }: { plan: LifePlan }) {
  const [rangeYears, setRangeYears] = useState<5 | 10 | 30>(10);
  const [entrySearch, setEntrySearch] = useState("");
  const [entryKind, setEntryKind] = useState<"all" | "goal" | "event">("all");
  const [entrySort, setEntrySort] = useState<"yearAsc" | "yearDesc" | "title">("yearAsc");
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: rangeYears + 1 }, (_, index) => currentYear + index);
  const entries = useMemo<CalendarEntry[]>(() => {
    const goalEntries = plan.goals.map((goal) => {
      const preparedPercent = getGoalPreparedPercent(goal);
      return {
        id: `goal-${goal.id}`,
        year: goal.dueYear,
        title: goal.title,
        kind: "goal" as const,
        detail:
          goal.goalType === "recurring"
            ? `${getRecurrenceLabel(goal.recurrence)} / 年間準備率 ${preparedPercent}%`
            : `達成率 ${preparedPercent}% / 残り ${manYen(Math.max(0, goal.requiredAmount - goal.savedAmount))}`,
        amount: goal.requiredAmount,
        tone: "goal" as const,
        progress: preparedPercent
      };
    });

    const eventEntries = plan.events.map((event) => ({
      id: `event-${event.id}`,
      year: event.year,
      title: event.title,
      kind: "event" as const,
      detail: cashflowLabels[event.cashflowType],
      amount: event.amount,
      tone: event.cashflowType
    }));

    return [...goalEntries, ...eventEntries].sort((a, b) => a.year - b.year || a.title.localeCompare(b.title, "ja"));
  }, [plan.events, plan.goals]);
  const visibleEntries = useMemo(() => {
    const normalizedSearch = entrySearch.trim().toLowerCase();
    return entries
      .filter((entry) => entry.year >= currentYear && entry.year <= currentYear + rangeYears)
      .filter((entry) => (entryKind === "all" ? true : entry.kind === entryKind))
      .filter((entry) => (normalizedSearch ? `${entry.title} ${entry.detail}`.toLowerCase().includes(normalizedSearch) : true))
      .sort((a, b) => {
        if (entrySort === "yearDesc") return b.year - a.year || a.title.localeCompare(b.title, "ja");
        if (entrySort === "title") return a.title.localeCompare(b.title, "ja") || a.year - b.year;
        return a.year - b.year || a.title.localeCompare(b.title, "ja");
      });
  }, [currentYear, entries, entryKind, entrySearch, entrySort, rangeYears]);
  const upcomingEntries = [...visibleEntries].sort((a, b) => a.year - b.year || a.title.localeCompare(b.title, "ja")).slice(0, 4);

  return (
    <section className="life-calendar" aria-label="ライフカレンダー">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ライフカレンダー</p>
          <h3>目標とイベントを年単位で確認</h3>
          <p>目標の期限とライフイベントをまとめて並べ、短期から長期までの残り期間を確認できます。</p>
        </div>
        <div className="segmented-control" aria-label="表示期間">
          <button type="button" className={rangeYears === 5 ? "active" : ""} onClick={() => setRangeYears(5)}>
            5年
          </button>
          <button type="button" className={rangeYears === 10 ? "active" : ""} onClick={() => setRangeYears(10)}>
            10年
          </button>
          <button type="button" className={rangeYears === 30 ? "active" : ""} onClick={() => setRangeYears(30)}>
            30年
          </button>
        </div>
      </div>

      {upcomingEntries.length > 0 && (
        <div className="calendar-next-list" aria-label="近い予定">
          {upcomingEntries.map((entry) => (
            <div key={entry.id}>
              <span>{getYearsUntilLabel(entry.year)}</span>
              <strong>{entry.title}</strong>
              <small>{entry.year}年 / {getTargetAgeForYear(plan.profile.age, entry.year)}歳頃</small>
            </div>
          ))}
        </div>
      )}

      <div className="list-toolbar" aria-label="カレンダーの検索と整理">
        <label>
          検索
          <input value={entrySearch} onChange={(event) => setEntrySearch(event.target.value)} placeholder="目標名・イベント名で検索" />
        </label>
        <label>
          種類
          <select value={entryKind} onChange={(event) => setEntryKind(event.target.value as "all" | "goal" | "event")}>
            <option value="all">すべて</option>
            <option value="goal">目標のみ</option>
            <option value="event">イベントのみ</option>
          </select>
        </label>
        <label>
          並び替え
          <select value={entrySort} onChange={(event) => setEntrySort(event.target.value as "yearAsc" | "yearDesc" | "title")}>
            <option value="yearAsc">時期が近い順</option>
            <option value="yearDesc">時期が遠い順</option>
            <option value="title">名前順</option>
          </select>
        </label>
        <span>{visibleEntries.length}件表示 / 全{entries.length}件</span>
      </div>

      <div className="calendar-grid">
        {years.map((year) => {
          const yearEntries = visibleEntries.filter((entry) => entry.year === year);
          const shownYearEntries = yearEntries.slice(0, 3);
          const hiddenCount = Math.max(0, yearEntries.length - shownYearEntries.length);
          return (
            <div className={year === currentYear ? "calendar-year-card current" : "calendar-year-card"} key={year}>
              <div className="calendar-year-head">
                <strong>{year}</strong>
                <span>{getTargetAgeForYear(plan.profile.age, year)}歳頃</span>
              </div>
              {yearEntries.length === 0 ? (
                <p>予定なし</p>
              ) : (
                <div className="calendar-entry-list">
                  {shownYearEntries.map((entry) => (
                    <div className={`calendar-entry ${entry.tone}`} key={entry.id}>
                      <div>
                        <span>{entry.kind === "goal" ? "目標" : "イベント"}</span>
                        <strong>{entry.title}</strong>
                      </div>
                      <small>{entry.detail}</small>
                      {entry.amount ? <small>{manYen(entry.amount)}</small> : null}
                      {typeof entry.progress === "number" && (
                        <div className="calendar-progress" aria-label={`達成率 ${entry.progress}%`}>
                          <span style={{ width: `${entry.progress}%` }} />
                        </div>
                      )}
                    </div>
                  ))}
                  {hiddenCount > 0 && <span className="calendar-more">他{hiddenCount}件は下の一覧で確認</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="calendar-list-panel" aria-label="目標とイベントの一覧">
        {visibleEntries.length === 0 ? (
          <EmptyState title="条件に合う予定がありません" detail="検索条件や表示期間を変えて確認してください。" />
        ) : (
          visibleEntries.map((entry) => (
            <div className={`calendar-list-row ${entry.tone}`} key={entry.id}>
              <div>
                <span>{entry.kind === "goal" ? "目標" : "イベント"}</span>
                <strong>{entry.title}</strong>
              </div>
              <div>
                <span>{entry.year}年 / {getTargetAgeForYear(plan.profile.age, entry.year)}歳頃</span>
                <small>{getYearsUntilLabel(entry.year)}</small>
              </div>
              <div>
                <span>{entry.detail}</span>
                {entry.amount ? <small>{manYen(entry.amount)}</small> : null}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function TimelineView({
  plan,
  setActiveView,
  addEvent,
  addEventFromTemplate,
  updateEvent,
  updateEventSchedule,
  removeEvent
}: {
  plan: LifePlan;
  setActiveView: (view: ViewKey) => void;
  addEvent: () => void;
  addEventFromTemplate: (template: EventTemplate) => void;
  updateEvent: <K extends keyof LifeEvent>(id: string, key: K, value: LifeEvent[K]) => void;
  updateEventSchedule: (id: string, year: number) => void;
  removeEvent: (id: string) => void;
}) {
  const [eventSearch, setEventSearch] = useState("");
  const [eventSort, setEventSort] = useState<"yearAsc" | "yearDesc" | "title" | "type">("yearAsc");
  const sortedEvents = useMemo(() => {
    const normalizedSearch = eventSearch.trim().toLowerCase();
    return [...plan.events]
      .filter((event) =>
        normalizedSearch
          ? `${event.title} ${event.memo} ${eventCategoryLabels[event.category]}`.toLowerCase().includes(normalizedSearch)
          : true
      )
      .sort((a, b) => {
        if (eventSort === "yearDesc") return b.year - a.year || a.title.localeCompare(b.title, "ja");
        if (eventSort === "title") return a.title.localeCompare(b.title, "ja") || a.year - b.year;
        if (eventSort === "type") return eventCategoryLabels[a.category].localeCompare(eventCategoryLabels[b.category], "ja") || a.year - b.year;
        return a.year - b.year || a.title.localeCompare(b.title, "ja");
      });
  }, [eventSearch, eventSort, plan.events]);
  return (
    <div className="view-stack">
      <section className="panel">
        <div className="section-heading">
          <StepTitle step="5" title="ライフイベント年表" description="予定年、金額、家計への影響を整理し、資産見通しに反映できます。" />
          <button type="button" onClick={addEvent}>
            イベントを追加
          </button>
        </div>
        <LifeCalendar plan={plan} />
        <div className="template-panel" aria-label="ライフイベントテンプレート">
          <div>
            <strong>テンプレートから追加</strong>
            <span>予定年、金額、家計への影響は追加後に変更できます。</span>
          </div>
          <div className="template-actions">
            {eventTemplates.map((template) => (
              <button type="button" className="secondary" key={template.title} onClick={() => addEventFromTemplate(template)}>
                {template.title}
              </button>
            ))}
          </div>
        </div>
        <section className="helper-grid compact">
        <div>
          <strong>支出として反映</strong>
          <span>住宅購入、車購入、旅行、教育費など、その年にまとまって出る支出に使います。</span>
        </div>
        <div>
          <strong>収入・資産増として反映</strong>
          <span>退職金、売却益、補助金など、その年に増える金額を記録するときに使います。</span>
        </div>
        <div>
          <strong>記録のみ</strong>
          <span>転職や結婚など、金額をまだ決めない予定を年表に残すときに使います。</span>
        </div>
        </section>
        <div className="list-toolbar" aria-label="イベントの検索と並び替え">
          <label>
            イベントを検索
            <input value={eventSearch} onChange={(event) => setEventSearch(event.target.value)} placeholder="イベント名やメモで検索" />
          </label>
          <label>
            並び替え
            <select value={eventSort} onChange={(event) => setEventSort(event.target.value as "yearAsc" | "yearDesc" | "title" | "type")}>
              <option value="yearAsc">時期が近い順</option>
              <option value="yearDesc">時期が遠い順</option>
              <option value="title">名前順</option>
              <option value="type">種類順</option>
            </select>
          </label>
          <span>{sortedEvents.length}件表示 / 全{plan.events.length}件</span>
        </div>
        <div className="timeline">
        {plan.events.length === 0 ? (
          <EmptyState title="まだ年表イベントがありません" detail="転職、引越し、住宅購入などをテンプレートから追加すると、将来見通しに反映できます。" />
        ) : sortedEvents.length === 0 ? (
          <EmptyState title="条件に合うイベントがありません" detail="検索文字を変えるか、並び替えを戻して確認してください。" />
        ) : (
          sortedEvents.map((event) => (
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
          ))
        )}
        </div>
      </section>
      <StepFlowNav
        setActiveView={setActiveView}
        previous={{ view: "goals", label: "目標管理" }}
        next={{ view: "simulation", label: "シミュレーション" }}
      />
    </div>
  );
}

function SimulationView({
  plan,
  updateSimulation,
  setActiveView
}: {
  plan: LifePlan;
  updateSimulation: <K extends keyof SimulationSettings>(key: K, value: SimulationSettings[K]) => void;
  setActiveView: (view: ViewKey) => void;
}) {
  const [projectionMode, setProjectionMode] = useState<"annual" | "monthly">("annual");
  const [projectionYears, setProjectionYears] = useState<10 | 30>(30);
  const [projectionMonths, setProjectionMonths] = useState<12 | 24>(24);
  const projection10 = useMemo(() => projectAssets(plan, 10), [plan]);
  const projection30 = useMemo(() => projectAssets(plan, 30), [plan]);
  const annualRows = useMemo(() => getAnnualProjectionRows(plan, projectionYears), [plan, projectionYears]);
  const monthlyRows = useMemo(() => getMonthlyProjectionRows(plan, projectionMonths), [plan, projectionMonths]);
  const emergency = getEmergencyFundResult(plan);
  const contribution = simulateContribution(plan.simulation);
  const chartRows = projectionMode === "annual" ? annualRows : monthlyRows;

  return (
    <div className="view-stack">
      <section className="panel">
        <div className="section-heading">
          <StepTitle step="6" title="基本資産推移" description="入力条件に基づく10年/30年の見通しです。" />
          <div className="simulation-controls">
            <div className="segmented-control" aria-label="表示単位">
              <button type="button" className={projectionMode === "annual" ? "active" : ""} onClick={() => setProjectionMode("annual")}>
                年次
              </button>
              <button type="button" className={projectionMode === "monthly" ? "active" : ""} onClick={() => setProjectionMode("monthly")}>
                月次
              </button>
            </div>
            {projectionMode === "annual" ? (
              <div className="segmented-control" aria-label="表示期間">
                <button type="button" className={projectionYears === 10 ? "active" : ""} onClick={() => setProjectionYears(10)}>
                  10年
                </button>
                <button type="button" className={projectionYears === 30 ? "active" : ""} onClick={() => setProjectionYears(30)}>
                  30年
                </button>
              </div>
            ) : (
              <div className="segmented-control" aria-label="月次表示期間">
                <button type="button" className={projectionMonths === 12 ? "active" : ""} onClick={() => setProjectionMonths(12)}>
                  12ヶ月
                </button>
                <button type="button" className={projectionMonths === 24 ? "active" : ""} onClick={() => setProjectionMonths(24)}>
                  24ヶ月
                </button>
              </div>
            )}
          </div>
        </div>
        <LineChart points={chartRows} />
        <div className="calculation-band compact">
          <Metric label="10年後" value={manYen(projection10[10]?.value ?? 0)} helper="前提条件に基づく試算" />
          <Metric label="30年後" value={manYen(projection30[30]?.value ?? 0)} helper="前提条件に基づく試算" />
        </div>
        {projectionMode === "monthly" && (
          <div className="table-wrap projection-detail-table">
            <table>
              <thead>
                <tr>
                  <th>月</th>
                  <th>試算額</th>
                  <th>月間貯蓄</th>
                  <th>イベント影響</th>
                  <th>利回り等</th>
                </tr>
              </thead>
              <tbody>
                {monthlyRows.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td>{manYen(row.value)}</td>
                    <td>{row.monthlySavings ? manYen(row.monthlySavings) : "-"}</td>
                    <td>
                      {row.eventImpact ? manYen(row.eventImpact) : "-"}
                      {row.eventTitles.length > 0 ? <small>{row.eventTitles.join(" / ")}</small> : null}
                    </td>
                    <td>{row.returnImpact ? manYen(row.returnImpact) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
        <div className="explanation-grid">
          <div>
            <strong>計算式</strong>
            <span>月間生活費 × 目安月数で確認します。ここでは生活費を固定費、変動費、年間特別支出の月割で見ています。</span>
          </div>
          <div>
            <strong>目安月数の考え方</strong>
            <span>{emergency.note} あくまで整理用の目安で、実際に必要な金額は働き方、家族構成、住居、医療費などで変わります。</span>
          </div>
          <div>
            <strong>見直しの使い方</strong>
            <span>不足がある場合は、毎月の貯蓄額や目標の優先度と並べて確認します。余裕がある場合も使途を決めておくと見返しやすくなります。</span>
          </div>
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
      <StepFlowNav
        setActiveView={setActiveView}
        previous={{ view: "timeline", label: "年表" }}
        next={{ view: "data", label: "バックアップ" }}
      />
    </div>
  );
}

function NotesView({
  plan,
  updateNotes,
  addReview,
  updateReview,
  removeReview
}: {
  plan: LifePlan;
  updateNotes: <K extends keyof PlanNotes>(key: K, value: PlanNotes[K]) => void;
  addReview: () => void;
  updateReview: <K extends keyof ReviewNote>(id: string, key: K, value: ReviewNote[K]) => void;
  removeReview: (id: string) => void;
}) {
  const sortedReviews = [...(plan.reviews || [])].sort((a, b) => b.date.localeCompare(a.date));
  const chronologicalReviews = [...(plan.reviews || [])].sort((a, b) => a.date.localeCompare(b.date));
  const previousReviewById = new Map<string, ReviewNote | undefined>();
  chronologicalReviews.forEach((review, index) => previousReviewById.set(review.id, chronologicalReviews[index - 1]));

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
        <div className="section-heading">
          <div>
            <h2>実績チェック</h2>
            <p>予定として控えた数値と、実際の純資産・毎月貯蓄を比べて見直せます。</p>
          </div>
          <button type="button" onClick={addReview}>
            実績を追加
          </button>
        </div>
        {sortedReviews.length === 0 ? (
          <EmptyState title="まだ実績がありません" detail="実績を追加すると、予定値と実績値、前回比を残せます。" />
        ) : (
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
        )}
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
  resetPlan,
  startEmptyPlan
}: {
  plan: LifePlan;
  commitPlan: (plan: LifePlan) => void;
  importMessage: string;
  setImportMessage: (message: string) => void;
  resetPlan: () => void;
  startEmptyPlan: () => void;
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
    if (window.confirm("現在の入力内容をサンプルプランに戻します。必要な場合は先にJSONエクスポートしてください。")) {
      resetPlan();
    }
  };

  const handleStartEmpty = () => {
    if (window.confirm("現在の入力内容を消して、空のプランを作成します。必要な場合は先にJSONエクスポートしてください。")) {
      startEmptyPlan();
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
          <button type="button" className="secondary" onClick={handleReset}>
            サンプルプランに戻す
          </button>
          <button type="button" className="danger" onClick={handleStartEmpty}>
            空のプランを作成
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
            <strong>この端末で使うとき</strong>
            <span>入力内容はこのブラウザ内に保存されます。サーバーには送信しない前提のため、別の端末や別のブラウザには自動同期されません。</span>
          </div>
          <div>
            <strong>バックアップするとき</strong>
            <span>JSONエクスポートを押すと、現在の入力内容をファイルとして保存できます。端末変更、ブラウザ変更、閲覧データ削除の前に使います。</span>
          </div>
          <div>
            <strong>復元するとき</strong>
            <span>JSONインポートから保存済みファイルを選ぶと、このブラウザ内のプランに反映されます。</span>
          </div>
          <div>
            <strong>サンプルと空プラン</strong>
            <span>使い方を確認したい場合はサンプルプラン、最初から入力したい場合は空のプランを使います。どちらも現在の入力内容を置き換えます。</span>
          </div>
        </div>
        {importMessage && <p className="message">{importMessage}</p>}
      </section>
      <DisclaimerPanel />
    </div>
  );
}

function PricingView({ setActiveView }: { setActiveView: (view: ViewKey) => void }) {
  return (
    <div className="view-stack">
      <section className="pro-hero">
        <div>
          <p className="eyebrow">料金</p>
          <h2>無料版を中心に、Pro版は Coming soon</h2>
          <p>現在は課金機能を実装していません。将来のPro版に備えて、無料版とPro版の機能境界だけを明確にしています。</p>
        </div>
        <span className="lock-badge">課金なし</span>
      </section>

      <section className="pricing-grid">
        <div className="pricing-card current">
          <span>現在利用可能</span>
          <h2>無料版</h2>
          <strong>0円</strong>
          <ul>
            <li>1つのライフプラン作成・保存</li>
            <li>家計、資産、目標、年表、メモ</li>
            <li>生活防衛資金チェック</li>
            <li>基本資産推移と簡易積立の参考試算</li>
            <li>ブラウザ内保存とJSONバックアップ</li>
          </ul>
          <button type="button" onClick={() => setActiveView("dashboard")}>
            ダッシュボードへ
          </button>
        </div>

        <div className="pricing-card">
          <span>Coming soon</span>
          <h2>Pro版</h2>
          <strong>{proPriceLabel}</strong>
          <ul>
            <li>複数シナリオ保存と比較</li>
            <li>固定費見直しインパクト</li>
            <li>見直し履歴と月次/四半期レビュー</li>
            <li>詳細取り崩しシミュレーション</li>
            <li>PDFレポートとクラウド保存予定</li>
          </ul>
          <button type="button" className="secondary" onClick={() => setActiveView("pro")}>
            Pro予定を見る
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>課金導入前の方針</h2>
        <div className="boundary-grid">
          <div>
            <strong>今は決済情報を入力しません</strong>
            <p>Stripe、PayPalなどの決済手段は未定です。現在のアプリ内でカード番号や決済情報を入力する場所はありません。</p>
          </div>
          <div>
            <strong>正式提供時に明記すること</strong>
            <p>価格、更新日、解約方法、返金条件、事業者情報、サポート窓口を料金ページと法務ページに掲載します。</p>
          </div>
        </div>
      </section>
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
          <div className="button-row">
            <button type="button" className="secondary" onClick={() => setActiveView("pricing")}>
              料金を見る
            </button>
            <button type="button" className="secondary" onClick={() => setActiveView("pro")}>
              Pro機能を見る
            </button>
          </div>
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
  const legalDocuments = [
    {
      title: "利用規約",
      items: [
        "Life Compass は、家計、資産、目標、ライフイベントを整理するためのライフプラン管理ツールです。",
        "表示される結果は、ユーザーが入力した条件に基づく試算です。",
        "本サービスは投資助言、税務助言、法律助言、保険助言を行うものではありません。",
        "ユーザーは自身の判断と責任で本サービスを利用します。必要に応じて専門家に相談してください。",
        "サービス内容、画面、機能、提供条件は改善のため変更される場合があります。"
      ]
    },
    {
      title: "プライバシーポリシー",
      items: [
        "初期版では、収入、支出、資産、家族情報などをサーバーに保存しません。",
        "入力データはユーザーのブラウザ内に保存されます。ログイン機能やクラウド保存は未実装です。",
        "JSONエクスポートしたファイルの保管、共有、削除はユーザー自身で管理してください。",
        "将来クラウド保存やログイン機能を導入する場合は、保存先、利用目的、削除方法、問い合わせ先を明示します。",
        "アクセス解析やエラー収集を導入する場合も、収集内容と目的をこのページで説明します。"
      ]
    },
    {
      title: "特定商取引法に基づく表記",
      items: [
        "現在は課金機能を実装しておらず、有料販売は行っていません。",
        "Pro版は Coming soon であり、現時点の月額500円程度という表示は想定であって正式な販売条件ではありません。",
        "正式提供時には、販売価格、支払方法、提供時期、解約方法、返金条件、事業者名、所在地、連絡先などを明記します。",
        "決済手段が決まり次第、Stripe、PayPalなどの利用先と決済情報の取り扱いを説明します。"
      ]
    },
    {
      title: "返金ポリシー",
      items: [
        "現在は有料課金がないため、返金対象となる購入はありません。",
        "Pro版を正式提供する場合は、返金可否、返金申請方法、対象期間、対象外となるケースを事前に明記します。",
        "決済事業者を利用する場合、返金処理の反映時期は決済事業者の仕様に従う可能性があります。"
      ]
    },
    {
      title: "解約ポリシー",
      items: [
        "現在はサブスクリプション課金がないため、解約手続きはありません。",
        "Pro版を正式提供する場合は、更新日、解約方法、解約後に利用できる機能、データの扱いを明記します。",
        "無料版のブラウザ内データは、ユーザー自身がデータ管理画面またはブラウザ機能で削除できます。"
      ]
    }
  ];

  return (
    <div className="legal-layout">
      <section className="panel legal-intro">
        <p className="eyebrow">法務ページ</p>
        <h2>利用条件とデータの扱い</h2>
        <p>現在は無料版のみを提供し、課金機能はありません。将来Pro版を正式提供する前に、料金、返金、解約、事業者情報を確定して追記します。</p>
      </section>
      {legalDocuments.map((document) => (
        <LegalSection key={document.title} title={document.title} items={document.items} />
      ))}
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
  const initialDraft = formatNumericText(value, allowDecimal);
  const [draft, setDraft] = useState(initialDraft);
  const draftRef = useRef(initialDraft);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      const formatted = formatNumericText(value, allowDecimal);
      draftRef.current = formatted;
      setDraft(formatted);
    }
  }, [allowDecimal, isFocused, value]);

  const commitDraft = (nextDraft: string) => {
    const normalized = normalizeNumericText(nextDraft, allowDecimal);
    draftRef.current = normalized;
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
          draftRef.current = "";
          setDraft("");
        } else {
          const editable = normalizeNumericText(draftRef.current, allowDecimal);
          draftRef.current = editable;
          setDraft(editable);
        }
      }}
      onChange={(event) => commitDraft(event.target.value)}
      onBlur={() => {
        setIsFocused(false);
        const nextValue = clampNumber(parseNumericText(draftRef.current), min, max);
        onChange(nextValue);
        const formatted = formatNumericText(nextValue, allowDecimal);
        draftRef.current = formatted;
        setDraft(formatted);
      }}
    />
  );
}

type ChartPoint = {
  year: number;
  month?: number;
  label?: string;
  value: number;
  age?: number;
  annualSavings?: number;
  monthlySavings?: number;
  eventImpact?: number;
  returnImpact?: number;
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
  const selectedPointLabel = selectedPoint?.label ?? (selectedPoint ? `${selectedPoint.year}年` : "");
  const isMonthly = Boolean(selectedPoint && "monthlySavings" in selectedPoint);

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
            const pointLabel = point.label ?? `${point.year}`;
            return (
              <g key={`${pointLabel}-${index}`}>
                <g
                  role="button"
                  tabIndex={0}
                  className="chart-hit-button"
                  aria-label={`${pointLabel} ${manYen(point.value)}`}
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
                    {pointLabel}
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
              <span>{selectedPointLabel}{selectedPoint.age ? ` / ${selectedPoint.age}歳` : ""}</span>
              <strong>{manYen(selectedPoint.value)}</strong>
            </div>
            <div>
              <span>{isMonthly ? "前月差" : "前年差"}</span>
              <strong>{previousPoint ? manYen(selectedPoint.value - previousPoint.value) : "-"}</strong>
            </div>
            {"annualSavings" in selectedPoint && (
              <div>
                <span>年間貯蓄</span>
                <strong>{selectedPoint.annualSavings ? manYen(selectedPoint.annualSavings) : "-"}</strong>
              </div>
            )}
            {"monthlySavings" in selectedPoint && (
              <div>
                <span>月間貯蓄</span>
                <strong>{selectedPoint.monthlySavings ? manYen(selectedPoint.monthlySavings) : "-"}</strong>
              </div>
            )}
            {"eventImpact" in selectedPoint && (
              <div>
                <span>イベント影響</span>
                <strong>{selectedPoint.eventImpact ? manYen(selectedPoint.eventImpact) : "-"}</strong>
              </div>
            )}
            {"returnImpact" in selectedPoint && (
              <div>
                <span>利回り等の影響</span>
                <strong>{selectedPoint.returnImpact ? manYen(selectedPoint.returnImpact) : "-"}</strong>
              </div>
            )}
            {selectedPoint.eventTitles && selectedPoint.eventTitles.length > 0 && (
              <div className="chart-selection-wide">
                <span>イベント</span>
                <strong>{selectedPoint.eventTitles.join(" / ")}</strong>
              </div>
            )}
            {"annualSavings" in selectedPoint && (
              <div className="chart-selection-wide">
                <span>この年の見方</span>
                <strong>前年差 = 年間貯蓄 + イベント影響 + 利回り等の影響</strong>
              </div>
            )}
            {"monthlySavings" in selectedPoint && (
              <div className="chart-selection-wide">
                <span>この月の見方</span>
                <strong>前月差 = 月間貯蓄 + イベント影響 + 利回り等の影響</strong>
              </div>
            )}
          </>
        ) : (
          <p>グラフ上の点をタップすると、その時点の試算額を確認できます。</p>
        )}
      </div>
    </div>
  );
}

export default App;
