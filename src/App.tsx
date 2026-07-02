import { useEffect, useMemo, useState } from "react";
import { CURRENT_PLAN_VERSION } from "./config";
import { EmptyState, Metric, MoneyInput, NumericInput, StepFlowNav, StepTitle } from "./components/CommonUi";
import { createId, defaultPlan } from "./data/defaultPlan";
import { proPriceLabel } from "./features";
import { LegalDocumentView, LegalIndexView, type LegalDocumentKey } from "./views/LegalView";
import { PricingView as PricingPage } from "./views/PricingView";
import { DataView as DataPage } from "./views/DataView";
import type {
  Assets,
  BudgetCategory,
  BudgetFrequency,
  BudgetItem,
  CashflowType,
  EventOwner,
  FamilyType,
  FixedCostCategory,
  FixedCostItem,
  Goal,
  Household,
  Housing,
  LifeEvent,
  LifeEventCategory,
  LifePlan,
  PlanNotes,
  PlanScenario,
  Priority,
  Profile,
  RecurrenceInterval,
  RetirementPlanSettings,
  ReviewNote,
  ScenarioSnapshot,
  ScenarioTag,
  SimulationSettings,
  WithdrawalPlanSettings,
  ViewKey,
  WorkStyle
} from "./types";
import {
  buildPlanFromScenario,
  getAssetSummary,
  getAnnualProjectionRows,
  getBudgetHouseholdInputs,
  getBudgetMonthlyAverage,
  getBudgetSummary,
  getCashflowSummary,
  getEmergencyFundResult,
  getFixedCostImpact,
  getGoalAchievement,
  getGoalAchievements,
  getGoalPreparedPercent,
  getInputCompletion,
  getMonthlyProjectionRows,
  getNextEvent,
  getPrimaryGoal,
  getRecurrenceLabel,
  getContributionProjectionRows,
  manYen,
  percent,
  projectAssets,
  simulateContributionVariability,
  simulateRetirementPlan,
  simulateRetirementPlanVariability,
  simulateWithdrawalVariability,
  simulateWithdrawal,
  simulateContribution,
  type VariabilityResult
} from "./utils/calculations";
import { createRecoveryBackup, exportPlan, loadPlan, savePlan } from "./utils/storage";

const navItems: { key: ViewKey; label: string; tier?: "pro" }[] = [
  { key: "dashboard", label: "ダッシュボード" },
  { key: "profile", label: "ライフプラン" },
  { key: "assets", label: "資産入力" },
  { key: "household", label: "家計入力" },
  { key: "budget", label: "予算・実績" },
  { key: "goals", label: "目標管理" },
  { key: "simulation", label: "シミュレーション" },
  { key: "timeline", label: "年表" },
  { key: "notes", label: "メモ" },
  { key: "retirement", label: "老後プラン", tier: "pro" },
  { key: "scenarios", label: "シナリオ比較", tier: "pro" },
  { key: "diagnosis", label: "ライフプラン診断", tier: "pro" },
  { key: "reviews", label: "レビュー履歴", tier: "pro" },
  { key: "data", label: "データ管理" },
  { key: "pricing", label: "Pro・料金" },
  { key: "legal", label: "法務" }
];

const publicRoutes: Partial<Record<ViewKey, string>> = {
  dashboard: "/",
  pricing: "/pricing",
  pro: "/pro",
  legal: "/legal",
  terms: "/terms",
  privacy: "/privacy",
  commercial: "/commercial-disclosure",
  refund: "/refund",
  contact: "/contact",
  disclaimer: "/disclaimer"
};

const routeViews = Object.entries(publicRoutes).reduce<Record<string, ViewKey>>((routes, [view, path]) => {
  if (path) routes[path] = view as ViewKey;
  return routes;
}, {});

const publicViewTitles: Partial<Record<ViewKey, string>> = {
  terms: "利用規約",
  privacy: "プライバシーポリシー",
  commercial: "特定商取引法に基づく表記",
  refund: "解約・返金方針",
  contact: "お問い合わせ",
  disclaimer: "免責事項"
};

const legalDocumentViews: LegalDocumentKey[] = ["terms", "privacy", "commercial", "refund", "contact", "disclaimer"];

const getInitialView = (): ViewKey => routeViews[window.location.pathname.replace(/\/$/, "") || "/"] || "dashboard";

const getViewTitle = (view: ViewKey) =>
  publicViewTitles[view] ||
  (view === "settings" ? "設定" : view === "pro" ? "Pro・料金" : navItems.find((item) => item.key === view)?.label) ||
  "Life Compass";

type ThemePreference = "light" | "dark" | "system";
type ReviewReminderInterval = "monthly" | "quarterly";

type AppSettings = {
  theme: ThemePreference;
  remindersEnabled: boolean;
  actualReminderDay: number;
  reviewReminderInterval: ReviewReminderInterval;
  browserNotifications: boolean;
};

const SETTINGS_KEY = "life-compass-app-settings-v1";

const defaultSettings: AppSettings = {
  theme: "system",
  remindersEnabled: true,
  actualReminderDay: 25,
  reviewReminderInterval: "monthly",
  browserNotifications: false
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

type AppReminder = {
  id: string;
  title: string;
  detail: string;
  view: ViewKey;
};

const getAppReminders = (plan: LifePlan, settings: AppSettings): AppReminder[] => {
  if (!settings.remindersEnabled) return [];

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const monthKey = `${currentYear}-${String(currentMonth).padStart(2, "0")}`;
  const reminders: AppReminder[] = [];
  const budgetItems = plan.budgetItems || [];
  const missingActualCount = budgetItems.filter(
    (item) => !Object.prototype.hasOwnProperty.call(item.actuals || {}, monthKey)
  ).length;

  if (budgetItems.length > 0 && now.getDate() >= settings.actualReminderDay && missingActualCount > 0) {
    reminders.push({
      id: `actual-${monthKey}`,
      title: `${currentMonth}月の実績入力`,
      detail: `未入力の予算項目が${missingActualCount}件あります。月末の大まかな支出を記録します。`,
      view: "budget"
    });
  }

  const latestReview = [...(plan.reviews || [])].sort((a, b) => b.date.localeCompare(a.date))[0];
  const reviewIntervalDays = settings.reviewReminderInterval === "quarterly" ? 90 : 30;
  const latestReviewDate = latestReview ? new Date(`${latestReview.date}T00:00:00`) : null;
  const daysSinceReview = latestReviewDate
    ? Math.floor((now.getTime() - latestReviewDate.getTime()) / (24 * 60 * 60 * 1000))
    : reviewIntervalDays;
  if (daysSinceReview >= reviewIntervalDays) {
    reminders.push({
      id: `review-${settings.reviewReminderInterval}`,
      title: settings.reviewReminderInterval === "quarterly" ? "四半期レビューの確認" : "月次レビューの確認",
      detail: latestReview ? `前回の確認から約${daysSinceReview}日です。` : "最初の見直し内容を記録できます。",
      view: "reviews"
    });
  }

  const dueGoals = plan.goals.filter(
    (goal) => goal.dueYear <= currentYear && goal.goalType === "oneTime" && getGoalPreparedPercent(goal) < 100
  );
  if (dueGoals.length > 0) {
    reminders.push({
      id: `goals-${currentYear}`,
      title: "期限を迎える目標があります",
      detail: `${dueGoals.slice(0, 2).map((goal) => goal.title).join("、")}の準備状況を確認します。`,
      view: "goals"
    });
  }

  const upcomingEvents = plan.events.filter((event) => {
    const monthDifference = (event.year - currentYear) * 12 + event.month - currentMonth;
    return monthDifference >= 0 && monthDifference <= 2;
  });
  if (upcomingEvents.length > 0) {
    reminders.push({
      id: `events-${monthKey}`,
      title: "近いライフイベントを確認",
      detail: `${upcomingEvents.slice(0, 2).map((event) => event.title).join("、")}が3か月以内に予定されています。`,
      view: "timeline"
    });
  }

  return reminders;
};

const eventOwnerLabels: Record<EventOwner, string> = {
  self: "本人",
  spouse: "配偶者",
  child: "子ども",
  parent: "親",
  household: "世帯全体",
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

const fixedCostCategoryLabels: Record<FixedCostCategory, string> = {
  insurance: "保険",
  communication: "通信費",
  rent: "家賃",
  car: "車",
  subscription: "サブスク",
  utilities: "光熱費",
  loan: "ローン",
  other: "その他"
};

const budgetCategoryLabels: Record<BudgetCategory, string> = {
  food: "食費",
  daily: "日用品",
  housing: "住居",
  utilities: "水道光熱費",
  communication: "通信費",
  insurance: "保険",
  car: "車",
  education: "教育",
  medical: "医療",
  travel: "旅行・帰省",
  subscription: "サブスク",
  other: "その他"
};

const budgetFrequencyLabels: Record<BudgetFrequency, string> = {
  monthlyFixed: "毎月・固定",
  monthlyVariable: "毎月・変動",
  irregularFixed: "不定・固定",
  irregularVariable: "不定・変動",
  yearly: "年1回",
  oneTime: "1回だけ"
};

const scenarioTagLabels: Record<ScenarioTag, string> = {
  current: "現状維持",
  spending: "支出見直し",
  career: "転職",
  sideBusiness: "副業開始",
  home: "住宅購入",
  retirement: "早期退職",
  custom: "自由入力"
};

const monthLabels = Array.from({ length: 12 }, (_, index) => `${index + 1}月`);

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
  version: CURRENT_PLAN_VERSION,
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
  withdrawalPlan: {
    startAge: 0,
    startingAssets: 0,
    years: 101,
    withdrawalMode: "monthlyAmount",
    monthlyWithdrawalAmount: 0,
    annualWithdrawalRate: 4,
    annualReturnRate: 0,
    inflationRate: 0,
    periods: [
      {
        id: createId(),
        label: "基本期間",
        startAge: 0,
        endAge: 39,
        monthlyIncome: 0,
        monthlyLivingCost: 0,
        annualExtraExpense: 0
      }
    ]
  },
  retirementPlan: {
    ...defaultPlan.retirementPlan
  },
  notes: {
    general: "",
    spendingReview: ""
  },
  reviews: [],
  scenarios: [],
  fixedCostItems: [],
  budgetItems: [],
  updatedAt: new Date().toISOString()
});

type ScenarioTemplate = {
  tag: ScenarioTag;
  name: string;
  description: string;
  apply: (snapshot: ScenarioSnapshot, plan: LifePlan) => ScenarioSnapshot;
};

const cloneScenarioSnapshot = (plan: LifePlan): ScenarioSnapshot => ({
  household: { ...plan.household },
  assets: { ...plan.assets },
  goals: plan.goals.map((goal) => ({ ...goal })),
  events: plan.events.map((event) => ({ ...event })),
  simulation: { ...plan.simulation }
});

const createScenarioFromTemplate = (plan: LifePlan, template: ScenarioTemplate): PlanScenario => ({
  id: createId(),
  name: template.name,
  description: template.description,
  tag: template.tag,
  createdAt: new Date().toISOString(),
  snapshot: template.apply(cloneScenarioSnapshot(plan), plan)
});

const scenarioTemplates: ScenarioTemplate[] = [
  {
    tag: "current",
    name: "現状維持",
    description: "現在の入力条件をそのまま保存します。",
    apply: (snapshot) => snapshot
  },
  {
    tag: "spending",
    name: "支出見直し",
    description: "固定費を月3万円下げた場合の仮シナリオです。",
    apply: (snapshot) => ({
      ...snapshot,
      household: { ...snapshot.household, fixedCost: Math.max(0, snapshot.household.fixedCost - 30000) }
    })
  },
  {
    tag: "career",
    name: "転職",
    description: "月収が5万円変わる前提の仮シナリオです。",
    apply: (snapshot) => ({
      ...snapshot,
      household: { ...snapshot.household, monthlyIncome: snapshot.household.monthlyIncome + 50000 }
    })
  },
  {
    tag: "sideBusiness",
    name: "副業開始",
    description: "副業収入を月5万円として置いた仮シナリオです。",
    apply: (snapshot) => ({
      ...snapshot,
      household: { ...snapshot.household, sideIncome: snapshot.household.sideIncome + 50000 }
    })
  },
  {
    tag: "home",
    name: "住宅購入",
    description: "5年後に住宅購入関連費用を置いた仮シナリオです。",
    apply: (snapshot, plan) => {
      const year = new Date().getFullYear() + 5;
      return {
        ...snapshot,
        events: [
          ...snapshot.events,
          {
            id: createId(),
            title: "住宅購入関連費用",
            owner: "household",
            category: "home",
            year,
            month: 9,
            age: getTargetAgeForYear(plan.profile.age, year),
            amount: 3000000,
            cashflowType: "expense",
            memo: "Proシナリオ比較用の仮イベント"
          }
        ]
      };
    }
  },
  {
    tag: "retirement",
    name: "早期退職",
    description: "収入と生活費を退職前提で見直すための仮シナリオです。",
    apply: (snapshot) => ({
      ...snapshot,
      household: {
        ...snapshot.household,
        monthlyIncome: Math.max(0, snapshot.household.monthlyIncome - 100000),
        fixedCost: Math.max(0, snapshot.household.fixedCost - 20000)
      }
    })
  }
];

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
    owner: "self",
    category: "career",
    yearsFromNow: 2,
    month: 4,
    amount: 0,
    cashflowType: "neutral",
    memo: "年収や働き方の変化は家計入力も合わせて見直す"
  },
  {
    title: "引越し",
    owner: "household",
    category: "move",
    yearsFromNow: 1,
    month: 3,
    amount: 500000,
    cashflowType: "expense",
    memo: "初期費用、家具家電、移動費など"
  },
  {
    title: "住宅購入",
    owner: "household",
    category: "home",
    yearsFromNow: 5,
    month: 9,
    amount: 3000000,
    cashflowType: "expense",
    memo: "頭金や諸費用の概算。住宅ローンは資産入力の負債も確認する"
  },
  {
    title: "車購入",
    owner: "household",
    category: "car",
    yearsFromNow: 3,
    month: 6,
    amount: 2000000,
    cashflowType: "expense",
    memo: "購入費、維持費、保険料など"
  },
  {
    title: "教育費",
    owner: "child",
    category: "education",
    yearsFromNow: 10,
    month: 4,
    amount: 1000000,
    cashflowType: "expense",
    memo: "入学金、授業料、教材費など"
  },
  {
    title: "親の介護",
    owner: "parent",
    category: "care",
    yearsFromNow: 8,
    month: 1,
    amount: 600000,
    cashflowType: "expense",
    memo: "支援額や頻度は状況に合わせて見直す"
  }
];

function App() {
  const [plan, setPlan] = useState<LifePlan>(() => loadPlan());
  const [activeView, setActiveViewState] = useState<ViewKey>(() => getInitialView());
  const [importMessage, setImportMessage] = useState("");
  const [storageError, setStorageError] = useState("");
  const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings());
  const [notificationMessage, setNotificationMessage] = useState("");
  const reminders = useMemo(() => getAppReminders(plan, settings), [plan, settings]);

  const setActiveView = (view: ViewKey) => {
    setActiveViewState(view);
    const nextPath = publicRoutes[view] || "/";
    if (window.location.pathname !== nextPath) {
      window.history.pushState({ view }, "", nextPath);
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  useEffect(() => {
    const handlePopState = () => setActiveViewState(getInitialView());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    document.title = `${getViewTitle(activeView)} | Life Compass`;
  }, [activeView]);

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

  useEffect(() => {
    if (
      !settings.remindersEnabled ||
      !settings.browserNotifications ||
      reminders.length === 0 ||
      !("Notification" in window) ||
      Notification.permission !== "granted"
    ) {
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const notificationKey = "life-compass-last-reminder-notification";
    if (localStorage.getItem(notificationKey) === today) return;

    try {
      new Notification("Life Compassの確認", {
        body: reminders.length === 1 ? reminders[0].title : `${reminders[0].title} ほか${reminders.length - 1}件`
      });
      localStorage.setItem(notificationKey, today);
    } catch {
      // ブラウザ通知が使えない環境でも、アプリ内リマインダーは継続します。
    }
  }, [reminders, settings.browserNotifications, settings.remindersEnabled]);

  const commitPlan = (nextPlan: LifePlan) => {
    try {
      const saved = savePlan(nextPlan);
      setPlan(saved);
      setStorageError("");
      return true;
    } catch (error) {
      setPlan({ ...nextPlan, updatedAt: plan.updatedAt });
      setStorageError(error instanceof Error ? error.message : "ブラウザ内に保存できませんでした。");
      return false;
    }
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

  const requestBrowserNotifications = async () => {
    if (!("Notification" in window)) {
      setNotificationMessage("このブラウザは通知に対応していません。アプリ内リマインダーは利用できます。");
      return;
    }

    const permission = await Notification.requestPermission();
    const enabled = permission === "granted";
    updateSettings("browserNotifications", enabled);
    setNotificationMessage(
      enabled
        ? "ブラウザ通知を有効にしました。Life Compassを開いた日に、未確認項目があれば通知します。"
        : "通知は許可されませんでした。アプリ内リマインダーは引き続き利用できます。"
    );
  };

  const updateWithdrawalPlan = <K extends keyof WithdrawalPlanSettings>(key: K, value: WithdrawalPlanSettings[K]) => {
    commitPlan({ ...plan, withdrawalPlan: { ...(plan.withdrawalPlan || defaultPlan.withdrawalPlan), [key]: value } });
  };

  const updateWithdrawalPlanPatch = (patch: Partial<WithdrawalPlanSettings>) => {
    commitPlan({ ...plan, withdrawalPlan: { ...(plan.withdrawalPlan || defaultPlan.withdrawalPlan), ...patch } });
  };

  const updateRetirementPlan = <K extends keyof RetirementPlanSettings>(key: K, value: RetirementPlanSettings[K]) => {
    commitPlan({ ...plan, retirementPlan: { ...(plan.retirementPlan || defaultPlan.retirementPlan), [key]: value } });
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
      reviewType: "monthly",
      plannedNetAssets: assets.netAssets,
      plannedMonthlySavings: cashflow.monthlySavings,
      actualNetAssets: assets.netAssets,
      actualMonthlySavings: cashflow.monthlySavings,
      todo: "",
      todoDone: false,
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

  const addScenario = (template: ScenarioTemplate) => {
    const nextScenario = createScenarioFromTemplate(plan, template);
    commitPlan({ ...plan, scenarios: [...(plan.scenarios || []), nextScenario] });
  };

  const updateScenario = <K extends keyof PlanScenario>(id: string, key: K, value: PlanScenario[K]) => {
    commitPlan({
      ...plan,
      scenarios: (plan.scenarios || []).map((scenario) => (scenario.id === id ? { ...scenario, [key]: value } : scenario))
    });
  };

  const removeScenario = (id: string) => {
    commitPlan({ ...plan, scenarios: (plan.scenarios || []).filter((scenario) => scenario.id !== id) });
  };

  const addFixedCostItem = () => {
    const nextItem: FixedCostItem = {
      id: createId(),
      name: "見直し項目",
      category: "other",
      currentMonthlyCost: 0,
      revisedMonthlyCost: 0,
      memo: ""
    };
    commitPlan({ ...plan, fixedCostItems: [...(plan.fixedCostItems || []), nextItem] });
  };

  const updateFixedCostItem = <K extends keyof FixedCostItem>(id: string, key: K, value: FixedCostItem[K]) => {
    commitPlan({
      ...plan,
      fixedCostItems: (plan.fixedCostItems || []).map((item) => (item.id === id ? { ...item, [key]: value } : item))
    });
  };

  const removeFixedCostItem = (id: string) => {
    commitPlan({ ...plan, fixedCostItems: (plan.fixedCostItems || []).filter((item) => item.id !== id) });
  };

  const addBudgetItem = () => {
    const nextItem: BudgetItem = {
      id: createId(),
      name: "予算項目",
      category: "other",
      frequency: "monthlyVariable",
      budgetAmount: 0,
      actuals: {},
      memo: ""
    };
    commitPlan({ ...plan, budgetItems: [...(plan.budgetItems || []), nextItem] });
  };

  const updateBudgetItem = <K extends keyof BudgetItem>(id: string, key: K, value: BudgetItem[K]) => {
    commitPlan({
      ...plan,
      budgetItems: (plan.budgetItems || []).map((item) => (item.id === id ? { ...item, [key]: value } : item))
    });
  };

  const updateBudgetActual = (id: string, monthKey: string, value: number) => {
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return;

    commitPlan({
      ...plan,
      budgetItems: (plan.budgetItems || []).map((item) =>
        item.id === id ? { ...item, actuals: { ...(item.actuals || {}), [monthKey]: value } } : item
      )
    });
  };

  const removeBudgetItem = (id: string) => {
    commitPlan({ ...plan, budgetItems: (plan.budgetItems || []).filter((item) => item.id !== id) });
  };

  const applyBudgetToHousehold = () => {
    const inputs = getBudgetHouseholdInputs(plan.budgetItems || []);
    commitPlan({
      ...plan,
      household: {
        ...plan.household,
        fixedCost: inputs.fixedCost,
        variableCost: inputs.variableCost,
        annualSpecialCost: inputs.annualSpecialCost
      }
    });
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
      owner: "household",
      category: "other",
      year,
      month: new Date().getMonth() + 1,
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
      owner: template.owner,
      category: template.category,
      year,
      month: template.month,
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
    try {
      createRecoveryBackup(plan, "before-reset");
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "復旧用コピーを保存できませんでした。");
      return;
    }
    const next = cloneDefaultPlan();
    commitPlan(next);
    setImportMessage("サンプルプランに戻しました。");
  };

  const startEmptyPlan = () => {
    try {
      createRecoveryBackup(plan, "before-reset");
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "復旧用コピーを保存できませんでした。");
      return;
    }
    commitPlan(createEmptyPlan());
    setImportMessage("空のプランを作成しました。");
  };

  const renderView = () => {
    switch (activeView) {
      case "dashboard":
        return <Dashboard plan={plan} reminders={reminders} setActiveView={setActiveView} startEmptyPlan={startEmptyPlan} />;
      case "profile":
        return <ProfileView plan={plan} updateProfile={updateProfile} setActiveView={setActiveView} />;
      case "household":
        return (
          <HouseholdView
            plan={plan}
            updateHousehold={updateHousehold}
            addFixedCostItem={addFixedCostItem}
            updateFixedCostItem={updateFixedCostItem}
            removeFixedCostItem={removeFixedCostItem}
            setActiveView={setActiveView}
          />
        );
      case "budget":
        return (
          <BudgetView
            plan={plan}
            addBudgetItem={addBudgetItem}
            updateBudgetItem={updateBudgetItem}
            updateBudgetActual={updateBudgetActual}
            removeBudgetItem={removeBudgetItem}
            applyBudgetToHousehold={applyBudgetToHousehold}
            setActiveView={setActiveView}
          />
        );
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
        return (
          <SimulationView
            plan={plan}
            updateSimulation={updateSimulation}
            updateWithdrawalPlan={updateWithdrawalPlan}
            updateWithdrawalPlanPatch={updateWithdrawalPlanPatch}
            setActiveView={setActiveView}
          />
        );
      case "retirement":
        return (
          <RetirementPlanView
            plan={plan}
            updateRetirementPlan={updateRetirementPlan}
            setActiveView={setActiveView}
          />
        );
      case "scenarios":
        return (
          <ScenarioComparisonView
            plan={plan}
            addScenario={addScenario}
            updateScenario={updateScenario}
            removeScenario={removeScenario}
          />
        );
      case "diagnosis":
        return <LifePlanDiagnosisView plan={plan} setActiveView={setActiveView} />;
      case "notes":
        return (
          <NotesView
            mode="notes"
            plan={plan}
            setActiveView={setActiveView}
            updateNotes={updateNotes}
            addReview={addReview}
            updateReview={updateReview}
            removeReview={removeReview}
          />
        );
      case "reviews":
        return (
          <NotesView
            mode="reviews"
            plan={plan}
            setActiveView={setActiveView}
            updateNotes={updateNotes}
            addReview={addReview}
            updateReview={updateReview}
            removeReview={removeReview}
          />
        );
      case "data":
        return (
          <DataPage
            plan={plan}
            commitPlan={commitPlan}
            importMessage={importMessage}
            setImportMessage={setImportMessage}
            resetPlan={resetPlan}
            startEmptyPlan={startEmptyPlan}
          />
        );
      case "pricing":
        return <PricingPage setActiveView={setActiveView} />;
      case "pro":
        return <PricingPage setActiveView={setActiveView} />;
      case "settings":
        return (
          <SettingsView
            settings={settings}
            reminders={reminders}
            notificationMessage={notificationMessage}
            updateSettings={updateSettings}
            requestBrowserNotifications={requestBrowserNotifications}
            setActiveView={setActiveView}
          />
        );
      case "legal":
        return <LegalIndexView setActiveView={setActiveView} />;
      case "terms":
      case "privacy":
      case "commercial":
      case "refund":
      case "contact":
      case "disclaimer":
        return <LegalDocumentView document={activeView} />;
      default:
        return null;
    }
  };

  return (
    <div className="app-shell" data-testid="app-shell">
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
              className={activeView === item.key || (item.key === "legal" && legalDocumentViews.includes(activeView as LegalDocumentKey)) ? "active" : ""}
              onClick={() => setActiveView(item.key)}
              data-view={item.key}
            >
              <span>{item.label}</span>
              {item.tier === "pro" && <small className="nav-tier">Pro</small>}
            </button>
          ))}
        </nav>
        <p className="sidebar-note">保存先: このブラウザ内</p>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div>
            <p className="eyebrow">ライフプラン管理ツール</p>
            <h1>{getViewTitle(activeView)}</h1>
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
        {storageError && (
          <section className="storage-error-banner" role="alert">
            <div>
              <strong>ブラウザ内への保存を確認してください</strong>
              <p>{storageError}</p>
            </div>
            <button type="button" className="secondary" onClick={() => setActiveView("data")}>
              データ管理を開く
            </button>
          </section>
        )}
        {renderView()}
      </main>
    </div>
  );
}

type DashboardProps = {
  plan: LifePlan;
  reminders: AppReminder[];
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

function Dashboard({ plan, reminders, setActiveView, startEmptyPlan }: DashboardProps) {
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
                  : "すべてを一度に埋めなくても大丈夫です。基本情報、資産、家計、予算・実績、目標、シミュレーション、年表の順に進められます。"}
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
            <button type="button" onClick={() => setActiveView("timeline")}>
              <span>7</span>
              <strong>年表</strong>
              <small>将来イベントを時系列で確認</small>
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
        </div>

        <div className="quick-action-grid" aria-label="よく使う操作">
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
        </div>
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
      <StepFlowNav setActiveView={setActiveView} next={{ view: "assets", label: "資産入力" }} />
    </div>
  );
}

function HouseholdView({
  plan,
  updateHousehold,
  addFixedCostItem,
  updateFixedCostItem,
  removeFixedCostItem,
  setActiveView
}: {
  plan: LifePlan;
  updateHousehold: <K extends keyof Household>(key: K, value: Household[K]) => void;
  addFixedCostItem: () => void;
  updateFixedCostItem: <K extends keyof FixedCostItem>(id: string, key: K, value: FixedCostItem[K]) => void;
  removeFixedCostItem: (id: string) => void;
  setActiveView: (view: ViewKey) => void;
}) {
  const cashflow = getCashflowSummary(plan.household);
  const fixedCostItems = plan.fixedCostItems || [];
  const fixedCostImpact = getFixedCostImpact(fixedCostItems);
  const monthlySavingsTone =
    cashflow.monthlySavings < 0 ? "notice" : cashflow.savingsRate >= 20 ? "good" : cashflow.monthlySavings > 0 ? "check" : "neutral";
  return (
    <div className="view-stack">
      <section className="panel form-panel">
        <StepTitle step="3" title="基本収支" description="月単位の収支と年間特別支出を整理します。" />
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
      <section className="panel">
        <div className="section-heading">
          <div>
            <div className="title-with-badge">
              <h2>固定費見直しインパクト</h2>
              <span className="pro-inline-badge">Proプレビュー</span>
            </div>
            <p>保険、通信費、家賃、車、サブスクなどの月額差分を整理します。表示は単純差額で、契約や商品を推奨するものではありません。</p>
          </div>
          <button type="button" onClick={addFixedCostItem}>
            項目を追加
          </button>
        </div>
        <div className="summary-grid compact">
          <Metric label="月間改善額" value={manYen(fixedCostImpact.monthlyImprovement)} helper="現在額 - 見直し後" />
          <Metric label="年間改善額" value={manYen(fixedCostImpact.annualImprovement)} helper="月間改善額 × 12" />
          <Metric label="10年の単純差額" value={manYen(fixedCostImpact.tenYearSimpleImpact)} helper="利回り等は含めない" />
          <Metric label="30年の単純差額" value={manYen(fixedCostImpact.thirtyYearSimpleImpact)} helper="前提条件に基づく試算" />
        </div>
        <FixedCostItemList
          items={fixedCostItems}
          updateFixedCostItem={updateFixedCostItem}
          removeFixedCostItem={removeFixedCostItem}
        />
      </section>
      <StepFlowNav
        setActiveView={setActiveView}
        previous={{ view: "assets", label: "資産入力" }}
        next={{ view: "budget", label: "予算・実績" }}
      />
    </div>
  );
}

function FixedCostItemList({
  items,
  updateFixedCostItem,
  removeFixedCostItem
}: {
  items: FixedCostItem[];
  updateFixedCostItem: <K extends keyof FixedCostItem>(id: string, key: K, value: FixedCostItem[K]) => void;
  removeFixedCostItem: (id: string) => void;
}) {
  if (items.length === 0) {
    return <EmptyState title="固定費見直し項目はまだありません" detail="項目を追加すると、月額差分と長期の単純差額を確認できます。" />;
  }

  return (
    <div className="fixed-cost-list">
      {items.map((item) => (
        <div className="fixed-cost-row" key={item.id}>
          <label>
            項目名
            <input value={item.name} onChange={(event) => updateFixedCostItem(item.id, "name", event.target.value)} />
          </label>
          <label>
            種類
            <select value={item.category} onChange={(event) => updateFixedCostItem(item.id, "category", event.target.value as FixedCostCategory)}>
              {Object.entries(fixedCostCategoryLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <MoneyInput
            label="現在の月額"
            value={item.currentMonthlyCost}
            onChange={(value) => updateFixedCostItem(item.id, "currentMonthlyCost", value)}
          />
          <MoneyInput
            label="見直し後の月額"
            value={item.revisedMonthlyCost}
            onChange={(value) => updateFixedCostItem(item.id, "revisedMonthlyCost", value)}
          />
          <label>
            メモ
            <input value={item.memo} onChange={(event) => updateFixedCostItem(item.id, "memo", event.target.value)} />
          </label>
          <div className="fixed-cost-impact-cell">
            <span>月額差</span>
            <strong>{manYen(Math.max(0, item.currentMonthlyCost - item.revisedMonthlyCost))}</strong>
          </div>
          <button type="button" className="text-button" onClick={() => removeFixedCostItem(item.id)}>
            削除
          </button>
        </div>
      ))}
    </div>
  );
}

function BudgetView({
  plan,
  addBudgetItem,
  updateBudgetItem,
  updateBudgetActual,
  removeBudgetItem,
  applyBudgetToHousehold,
  setActiveView
}: {
  plan: LifePlan;
  addBudgetItem: () => void;
  updateBudgetItem: <K extends keyof BudgetItem>(id: string, key: K, value: BudgetItem[K]) => void;
  updateBudgetActual: (id: string, monthKey: string, value: number) => void;
  removeBudgetItem: (id: string) => void;
  applyBudgetToHousehold: () => void;
  setActiveView: (view: ViewKey) => void;
}) {
  const currentDate = new Date();
  const defaultMonthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}`;
  const [monthKey, setMonthKey] = useState(defaultMonthKey);
  const budgetItems = plan.budgetItems || [];
  const summary = getBudgetSummary(budgetItems, monthKey);
  const actualEntryCount = budgetItems.filter((item) => Object.prototype.hasOwnProperty.call(item.actuals || {}, monthKey)).length;
  const moveMonth = (offset: number) => {
    const [year, month] = monthKey.split("-").map(Number);
    const next = new Date(year, month - 1 + offset, 1);
    setMonthKey(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
  };

  const handleApplyBudget = () => {
    if (window.confirm("予算・実績の年間換算をもとに、家計入力の固定費・変動費・年間特別支出を更新します。")) {
      applyBudgetToHousehold();
    }
  };

  return (
    <div className="view-stack">
      <section className="panel">
        <div className="section-heading">
          <StepTitle
            step="4"
            title="予算・実績プラン"
            description="予算を決め、月末にカテゴリごとの大まかな実績を記録します。"
          />
          <div className="button-row">
            <button type="button" className="secondary" onClick={handleApplyBudget}>
              家計入力に反映
            </button>
            <button type="button" onClick={addBudgetItem}>
              項目を追加
            </button>
          </div>
        </div>
        <div className="notice-band check">
          <strong>家計簿ではなく、ライフプランの前提を整えるための月次管理です</strong>
          <span>細かい日別入力は扱わず、カテゴリごとの月額予算・実績・差額をレビューとシミュレーションに使います。</span>
        </div>
        <div className="budget-toolbar">
          <label>
            実績を入力する月
            <input type="month" value={monthKey} onChange={(event) => setMonthKey(event.target.value || defaultMonthKey)} />
          </label>
          <div className="button-row compact-actions">
            <button type="button" className="secondary" onClick={() => moveMonth(-1)}>前月</button>
            <button type="button" className="secondary" onClick={() => setMonthKey(defaultMonthKey)}>今月</button>
            <button type="button" className="secondary" onClick={() => moveMonth(1)}>翌月</button>
          </div>
          <span>{actualEntryCount}/{budgetItems.length}項目入力済み。実績は月ごとにブラウザ内へ保存されます。</span>
        </div>
        <div className="calculation-band compact">
          <Metric label="月平均予算" value={manYen(summary.plannedMonthlyAverage)} helper="頻度を月平均に換算" />
          <Metric label="選択月の実績" value={summary.actualEntryCount > 0 ? manYen(summary.actual) : "未入力"} helper={monthKey} />
          <Metric label="予算との差" value={summary.actualEntryCount > 0 ? manYen(summary.variance) : "-"} helper="実績 - 月平均予算" />
          <Metric label="年間予算" value={manYen(summary.annualPlan)} helper="月次/年次を合算" />
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>月末の実績入力</h2>
            <p>レシート単位ではなく、食費や住居費などの大まかな項目ごとに、その月に実際に使った合計額を入力します。</p>
          </div>
          <span className="status-pill recurring">{monthKey}</span>
        </div>
        {budgetItems.length === 0 ? (
          <EmptyState title="先に予算項目を追加してください" detail="食費、住居費、通信費など、毎月振り返りたい単位だけで構いません。" />
        ) : (
          <div className="monthly-actual-list">
            {budgetItems.map((item) => {
              const monthlyBudget = getBudgetMonthlyAverage(item);
              const hasActual = Object.prototype.hasOwnProperty.call(item.actuals || {}, monthKey);
              const actual = item.actuals?.[monthKey] ?? 0;
              return (
                <div className="monthly-actual-row" key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    <small>{budgetCategoryLabels[item.category]} / 月平均予算 {manYen(monthlyBudget)}</small>
                  </div>
                  <MoneyInput
                    label="実際に使った額"
                    value={actual}
                    onChange={(value) => updateBudgetActual(item.id, monthKey, value)}
                  />
                  <div className={`actual-variance ${hasActual && actual > monthlyBudget ? "over" : "within"}`}>
                    <span>予算との差</span>
                    <strong>{hasActual ? manYen(actual - monthlyBudget) : "未入力"}</strong>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>カテゴリ別の差額</h2>
        {summary.categoryRows.length === 0 ? (
          <EmptyState title="まだ予算項目がありません" detail="項目を追加すると、カテゴリ別の月平均予算と実績差額を確認できます。" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>カテゴリ</th>
                  <th>月平均予算</th>
                  <th>選択月実績</th>
                  <th>差額</th>
                </tr>
              </thead>
              <tbody>
                {summary.categoryRows.map((row) => (
                  <tr key={row.category}>
                    <td>{budgetCategoryLabels[row.category]}</td>
                    <td>{manYen(row.plannedMonthlyAverage)}</td>
                    <td>{row.actualEntryCount > 0 ? manYen(row.actual) : "未入力"}</td>
                    <td>{row.actualEntryCount > 0 ? manYen(row.variance) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>予算項目</h2>
        {budgetItems.length === 0 ? (
          <EmptyState title="予算項目はまだありません" detail="食費、住居費、通信費、旅行など、月次レビューで見たい単位で追加します。" />
        ) : (
          <div className="budget-list">
            {budgetItems.map((item) => (
              <div className="budget-row" key={item.id}>
                <label>
                  項目名
                  <input value={item.name} onChange={(event) => updateBudgetItem(item.id, "name", event.target.value)} />
                </label>
                <label>
                  カテゴリ
                  <select value={item.category} onChange={(event) => updateBudgetItem(item.id, "category", event.target.value as BudgetCategory)}>
                    {Object.entries(budgetCategoryLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  頻度
                  <select value={item.frequency} onChange={(event) => updateBudgetItem(item.id, "frequency", event.target.value as BudgetFrequency)}>
                    {Object.entries(budgetFrequencyLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <MoneyInput label="予算額" value={item.budgetAmount} onChange={(value) => updateBudgetItem(item.id, "budgetAmount", value)} />
                <div className="fixed-cost-impact-cell">
                  <span>月平均</span>
                  <strong>{manYen(getBudgetMonthlyAverage(item))}</strong>
                </div>
                <label>
                  メモ
                  <input value={item.memo} onChange={(event) => updateBudgetItem(item.id, "memo", event.target.value)} />
                </label>
                <button type="button" className="text-button" onClick={() => removeBudgetItem(item.id)}>
                  削除
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="helper-grid">
        <div>
          <strong>家計入力への反映</strong>
          <span>毎月・固定は固定費、毎月・変動は変動費、不定期・年1回は年間特別支出として反映します。1回だけの支出は年表イベントで管理するのが基本です。</span>
        </div>
        <div>
          <strong>レビュー履歴との関係</strong>
          <span>選択月の予算差額は、月次レビュー時に見直しポイントとして使えます。</span>
        </div>
        <div>
          <strong>使いすぎない設計</strong>
          <span>日別明細や店舗別分析は扱わず、ライフプランの前提を整える粒度に絞ります。</span>
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
        <StepTitle step="2" title="資産入力" description="現金、投資資産、その他資産、負債を分けて整理します。" />
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
        previous={{ view: "profile", label: "基本情報" }}
        next={{ view: "household", label: "家計入力" }}
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
  const [goalViewMode, setGoalViewMode] = useState<"detail" | "compact">("detail");
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
          <StepTitle step="5" title="目標管理" description="期限、目標額、優先度、準備状況を整理します。" />
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
              <EmptyState title="まだ目標がありません" detail="テンプレートから1つ追加するか、目標を追加ボタンで自由に作れます。" />
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
                      <strong>{goal.dueYear}年 / {getTargetAgeForYear(plan.profile.age, goal.dueYear)}歳頃</strong>
                      <small>{achievement.status === "recurring" ? `年間必要額 ${manYen(achievement.annualRequiredAmount)}` : `残り ${manYen(achievement.shortfall)}`}</small>
                    </div>
                    <label>
                      目標額
                      <NumericInput value={goal.requiredAmount} min={0} onChange={(value) => updateGoal(goal.id, "requiredAmount", value)} />
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
  month: number;
  title: string;
  owner: EventOwner | "goal";
  kind: "goal" | "event";
  detail: string;
  amount?: number;
  tone: "goal" | "expense" | "income" | "neutral";
  progress?: number;
};

function LifeCalendar({ plan }: { plan: LifePlan }) {
  const [rangeYears, setRangeYears] = useState<5 | 10 | 30>(10);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [entrySearch, setEntrySearch] = useState("");
  const [entryKind, setEntryKind] = useState<"all" | "goal" | "event">("all");
  const [entryOwner, setEntryOwner] = useState<EventOwner | "all">("all");
  const [entrySort, setEntrySort] = useState<"yearAsc" | "yearDesc" | "title">("yearAsc");
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: rangeYears + 1 }, (_, index) => currentYear + index);
  const entries = useMemo<CalendarEntry[]>(() => {
    const goalEntries = plan.goals.map((goal) => {
      const preparedPercent = getGoalPreparedPercent(goal);
      return {
        id: `goal-${goal.id}`,
        year: goal.dueYear,
        month: 12,
        title: goal.title,
        owner: "goal" as const,
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
      month: event.month,
      title: event.title,
      owner: event.owner || "household",
      kind: "event" as const,
      detail: `${eventOwnerLabels[event.owner || "household"]} / ${cashflowLabels[event.cashflowType]}`,
      amount: event.amount,
      tone: event.cashflowType
    }));

    return [...goalEntries, ...eventEntries].sort((a, b) => a.year - b.year || a.month - b.month || a.title.localeCompare(b.title, "ja"));
  }, [plan.events, plan.goals]);
  const visibleEntries = useMemo(() => {
    const normalizedSearch = entrySearch.trim().toLowerCase();
    return entries
      .filter((entry) => entry.year >= currentYear && entry.year <= currentYear + rangeYears)
      .filter((entry) => (entryKind === "all" ? true : entry.kind === entryKind))
      .filter((entry) => (entryOwner === "all" || entry.kind === "goal" ? true : entry.owner === entryOwner))
      .filter((entry) => (normalizedSearch ? `${entry.title} ${entry.detail}`.toLowerCase().includes(normalizedSearch) : true))
      .sort((a, b) => {
        if (entrySort === "yearDesc") return b.year - a.year || b.month - a.month || a.title.localeCompare(b.title, "ja");
        if (entrySort === "title") return a.title.localeCompare(b.title, "ja") || a.year - b.year || a.month - b.month;
        return a.year - b.year || a.month - b.month || a.title.localeCompare(b.title, "ja");
      });
  }, [currentYear, entries, entryKind, entryOwner, entrySearch, entrySort, rangeYears]);
  const upcomingEntries = [...visibleEntries].sort((a, b) => a.year - b.year || a.month - b.month || a.title.localeCompare(b.title, "ja")).slice(0, 4);
  const selectedYearEntries = visibleEntries.filter((entry) => entry.year === selectedYear);

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
              <small>{entry.year}年{entry.month}月 / {getTargetAgeForYear(plan.profile.age, entry.year)}歳頃</small>
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
        <label>
          対象者
          <select value={entryOwner} onChange={(event) => setEntryOwner(event.target.value as EventOwner | "all")}>
            <option value="all">すべて</option>
            {Object.entries(eventOwnerLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
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
            <div
              className={[
                "calendar-year-card",
                year === currentYear ? "current" : "",
                year === selectedYear ? "selected" : ""
              ].filter(Boolean).join(" ")}
              key={year}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedYear(year)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedYear(year);
                }
              }}
            >
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
                        <span>{entry.kind === "goal" ? "目標" : `${entry.month}月のイベント`}</span>
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

      <div className="calendar-year-detail" aria-label={`${selectedYear}年の月別予定`}>
        <div className="calendar-detail-head">
          <div>
            <strong>{selectedYear}年の予定</strong>
            <span>{getTargetAgeForYear(plan.profile.age, selectedYear)}歳頃 / {selectedYearEntries.length}件</span>
          </div>
          <small>年カードをタップすると、その年の月別予定を確認できます。</small>
        </div>
        <div className="calendar-month-grid">
          {monthLabels.map((label, index) => {
            const month = index + 1;
            const monthEntries = selectedYearEntries.filter((entry) => entry.month === month);
            return (
              <div className="calendar-month-card" key={label}>
                <strong>{label}</strong>
                {monthEntries.length === 0 ? (
                  <span>予定なし</span>
                ) : (
                  monthEntries.map((entry) => (
                    <div className={`calendar-month-entry ${entry.tone}`} key={entry.id}>
                      <span>{entry.kind === "goal" ? "目標" : "イベント"}</span>
                      <strong>{entry.title}</strong>
                      <small>{entry.detail}</small>
                    </div>
                  ))
                )}
              </div>
            );
          })}
        </div>
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
                <span>{entry.year}年{entry.month}月 / {getTargetAgeForYear(plan.profile.age, entry.year)}歳頃</span>
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
  const [eventViewMode, setEventViewMode] = useState<"detail" | "compact">("detail");
  const [eventOwner, setEventOwner] = useState<EventOwner | "all">("all");
  const sortedEvents = useMemo(() => {
    const normalizedSearch = eventSearch.trim().toLowerCase();
    return [...plan.events]
      .filter((event) => (eventOwner === "all" ? true : (event.owner || "household") === eventOwner))
      .filter((event) =>
        normalizedSearch
          ? `${event.title} ${event.memo} ${event.month}月 ${eventCategoryLabels[event.category]} ${eventOwnerLabels[event.owner || "household"]}`.toLowerCase().includes(normalizedSearch)
          : true
      )
      .sort((a, b) => {
        if (eventSort === "yearDesc") return b.year - a.year || b.month - a.month || a.title.localeCompare(b.title, "ja");
        if (eventSort === "title") return a.title.localeCompare(b.title, "ja") || a.year - b.year || a.month - b.month;
        if (eventSort === "type") return eventCategoryLabels[a.category].localeCompare(eventCategoryLabels[b.category], "ja") || a.year - b.year || a.month - b.month;
        return a.year - b.year || a.month - b.month || a.title.localeCompare(b.title, "ja");
      });
  }, [eventOwner, eventSearch, eventSort, plan.events]);
  return (
    <div className="view-stack">
      <section className="panel">
        <div className="section-heading">
          <StepTitle step="7" title="ライフイベント年表" description="予定年、金額、家計への影響を整理し、資産見通しに反映できます。" />
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
          <label>
            表示
            <select value={eventViewMode} onChange={(event) => setEventViewMode(event.target.value as "detail" | "compact")}>
              <option value="detail">詳細編集</option>
              <option value="compact">短いリスト</option>
            </select>
          </label>
          <label>
            対象者
            <select value={eventOwner} onChange={(event) => setEventOwner(event.target.value as EventOwner | "all")}>
              <option value="all">すべて</option>
              {Object.entries(eventOwnerLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <span>{sortedEvents.length}件表示 / 全{plan.events.length}件</span>
        </div>
        {eventViewMode === "compact" ? (
          <div className="compact-list" aria-label="イベントの短いリスト">
            {plan.events.length === 0 ? (
              <EmptyState title="まだ年表イベントがありません" detail="転職、引越し、住宅購入などをテンプレートから追加すると、将来見通しに反映できます。" />
            ) : sortedEvents.length === 0 ? (
              <EmptyState title="条件に合うイベントがありません" detail="検索文字を変えるか、並び替えを戻して確認してください。" />
            ) : (
              sortedEvents.map((event) => (
                <div className="compact-list-row" key={event.id}>
                  <label className="compact-title-field">
                    イベント名
                    <input value={event.title} onChange={(input) => updateEvent(event.id, "title", input.target.value)} />
                  </label>
                  <div className="compact-date-fields">
                    <label>
                      年
                      <NumericInput value={event.year} min={new Date().getFullYear()} onChange={(value) => updateEventSchedule(event.id, value)} />
                    </label>
                    <label>
                      月
                      <select value={event.month} onChange={(input) => updateEvent(event.id, "month", Number(input.target.value))}>
                        {monthLabels.map((label, index) => (
                          <option value={index + 1} key={label}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label>
                    対象者
                    <select value={event.owner || "household"} onChange={(input) => updateEvent(event.id, "owner", input.target.value as EventOwner)}>
                      {Object.entries(eventOwnerLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    種類
                    <select value={event.category} onChange={(input) => updateEvent(event.id, "category", input.target.value as LifeEventCategory)}>
                      {Object.entries(eventCategoryLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    金額
                    <NumericInput value={event.amount} min={0} onChange={(value) => updateEvent(event.id, "amount", value)} />
                  </label>
                  <label>
                    影響
                    <select value={event.cashflowType} onChange={(input) => updateEvent(event.id, "cashflowType", input.target.value as CashflowType)}>
                      {Object.entries(cashflowLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="text-button" onClick={() => removeEvent(event.id)}>
                    削除
                  </button>
                </div>
              ))
            )}
          </div>
        ) : (
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
                <span>{event.month}月 / {getTargetAgeForYear(plan.profile.age, event.year)}歳</span>
              </div>
              <div className="timeline-fields">
                <label className="timeline-field title-field">
                  イベント名
                  <input value={event.title} onChange={(input) => updateEvent(event.id, "title", input.target.value)} />
                  <small>例: 住宅購入、車購入、転職、旅行など</small>
                </label>
                <label className="timeline-field">
                  対象者
                  <select
                    value={event.owner || "household"}
                    onChange={(input) => updateEvent(event.id, "owner", input.target.value as EventOwner)}
                  >
                    {Object.entries(eventOwnerLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <small>本人、配偶者、子ども、親など、誰に関する予定かを分けます。</small>
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
                  予定月
                  <select value={event.month} onChange={(input) => updateEvent(event.id, "month", Number(input.target.value))}>
                    {monthLabels.map((label, index) => (
                      <option value={index + 1} key={label}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <small>スケジュール帳のように月単位で整理します。</small>
                </label>
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
        )}
      </section>
      <StepFlowNav
        setActiveView={setActiveView}
        previous={{ view: "simulation", label: "シミュレーション" }}
        next={{ view: "notes", label: "メモ" }}
      />
    </div>
  );
}

function SimulationView({
  plan,
  updateSimulation,
  updateWithdrawalPlan,
  updateWithdrawalPlanPatch,
  setActiveView
}: {
  plan: LifePlan;
  updateSimulation: <K extends keyof SimulationSettings>(key: K, value: SimulationSettings[K]) => void;
  updateWithdrawalPlan: <K extends keyof WithdrawalPlanSettings>(key: K, value: WithdrawalPlanSettings[K]) => void;
  updateWithdrawalPlanPatch: (patch: Partial<WithdrawalPlanSettings>) => void;
  setActiveView: (view: ViewKey) => void;
}) {
  const [simulationTab, setSimulationTab] = useState<"basic" | "contribution" | "withdrawal">("basic");
  const [projectionMode, setProjectionMode] = useState<"annual" | "monthly">("annual");
  const [projectionYears, setProjectionYears] = useState<10 | 30>(30);
  const [projectionMonths, setProjectionMonths] = useState<12 | 24>(24);
  const currentNetAssets = getAssetSummary(plan.assets).netAssets;
  const withdrawalPlan = plan.withdrawalPlan || defaultPlan.withdrawalPlan;
  const withdrawalStartAge = withdrawalPlan.startAge;
  const withdrawalStartingAssets = withdrawalPlan.startingAssets;
  const withdrawalEndAge = Math.max(100, withdrawalStartAge);
  const withdrawalYears = Math.max(1, withdrawalEndAge - withdrawalStartAge + 1);
  const withdrawalMode = withdrawalPlan.withdrawalMode;
  const monthlyWithdrawalAmount = withdrawalPlan.monthlyWithdrawalAmount;
  const annualWithdrawalRate = withdrawalPlan.annualWithdrawalRate;
  const withdrawalReturnRate = withdrawalPlan.annualReturnRate;
  const withdrawalInflationRate = withdrawalPlan.inflationRate;
  const [returnVariabilityRate, setReturnVariabilityRate] = useState(12);
  const updateWithdrawalStartAge = (value: number) => {
    updateWithdrawalPlanPatch({
      startAge: value,
      years: Math.max(1, Math.max(100, value) - value + 1)
    });
  };
  const withdrawalSettings = useMemo(
    () => ({
      startAge: withdrawalStartAge,
      currentAssets: withdrawalStartingAssets,
      monthlyLivingCost: 0,
      monthlyPension: 0,
      withdrawalMode,
      monthlyWithdrawalAmount,
      annualWithdrawalRate,
      annualReturnRate: withdrawalReturnRate,
      inflationRate: withdrawalInflationRate,
      years: withdrawalYears
    }),
    [
      annualWithdrawalRate,
      monthlyWithdrawalAmount,
      withdrawalInflationRate,
      withdrawalMode,
      withdrawalReturnRate,
      withdrawalStartAge,
      withdrawalStartingAssets,
      withdrawalYears
    ]
  );
  const projection10 = useMemo(() => projectAssets(plan, 10), [plan]);
  const projection30 = useMemo(() => projectAssets(plan, 30), [plan]);
  const annualRows = useMemo(() => getAnnualProjectionRows(plan, projectionYears), [plan, projectionYears]);
  const monthlyRows = useMemo(() => getMonthlyProjectionRows(plan, projectionMonths), [plan, projectionMonths]);
  const emergency = getEmergencyFundResult(plan);
  const contribution = simulateContribution(plan.simulation);
  const contributionRows = useMemo(() => getContributionProjectionRows(plan.simulation), [plan.simulation]);
  const contributionChartPoints = contributionRows.map((row) => ({
    year: row.year,
    label: `${row.year}年目`,
    value: row.value,
    annualSavings: row.contribution,
    returnImpact: row.returnImpact
  }));
  const contributionVariability = useMemo(
    () => simulateContributionVariability(plan.simulation, returnVariabilityRate),
    [plan.simulation, returnVariabilityRate]
  );
  const withdrawalResult = useMemo(
    () => simulateWithdrawal(withdrawalSettings),
    [withdrawalSettings]
  );
  const withdrawalVariability = useMemo(
    () => simulateWithdrawalVariability(withdrawalSettings, returnVariabilityRate),
    [returnVariabilityRate, withdrawalSettings]
  );
  const withdrawalChartPoints = withdrawalResult.rows.map((row) => ({
    year: row.yearIndex,
    label: `${row.age}歳`,
    age: row.age,
    value: row.assets,
    eventImpact: row.withdrawalAmount,
    returnImpact: row.returnImpact,
    impactLabel: "取り崩し額",
    returnLabel: "運用の影響"
  }));
  const chartRows = projectionMode === "annual" ? annualRows : monthlyRows;

  return (
    <div className="view-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>シミュレーション種別</h2>
            <p>基本見通し、詳細積立、退職後の取り崩しを切り替えて確認します。</p>
          </div>
          <div className="segmented-control" aria-label="シミュレーション種別">
            <button type="button" className={simulationTab === "basic" ? "active" : ""} onClick={() => setSimulationTab("basic")}>
              基本
            </button>
            <button type="button" className={simulationTab === "contribution" ? "active" : ""} onClick={() => setSimulationTab("contribution")}>
              詳細積立 Pro
            </button>
            <button type="button" className={simulationTab === "withdrawal" ? "active" : ""} onClick={() => setSimulationTab("withdrawal")}>
              取り崩し Pro
            </button>
          </div>
        </div>
      </section>

      {simulationTab === "basic" && (
      <>
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
        <StepTitle step="確認" title="生活防衛資金チェック" description={emergency.note} />
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
      </>
      )}

      {simulationTab === "contribution" && (
      <section className="panel form-panel">
        <StepTitle step="6" title="詳細積立シミュレーション" description="積立額、ボーナス積立、利回り、期間をもとに年ごとの見通しを確認します。" />
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
        <div className="section-heading chart-section-heading">
          <div>
            <h2>積み立て資産の推移</h2>
            <p>{contributionVariability.trialCount.toLocaleString("ja-JP")}回の試行結果を、上位10%・下位10%・中央値・最頻帯で表示します。</p>
          </div>
          <label className="compact-number-field">
            年ごとのばらつき幅 %
            <NumericInput value={returnVariabilityRate} min={0} allowDecimal onChange={setReturnVariabilityRate} />
          </label>
        </div>
        <LineChart points={contributionChartPoints} variabilityRows={contributionVariability.rows} />
        <div className="calculation-band compact">
          <Metric label={`${plan.simulation.years}年後 下位10%`} value={manYen(contributionVariability.lowerFinal)} helper="前提条件に基づく下振れ側の試算" />
          <Metric label={`${plan.simulation.years}年後 最頻帯`} value={manYen(contributionVariability.modeFinal)} helper="最も多かった金額帯の代表額" />
          <Metric label={`${plan.simulation.years}年後 中央値`} value={manYen(contributionVariability.medianFinal)} helper="ばらつき試算の中央値" />
          <Metric label={`${plan.simulation.years}年後 上位10%`} value={manYen(contributionVariability.upperFinal)} helper="上振れ側の試算" />
        </div>
        <div className="table-wrap projection-detail-table">
          <table>
            <thead>
              <tr>
                <th>年数</th>
                <th>累計積立額</th>
                <th>試算額</th>
                <th>利回り等の影響</th>
              </tr>
            </thead>
            <tbody>
              {contributionRows.map((row) => (
                <tr key={row.year}>
                  <td>{row.year}年目</td>
                  <td>{manYen(row.contribution)}</td>
                  <td>{manYen(row.value)}</td>
                  <td>{row.returnImpact ? manYen(row.returnImpact) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <VariabilityPanel
          title="利回りのばらつき試算"
          description="年ごとの利回りが一定ではない前提を置き、下位・中央値・上位の幅を確認します。"
          result={contributionVariability}
          suppressPanel
          volatilityRate={returnVariabilityRate}
          onVolatilityRateChange={setReturnVariabilityRate}
          finalLabel={`${plan.simulation.years}年後`}
        />
      </section>
      )}

      {simulationTab === "withdrawal" && (
      <section className="panel form-panel">
        <StepTitle step="6" title="取り崩しシミュレーション" description="期間入力は使わず、開始年齢・開始資金・月額または年率から資産推移を確認します。" />
        <div className="form-grid">
          <label>
            取り崩し開始年齢
            <NumericInput value={withdrawalStartAge} min={plan.profile.age} onChange={updateWithdrawalStartAge} />
          </label>
          <MoneyInput label="試算開始時資金" value={withdrawalStartingAssets} onChange={(value) => updateWithdrawalPlan("startingAssets", value)} />
          <label>
            取り崩し方法
            <select
              value={withdrawalMode}
              onChange={(event) => updateWithdrawalPlan("withdrawalMode", event.target.value as WithdrawalPlanSettings["withdrawalMode"])}
            >
              <option value="monthlyAmount">毎月の金額で指定</option>
              <option value="annualRate">開始時資金に対する年率で指定</option>
            </select>
          </label>
          {withdrawalMode === "monthlyAmount" ? (
            <MoneyInput
              label="毎月の取り崩し額"
              value={monthlyWithdrawalAmount}
              onChange={(value) => updateWithdrawalPlan("monthlyWithdrawalAmount", value)}
            />
          ) : (
            <label>
              取り崩し率 年率 %
              <NumericInput
                value={annualWithdrawalRate}
                min={0}
                max={100}
                allowDecimal
                onChange={(value) => updateWithdrawalPlan("annualWithdrawalRate", value)}
              />
              <small>開始時資金に対する年額を固定し、物価上昇率を反映します。</small>
            </label>
          )}
          <label>
            想定利回り %
            <NumericInput value={withdrawalReturnRate} min={0} allowDecimal onChange={(value) => updateWithdrawalPlan("annualReturnRate", value)} />
          </label>
          <label>
            インフレ率 %
            <NumericInput value={withdrawalInflationRate} min={0} allowDecimal onChange={(value) => updateWithdrawalPlan("inflationRate", value)} />
          </label>
          <label>
            年ごとのばらつき幅 %
            <NumericInput value={returnVariabilityRate} min={0} allowDecimal onChange={setReturnVariabilityRate} />
          </label>
        </div>
        <div className="button-row">
          <button type="button" className="secondary" onClick={() => updateWithdrawalPlan("startingAssets", currentNetAssets)}>
            資産入力の純資産を試算開始時資金へ反映
          </button>
        </div>
        <div className="notice-band check">
          <strong>通常の取り崩しを単純に確認する画面です</strong>
          <span>結果確認のため100歳まで描画しますが、試算期間の入力はありません。年金、社会保険、税金、老後生活費を含める場合は、別枠の老後プランを使います。</span>
        </div>
        <div className="section-heading chart-section-heading">
          <div>
            <h2>取り崩し後の資産推移</h2>
            <p>{withdrawalVariability.trialCount.toLocaleString("ja-JP")}回の試行結果を、上位10%・下位10%・中央値・最頻帯で表示します。</p>
          </div>
        </div>
        <LineChart points={withdrawalChartPoints} variabilityRows={withdrawalVariability.rows} />
        <div className="calculation-band compact">
          <Metric label="試算開始時資金" value={manYen(withdrawalStartingAssets)} helper={`${withdrawalStartAge}歳から試算`} />
          <Metric label="初年度取り崩し" value={manYen(withdrawalResult.rows[0]?.withdrawalAmount ?? 0)} helper={withdrawalMode === "monthlyAmount" ? "毎月の指定額 × 12" : "開始時資金 × 取り崩し率"} />
          <Metric
            label="資産が尽きる目安"
            value={withdrawalResult.depletedAge ? `${withdrawalResult.depletedAge}歳` : "100歳まで残る"}
            helper="前提条件に基づく試算"
          />
          <Metric label="100歳時点の試算額" value={manYen(withdrawalResult.finalAssets)} helper="運用しながら取り崩す前提" />
        </div>
        <div className={`notice-band ${withdrawalVariability.depletionRate > 0 ? "notice" : "check"}`}>
          <strong>{withdrawalVariability.depletionRate > 0 ? "資金が不足するケースがあります" : "現在の前提では期間内に資金が残る見通しです"}</strong>
          <span>
            ばらつき試算では、資産が尽きるケースは {percent(withdrawalVariability.depletionRate)}
            {withdrawalVariability.medianDepletedAge ? `、中央値では ${withdrawalVariability.medianDepletedAge}歳ごろです。` : " です。"}
            取り崩し額、試算開始時資金、利回りの前提を変えて見直せます。
          </span>
        </div>
        <div className="calculation-band compact">
          <Metric label="100歳時点 下位10%" value={manYen(withdrawalVariability.lowerFinal)} helper="前提条件に基づく下振れ側の試算" />
          <Metric label="100歳時点 最頻帯" value={manYen(withdrawalVariability.modeFinal)} helper="最も多かった金額帯の代表額" />
          <Metric label="100歳時点 中央値" value={manYen(withdrawalVariability.medianFinal)} helper="ばらつき試算の中央値" />
          <Metric label="100歳時点 上位10%" value={manYen(withdrawalVariability.upperFinal)} helper="上振れ側の試算" />
        </div>
        <details className="projection-details">
          <summary>年次の試算表を確認</summary>
          <div className="table-wrap projection-detail-table">
            <table>
              <thead>
                <tr>
                  <th>年齢</th>
                  <th>年末資産</th>
                  <th>年間取り崩し額</th>
                  <th>運用の影響</th>
                </tr>
              </thead>
              <tbody>
                {withdrawalResult.rows.map((row) => (
                  <tr key={row.yearIndex}>
                    <td>{row.age}歳</td>
                    <td>{manYen(row.assets)}</td>
                    <td>{manYen(row.withdrawalAmount)}</td>
                    <td>{manYen(row.returnImpact)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
      )}

      <StepFlowNav
        setActiveView={setActiveView}
        previous={{ view: "goals", label: "目標管理" }}
        next={{ view: "timeline", label: "年表" }}
      />
    </div>
  );
}

function RetirementPlanView({
  plan,
  updateRetirementPlan,
  setActiveView
}: {
  plan: LifePlan;
  updateRetirementPlan: <K extends keyof RetirementPlanSettings>(key: K, value: RetirementPlanSettings[K]) => void;
  setActiveView: (view: ViewKey) => void;
}) {
  const settings = plan.retirementPlan || defaultPlan.retirementPlan;
  const [retirementVariabilityRate, setRetirementVariabilityRate] = useState(10);
  const result = useMemo(() => simulateRetirementPlan({ ...plan, retirementPlan: settings }), [plan, settings]);
  const retirementVariability = useMemo(
    () => simulateRetirementPlanVariability({ ...plan, retirementPlan: settings }, retirementVariabilityRate),
    [plan, retirementVariabilityRate, settings]
  );
  const firstRow = result.rows[0];
  const retirementChartPoints = result.rows.map((row) => ({
    year: row.year,
    label: `${row.age}歳`,
    age: row.age,
    value: row.assets,
    eventImpact: row.withdrawalAmount,
    returnImpact: row.returnImpact,
    impactLabel: "取り崩し額",
    returnLabel: "運用の影響"
  }));
  const socialMonthlyTotal =
    settings.monthlyHealthInsurance + settings.monthlyLongTermCareInsurance + settings.monthlyTaxes;
  const pensionMonthlyTotal =
    settings.monthlyPublicPension + settings.monthlyPrivatePension + settings.monthlyOtherIncome;

  return (
    <div className="view-stack">
      <section className="pro-hero">
        <div>
          <p className="eyebrow">Pro予定 / 老後生活プラン</p>
          <h2>年金・社会保険・税金を含めた取り崩し見通し</h2>
          <p>
            退職後の生活費、国民健康保険、介護保険、税金、年金見込みを前提入力し、資産が何歳ごろまで持つかを参考情報として確認します。
          </p>
          <div className="button-row">
            <button type="button" className="secondary hero-action" onClick={() => setActiveView("simulation")}>
              基本シミュレーションを見る
            </button>
            <button type="button" className="secondary hero-action" onClick={() => setActiveView("reviews")}>
              レビュー履歴を見る
            </button>
          </div>
        </div>
        <span className="lock-badge">Coming soon</span>
      </section>

      <section className="panel">
        <div className="notice-band check">
          <strong>制度上の正確な保険料・税額計算ではありません</strong>
          <span>
            国民健康保険、介護保険、税金、年金額は自治体、年齢、所得、世帯状況などで変わります。この画面ではユーザーが置いた前提条件に基づく概算として扱います。
          </span>
        </div>
        <div className="calculation-band compact">
          <Metric label="退職時点の試算資産" value={manYen(result.retirementStartAssets)} helper={`${result.startAge}歳時点の見通し`} />
          <Metric label="初年度支出" value={manYen(result.firstYearTotalCost)} helper="生活費 + 社会保険・税金" />
          <Metric label="初年度年金等" value={manYen(result.firstYearIncome)} helper="公的年金 + その他収入" />
          <Metric label="初年度取り崩し" value={manYen(result.firstYearWithdrawal)} helper="支出 - 年金等" />
          <Metric
            label="資産寿命の目安"
            value={result.depletedAge ? `${result.depletedAge}歳` : `${settings.planUntilAge}歳時点で残あり`}
            helper="前提条件に基づく試算"
          />
          <Metric label="最終年の試算額" value={manYen(result.finalAssets)} helper={`${settings.planUntilAge}歳時点`} />
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>老後資産の推移グラフ</h2>
            <p>{retirementVariability.trialCount.toLocaleString("ja-JP")}回のモンテカルロ試行で、年金・社会保険・税金を含む老後資産の幅を確認します。</p>
          </div>
          <span className="status-pill recurring">{result.startAge}歳〜{settings.planUntilAge}歳</span>
        </div>
        <div className="chart-toolbar">
          <label className="compact-number-field">
            年ごとのばらつき幅 %
            <NumericInput value={retirementVariabilityRate} min={0} allowDecimal onChange={setRetirementVariabilityRate} />
          </label>
        </div>
        <LineChart points={retirementChartPoints} variabilityRows={retirementVariability.rows} />
        <div className="calculation-band compact">
          <Metric label={`${settings.planUntilAge}歳時点 下位10%`} value={manYen(retirementVariability.lowerFinal)} helper="前提条件に基づく下振れ側の試算" />
          <Metric label={`${settings.planUntilAge}歳時点 最頻帯`} value={manYen(retirementVariability.modeFinal)} helper="最も多かった金額帯の代表額" />
          <Metric label={`${settings.planUntilAge}歳時点 中央値`} value={manYen(retirementVariability.medianFinal)} helper="ばらつき試算の中央値" />
          <Metric label={`${settings.planUntilAge}歳時点 上位10%`} value={manYen(retirementVariability.upperFinal)} helper="上振れ側の試算" />
        </div>
        <div className={`notice-band ${retirementVariability.depletionRate > 0 ? "notice" : "check"}`}>
          <strong>資産が尽きるケース: {percent(retirementVariability.depletionRate)}</strong>
          <span>{retirementVariability.medianDepletedAge ? `資産が尽きた試行の中央値は${retirementVariability.medianDepletedAge}歳です。` : "1,000回の試行では、設定した年齢まで資産が残りました。"}</span>
        </div>
      </section>

      <section className="panel form-panel">
        <StepTitle step="Pro" title="基本条件" description="退職年齢、試算期間、利回り、物価上昇率などを置きます。" />
        <div className="form-grid">
          <label>
            退職年齢
            <NumericInput value={settings.retirementAge} min={plan.profile.age} onChange={(value) => updateRetirementPlan("retirementAge", value)} />
          </label>
          <label>
            何歳まで見るか
            <NumericInput value={settings.planUntilAge} min={settings.retirementAge} onChange={(value) => updateRetirementPlan("planUntilAge", value)} />
          </label>
          <MoneyInput label="退職金・一時金" value={settings.retirementLumpSum} onChange={(value) => updateRetirementPlan("retirementLumpSum", value)} />
          <label>
            退職後の想定利回り %
            <NumericInput value={settings.annualReturnRate} min={0} allowDecimal onChange={(value) => updateRetirementPlan("annualReturnRate", value)} />
          </label>
          <label>
            物価上昇率 %
            <NumericInput value={settings.inflationRate} min={0} allowDecimal onChange={(value) => updateRetirementPlan("inflationRate", value)} />
          </label>
        </div>
      </section>

      <section className="panel form-panel">
        <StepTitle step="1" title="退職後の生活費" description="毎月の生活費と、年1回程度の特別支出を分けて置きます。" />
        <div className="form-grid">
          <MoneyInput label="基本生活費 月額" value={settings.monthlyLivingCost} onChange={(value) => updateRetirementPlan("monthlyLivingCost", value)} />
          <MoneyInput label="住居費 月額" value={settings.monthlyHousingCost} onChange={(value) => updateRetirementPlan("monthlyHousingCost", value)} />
          <MoneyInput label="医療費 月額" value={settings.monthlyMedicalCost} onChange={(value) => updateRetirementPlan("monthlyMedicalCost", value)} />
          <MoneyInput label="介護・支援費 月額" value={settings.monthlyCareCost} onChange={(value) => updateRetirementPlan("monthlyCareCost", value)} />
          <MoneyInput label="年間特別支出" value={settings.annualExtraExpense} onChange={(value) => updateRetirementPlan("annualExtraExpense", value)} />
        </div>
      </section>

      <section className="panel form-panel">
        <StepTitle step="2" title="年金・収入" description="公的年金、企業年金、個人年金、退職後の収入を月額で置きます。" />
        <div className="form-grid">
          <MoneyInput label="公的年金 月額" value={settings.monthlyPublicPension} onChange={(value) => updateRetirementPlan("monthlyPublicPension", value)} />
          <MoneyInput label="企業年金・個人年金 月額" value={settings.monthlyPrivatePension} onChange={(value) => updateRetirementPlan("monthlyPrivatePension", value)} />
          <MoneyInput label="その他収入 月額" value={settings.monthlyOtherIncome} onChange={(value) => updateRetirementPlan("monthlyOtherIncome", value)} />
        </div>
        <div className="helper-grid">
          <div>
            <strong>月額収入の合計</strong>
            <span>{manYen(pensionMonthlyTotal)}。ねんきん定期便や勤務先資料などを見ながら、概算として入力します。</span>
          </div>
        </div>
      </section>

      <section className="panel form-panel">
        <StepTitle step="3" title="社会保険・税金の概算" description="国民健康保険、介護保険、税金などを月額の概算で置きます。" />
        <div className="form-grid">
          <MoneyInput
            label="国民健康保険 月額概算"
            value={settings.monthlyHealthInsurance}
            onChange={(value) => updateRetirementPlan("monthlyHealthInsurance", value)}
          />
          <MoneyInput
            label="介護保険 月額概算"
            value={settings.monthlyLongTermCareInsurance}
            onChange={(value) => updateRetirementPlan("monthlyLongTermCareInsurance", value)}
          />
          <MoneyInput label="税金 月額概算" value={settings.monthlyTaxes} onChange={(value) => updateRetirementPlan("monthlyTaxes", value)} />
        </div>
        <div className="helper-grid">
          <div>
            <strong>月額概算の合計</strong>
            <span>{manYen(socialMonthlyTotal)}。正確な金額は自治体や専門家、公式資料で確認する前提です。</span>
          </div>
          <div>
            <strong>ここで扱わないこと</strong>
            <span>自治体ごとの保険料率、控除、所得区分、世帯ごとの正式な税額計算は行いません。</span>
          </div>
        </div>
      </section>

      <VariabilityPanel
        title="老後資産のばらつき試算"
        description="退職後の利回りが毎年一定ではない前提を置き、資産残高の幅と資産が尽きるケースの割合を確認します。"
        result={retirementVariability}
        suppressPanel
        volatilityRate={retirementVariabilityRate}
        onVolatilityRateChange={setRetirementVariabilityRate}
        finalLabel={`${settings.planUntilAge}歳時点`}
      />

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>年齢別の取り崩し見通し</h2>
            <p>生活費と社会保険・税金は物価上昇率を反映し、年金等の収入は現在の入力額を固定して試算します。</p>
          </div>
          <span className="status-pill recurring">{result.rows.length}年分</span>
        </div>
        <div className="table-wrap projection-detail-table">
          <table>
            <thead>
              <tr>
                <th>年齢</th>
                <th>生活費</th>
                <th>社会保険・税</th>
                <th>年金等</th>
                <th>取り崩し</th>
                <th>年末資産</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.yearIndex}>
                  <td>{row.age}歳</td>
                  <td>{manYen(row.annualLivingCost)}</td>
                  <td>{manYen(row.annualSocialInsuranceAndTax)}</td>
                  <td>{manYen(row.annualRetirementIncome)}</td>
                  <td>{manYen(row.withdrawalAmount)}</td>
                  <td>{manYen(row.assets)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {firstRow && (
          <div className="explanation-grid">
            <div>
              <strong>初年度の見方</strong>
              <span>
                支出 {manYen(firstRow.annualLivingCost + firstRow.annualSocialInsuranceAndTax)}、年金等 {manYen(firstRow.annualRetirementIncome)}、
                取り崩し {manYen(firstRow.withdrawalAmount)} の前提です。
              </span>
            </div>
            <div>
              <strong>使い方</strong>
              <span>退職年齢、生活費、年金、国民健康保険などの概算を変えて、老後生活の余裕度を比較します。</span>
            </div>
            <div>
              <strong>注意点</strong>
              <span>将来の制度、物価、医療費、介護費、運用状況を保証するものではありません。</span>
            </div>
          </div>
        )}
      </section>

      <StepFlowNav
        setActiveView={setActiveView}
        previous={{ view: "simulation", label: "シミュレーション" }}
        next={{ view: "scenarios", label: "シナリオ比較" }}
      />
    </div>
  );
}

function VariabilityPanel({
  title,
  description,
  result,
  volatilityRate,
  onVolatilityRateChange,
  finalLabel,
  suppressPanel = false
}: {
  title: string;
  description: string;
  result: VariabilityResult;
  volatilityRate: number;
  onVolatilityRateChange: (value: number) => void;
  finalLabel: string;
  suppressPanel?: boolean;
}) {
  if (suppressPanel) return null;

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <label className="compact-number-field">
          年ごとのばらつき幅 %
          <NumericInput value={volatilityRate} min={0} allowDecimal onChange={onVolatilityRateChange} />
        </label>
      </div>
      <div className="notice-band">
        <strong>将来を予測するものではありません</strong>
        <span>{result.trialCount.toLocaleString("ja-JP")}回のモンテカルロ試行による参考試算です。最頻帯は、最も多く集まった金額帯の代表額です。</span>
      </div>
      <VariabilityBandChart rows={result.rows} />
      <div className="calculation-band compact">
        <Metric label={`${finalLabel} 下位10%`} value={manYen(result.lowerFinal)} helper="下振れ側の水準" />
        <Metric label={`${finalLabel} 最頻帯`} value={manYen(result.modeFinal)} helper="最も多かった金額帯" />
        <Metric label={`${finalLabel} 中央値`} value={manYen(result.medianFinal)} helper="結果を順に並べた中央" />
        <Metric label={`${finalLabel} 上位10%`} value={manYen(result.upperFinal)} helper="上振れ側の水準" />
      </div>
      <div className="table-wrap projection-detail-table">
        <table>
          <thead>
            <tr>
              <th>時点</th>
              <th>下位</th>
              <th>最頻帯</th>
              <th>中央値</th>
              <th>上位</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={`${row.label}-${row.yearIndex}`}>
                <td>{row.label}</td>
                <td>{manYen(row.lower)}</td>
                <td>{manYen(row.mode)}</td>
                <td>{manYen(row.median)}</td>
                <td>{manYen(row.upper)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function NotesView({
  mode,
  plan,
  setActiveView,
  updateNotes,
  addReview,
  updateReview,
  removeReview
}: {
  mode: "notes" | "reviews";
  plan: LifePlan;
  setActiveView: (view: ViewKey) => void;
  updateNotes: <K extends keyof PlanNotes>(key: K, value: PlanNotes[K]) => void;
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
        <StepTitle step="8" title="メモ" description="無料版では、今の前提や次の見直しを1つのプラン内に保存できます。" />
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
              value={reviewBudgetSummary.actualEntryCount > 0 ? manYen(reviewBudgetSummary.variance) : "未入力"}
              helper={`${reviewMonthKey} 実績 - 予算`}
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

type ScenarioComparisonViewProps = {
  plan: LifePlan;
  addScenario: (template: ScenarioTemplate) => void;
  updateScenario: <K extends keyof PlanScenario>(id: string, key: K, value: PlanScenario[K]) => void;
  removeScenario: (id: string) => void;
};

function getScenarioComparisonMetrics(plan: LifePlan) {
  const scenarios = plan.scenarios || [];
  const comparisonPlans = [
    { id: "current", name: "現在プラン", plan },
    ...scenarios.map((scenario) => ({
      id: scenario.id,
      name: scenario.name,
      plan: buildPlanFromScenario(plan, scenario)
    }))
  ];

  return comparisonPlans.map((item) => {
    const cashflow = getCashflowSummary(item.plan.household);
    const assets = getAssetSummary(item.plan.assets);
    const projection = projectAssets(item.plan, 30);
    const primaryGoal = getPrimaryGoal(item.plan);
    const goalAchievement = primaryGoal ? getGoalAchievement(item.plan, primaryGoal) : null;
    const emergency = getEmergencyFundResult(item.plan);
    const goalLabel = !primaryGoal
      ? "目標未設定"
      : goalAchievement?.status === "achieved"
        ? "達成済み"
        : goalAchievement?.status === "unreachable"
          ? "毎月の準備額未設定"
          : goalAchievement?.status === "recurring"
            ? `${primaryGoal.title}: 継続目標`
            : `${primaryGoal.title}: ${goalAchievement?.targetAge}歳目安`;
    const emergencyLabel =
      emergency.status === "short"
        ? `${emergency.lowerMonths}ヶ月分まであと${manYen(emergency.shortageToLower)}`
        : emergency.status === "above"
          ? `${emergency.upperMonths}ヶ月分を上回る`
          : `${emergency.lowerMonths}ヶ月分の目安内`;

    return {
      id: item.id,
      name: item.name,
      monthlySavings: cashflow.monthlySavings,
      annualBalance: cashflow.annualIncome - cashflow.annualLivingCost,
      netAssets: assets.netAssets,
      tenYear: projection[10]?.value ?? 0,
      thirtyYear: projection[30]?.value ?? 0,
      goalLabel,
      emergencyLabel
    };
  });
}

function ScenarioComparisonView({ plan, addScenario, updateScenario, removeScenario }: ScenarioComparisonViewProps) {
  const scenarios = plan.scenarios || [];
  const [selectedScenarioId, setSelectedScenarioId] = useState("current");
  const comparisonMetrics = useMemo(() => getScenarioComparisonMetrics(plan), [plan]);
  const scenarioOptions = useMemo(
    () => [
      { id: "current", name: "現在プラン", plan },
      ...scenarios.map((scenario) => ({ id: scenario.id, name: scenario.name, plan: buildPlanFromScenario(plan, scenario) }))
    ],
    [plan, scenarios]
  );
  const selectedScenario = scenarioOptions.find((item) => item.id === selectedScenarioId) || scenarioOptions[0];
  const selectedScenarioRows = getAnnualProjectionRows(selectedScenario.plan, 30);

  return (
    <div className="view-stack">
      <section className="pro-hero">
        <div>
          <p className="eyebrow">Pro予定 / シナリオ比較</p>
          <h2>選択肢ごとの将来見通しを横並びで確認</h2>
          <p>現状維持、支出見直し、転職、副業、住宅購入、早期退職などを同じ入力条件から分けて保存します。</p>
        </div>
        <span className="lock-badge">Coming soon</span>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>シナリオを追加</h2>
            <p>テンプレートは仮条件です。個別の助言ではなく、前提条件に基づく比較用のたたき台として使います。</p>
          </div>
          <span className="status-pill recurring">{scenarios.length}件</span>
        </div>
        <div className="template-actions">
          {scenarioTemplates.map((template) => (
            <button key={template.tag} type="button" className="secondary" onClick={() => addScenario(template)}>
              {template.name}
            </button>
          ))}
        </div>
        {scenarios.length === 0 ? (
          <EmptyState title="シナリオはまだありません" detail="まずは現状維持と、気になる変更案を1つ追加すると比較しやすくなります。" />
        ) : (
          <div className="scenario-list">
            {scenarios.map((scenario) => (
              <div className="scenario-row" key={scenario.id}>
                <label>
                  シナリオ名
                  <input value={scenario.name} onChange={(event) => updateScenario(scenario.id, "name", event.target.value)} />
                </label>
                <label>
                  種類
                  <select
                    value={scenario.tag}
                    onChange={(event) => updateScenario(scenario.id, "tag", event.target.value as ScenarioTag)}
                  >
                    {Object.entries(scenarioTagLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="scenario-description-field">
                  前提メモ
                  <input
                    value={scenario.description}
                    onChange={(event) => updateScenario(scenario.id, "description", event.target.value)}
                    placeholder="例: 固定費を月3万円見直す"
                  />
                </label>
                <button type="button" className="text-button" onClick={() => removeScenario(scenario.id)}>
                  削除
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>シナリオ別の年次グラフ</h2>
            <p>選んだシナリオの30年見通しをグラフで確認します。</p>
          </div>
          <label className="compact-select">
            表示シナリオ
            <select value={selectedScenarioId} onChange={(event) => setSelectedScenarioId(event.target.value)}>
              {scenarioOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <LineChart points={selectedScenarioRows} />
      </section>

      <section className="panel">
        <h2>比較表</h2>
        <p>入力条件に基づく参考試算として、主要な差分を確認します。</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>比較項目</th>
                {comparisonMetrics.map((item) => (
                  <th key={item.id}>{item.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { label: "月間貯蓄額", getValue: (item: (typeof comparisonMetrics)[number]) => manYen(item.monthlySavings) },
                { label: "年間収支", getValue: (item: (typeof comparisonMetrics)[number]) => manYen(item.annualBalance) },
                { label: "現在純資産", getValue: (item: (typeof comparisonMetrics)[number]) => manYen(item.netAssets) },
                { label: "10年後資産", getValue: (item: (typeof comparisonMetrics)[number]) => manYen(item.tenYear) },
                { label: "30年後資産", getValue: (item: (typeof comparisonMetrics)[number]) => manYen(item.thirtyYear) },
                { label: "主要目標の達成目安", getValue: (item: (typeof comparisonMetrics)[number]) => item.goalLabel },
                { label: "生活防衛資金の状態", getValue: (item: (typeof comparisonMetrics)[number]) => item.emergencyLabel }
              ].map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  {comparisonMetrics.map((item) => (
                    <td key={`${row.label}-${item.id}`}>{row.getValue(item)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

type DiagnosisItem = {
  title: string;
  detail: string;
  tone: "good" | "check" | "notice";
  view: ViewKey;
};

function getLifePlanDiagnosis(plan: LifePlan): DiagnosisItem[] {
  const cashflow = getCashflowSummary(plan.household);
  const assets = getAssetSummary(plan.assets);
  const emergency = getEmergencyFundResult(plan);
  const goalAchievements = getGoalAchievements(plan);
  const eventYears = new Map<number, { count: number; impact: number }>();

  plan.events.forEach((event) => {
    const current = eventYears.get(event.year) || { count: 0, impact: 0 };
    const impact = event.cashflowType === "expense" ? -event.amount : event.cashflowType === "income" ? event.amount : 0;
    eventYears.set(event.year, { count: current.count + 1, impact: current.impact + impact });
  });

  const concentratedYear = [...eventYears.entries()].sort((a, b) => b[1].count - a[1].count || Math.abs(b[1].impact) - Math.abs(a[1].impact))[0];
  const ownerCounts = plan.events.reduce<Record<EventOwner, number>>(
    (counts, event) => {
      counts[event.owner || "household"] += 1;
      return counts;
    },
    { self: 0, spouse: 0, child: 0, parent: 0, household: 0, other: 0 }
  );
  const latestReview = [...(plan.reviews || [])].sort((a, b) => b.date.localeCompare(a.date))[0];
  const daysSinceReview = latestReview
    ? Math.floor((Date.now() - new Date(latestReview.date).getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const openTodos = (plan.reviews || []).filter((review) => review.todo && !review.todoDone).length;
  const backupDays = plan.updatedAt ? Math.floor((Date.now() - new Date(plan.updatedAt).getTime()) / (1000 * 60 * 60 * 24)) : null;
  const currentDate = new Date();
  const currentMonthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}`;
  const budgetSummary = getBudgetSummary(plan.budgetItems || [], currentMonthKey);
  const overBudgetCategories = budgetSummary.categoryRows.filter((row) => row.variance > 0);
  const items: DiagnosisItem[] = [];

  items.push({
    title: emergency.status === "short" ? "生活防衛資金に不足があります" : "生活防衛資金の目安を確認済みです",
    detail:
      emergency.status === "short"
        ? `${emergency.lowerMonths}ヶ月分まであと${manYen(emergency.shortageToLower)}です。固定費や毎月貯蓄額と合わせて確認します。`
        : `${emergency.lowerMonths}〜${emergency.upperMonths}ヶ月分の目安と現在の現金を比較しています。`,
    tone: emergency.status === "short" ? "notice" : "good",
    view: "simulation"
  });

  items.push({
    title: cashflow.monthlySavings < 0 ? "毎月収支がマイナスの前提です" : "毎月貯蓄額が入力されています",
    detail:
      cashflow.monthlySavings < 0
        ? `毎月${manYen(Math.abs(cashflow.monthlySavings))}の不足です。固定費、変動費、特別支出の入力を確認します。`
        : `毎月${manYen(cashflow.monthlySavings)}、貯蓄率${percent(cashflow.savingsRate)}の前提です。`,
    tone: cashflow.monthlySavings < 0 ? "notice" : "check",
    view: "household"
  });

  if (assets.netAssets < 0) {
    items.push({
      title: "純資産がマイナスの前提です",
      detail: `現在純資産は${manYen(assets.netAssets)}です。資産入力の負債やその他資産を確認します。`,
      tone: "notice",
      view: "assets"
    });
  }

  const unreachableGoals = goalAchievements.filter(({ achievement }) => achievement.status === "unreachable");
  if (unreachableGoals.length > 0) {
    items.push({
      title: "達成目安が出ない目標があります",
      detail: `${unreachableGoals.length}件の目標で、毎月この目標に回す額が未入力です。`,
      tone: "check",
      view: "goals"
    });
  } else if (plan.goals.length > 0) {
    items.push({
      title: "目標の達成目安を確認できます",
      detail: `${plan.goals.length}件の目標について、期限や準備額をもとに確認できます。`,
      tone: "good",
      view: "goals"
    });
  }

  if (concentratedYear && concentratedYear[1].count >= 3) {
    items.push({
      title: "イベントが集中している年があります",
      detail: `${concentratedYear[0]}年に${concentratedYear[1].count}件のイベントがあります。支出・収入変化の重なりを確認します。`,
      tone: "check",
      view: "timeline"
    });
  }

  if (ownerCounts.child > 0 || ownerCounts.parent > 0 || ownerCounts.spouse > 0) {
    items.push({
      title: "世帯メンバー別のイベントがあります",
      detail: `子ども${ownerCounts.child}件、親${ownerCounts.parent}件、配偶者${ownerCounts.spouse}件。対象者フィルターで確認できます。`,
      tone: "good",
      view: "timeline"
    });
  } else {
    items.push({
      title: "対象者別イベントはまだ少なめです",
      detail: "配偶者、子ども、親に関する予定がある場合は、年表で対象者を分けると見返しやすくなります。",
      tone: "check",
      view: "timeline"
    });
  }

  items.push({
    title: latestReview ? "レビュー履歴があります" : "レビュー履歴はまだありません",
    detail: latestReview
      ? `最新レビューは${latestReview.date}です。${daysSinceReview !== null ? `${daysSinceReview}日前の記録です。` : ""}`
      : "月次・四半期レビューを残すと、前回との差分とTODOを確認できます。",
    tone: latestReview ? "good" : "check",
    view: "reviews"
  });

  if (openTodos > 0) {
    items.push({
      title: "未完了TODOがあります",
      detail: `${openTodos}件のTODOが未完了です。次回の見直しで確認できます。`,
      tone: "check",
      view: "reviews"
    });
  }

  if ((plan.budgetItems || []).length === 0) {
    items.push({
      title: "予算・実績プランはまだありません",
      detail: "月別の予算と実績を入れると、レビューや家計入力の前提確認に使えます。",
      tone: "check",
      view: "budget"
    });
  } else if (overBudgetCategories.length > 0) {
    items.push({
      title: "予算を上回っているカテゴリがあります",
      detail: `${currentMonthKey} は ${overBudgetCategories.slice(0, 3).map((row) => budgetCategoryLabels[row.category]).join("、")} を確認できます。`,
      tone: "check",
      view: "budget"
    });
  } else {
    items.push({
      title: "予算・実績を確認できます",
      detail: `${(plan.budgetItems || []).length}件の予算項目があります。月次レビューの前提として使えます。`,
      tone: "good",
      view: "budget"
    });
  }

  items.push({
    title: (plan.scenarios || []).length > 0 ? "比較シナリオがあります" : "比較シナリオはまだありません",
    detail:
      (plan.scenarios || []).length > 0
        ? `${plan.scenarios.length}件のシナリオを保存しています。年次グラフと比較表で確認できます。`
        : "転職、副業、住宅購入などの変更案を保存すると、現状プランと比較できます。",
    tone: (plan.scenarios || []).length > 0 ? "good" : "check",
    view: "scenarios"
  });

  if (backupDays !== null && backupDays >= 30) {
    items.push({
      title: "バックアップ確認の時期です",
      detail: `最終保存から約${backupDays}日です。必要に応じてJSONエクスポートを確認します。`,
      tone: "check",
      view: "data"
    });
  }

  return items;
}

function LifePlanDiagnosisView({ plan, setActiveView }: { plan: LifePlan; setActiveView: (view: ViewKey) => void }) {
  const diagnosisItems = getLifePlanDiagnosis(plan);
  const counts = {
    good: diagnosisItems.filter((item) => item.tone === "good").length,
    check: diagnosisItems.filter((item) => item.tone === "check").length,
    notice: diagnosisItems.filter((item) => item.tone === "notice").length
  };

  return (
    <div className="view-stack">
      <section className="pro-hero">
        <div>
          <p className="eyebrow">Pro予定 / ライフプラン診断</p>
          <h2>入力条件の確認ポイントを横断整理</h2>
          <p>家計、資産、目標、イベント、レビュー履歴をまとめて確認します。結果は助言ではなく、入力条件に基づく参考メモです。</p>
        </div>
        <span className="lock-badge">Coming soon</span>
      </section>

      <section className="calculation-band compact">
        <Metric label="確認済み" value={`${counts.good}件`} helper="整っている項目" />
        <Metric label="見直し候補" value={`${counts.check}件`} helper="確認するとよい項目" />
        <Metric label="注意して確認" value={`${counts.notice}件`} helper="入力条件上の不足や赤字" />
        <Metric label="診断項目" value={`${diagnosisItems.length}件`} helper="前提条件に基づく整理" />
      </section>

      <section className="panel">
        <h2>確認ポイント</h2>
        <div className="diagnosis-list">
          {diagnosisItems.map((item) => (
            <button type="button" className={`diagnosis-item ${item.tone}`} key={item.title} onClick={() => setActiveView(item.view)}>
              <div>
                <span>{item.tone === "good" ? "確認済み" : item.tone === "notice" ? "注意して確認" : "見直し候補"}</span>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </div>
              <span>開く</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

type ProViewProps = {
  plan: LifePlan;
  setActiveView: (view: ViewKey) => void;
  addScenario: (template: ScenarioTemplate) => void;
  updateScenario: <K extends keyof PlanScenario>(id: string, key: K, value: PlanScenario[K]) => void;
  removeScenario: (id: string) => void;
  addFixedCostItem: () => void;
  updateFixedCostItem: <K extends keyof FixedCostItem>(id: string, key: K, value: FixedCostItem[K]) => void;
  removeFixedCostItem: (id: string) => void;
};

function ProView({
  plan,
  setActiveView,
  addScenario,
  updateScenario,
  removeScenario,
  addFixedCostItem,
  updateFixedCostItem,
  removeFixedCostItem
}: ProViewProps) {
  const scenarios = plan.scenarios || [];
  const fixedCostItems = plan.fixedCostItems || [];
  const fixedCostImpact = getFixedCostImpact(fixedCostItems);
  const comparisonMetrics = useMemo(() => getScenarioComparisonMetrics(plan), [plan]);

  return (
    <div className="view-stack">
      <section className="pro-hero">
        <div>
          <p className="eyebrow">Proプレビュー / Coming soon</p>
          <h2>複数シナリオを比較し、見直しを続けるためのPro基盤</h2>
          <p>{proPriceLabel}。現在は課金機能を実装せず、将来のサブスク導入に備えて機能境界とデータ構造を先に整えています。</p>
          <div className="button-row">
            <button type="button" className="secondary hero-action" onClick={() => setActiveView("scenarios")}>
              シナリオ比較を開く
            </button>
            <button type="button" className="secondary hero-action" onClick={() => setActiveView("reviews")}>
              レビュー履歴を開く
            </button>
            <button type="button" className="secondary hero-action" onClick={() => setActiveView("diagnosis")}>
              ライフプラン診断を開く
            </button>
            <button type="button" className="secondary hero-action" onClick={() => setActiveView("retirement")}>
              老後プランを開く
            </button>
          </div>
        </div>
        <span className="lock-badge">課金なし</span>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>複数シナリオ保存</h2>
            <p>現在の入力条件をもとに、比較用の仮シナリオを保存します。正式なPro提供時は、シナリオ数や比較機能をPro範囲として整理します。</p>
          </div>
          <span className="status-pill recurring">Pro予定</span>
        </div>
        <div className="template-actions">
          {scenarioTemplates.map((template) => (
            <button key={template.tag} type="button" className="secondary" onClick={() => addScenario(template)}>
              {template.name}
            </button>
          ))}
        </div>
        {scenarios.length === 0 ? (
          <EmptyState title="シナリオはまだありません" detail="上のテンプレートから、現状維持・支出見直し・転職などの比較用シナリオを追加できます。" />
        ) : (
          <div className="scenario-list">
            {scenarios.map((scenario) => (
              <div className="scenario-row" key={scenario.id}>
                <label>
                  シナリオ名
                  <input value={scenario.name} onChange={(event) => updateScenario(scenario.id, "name", event.target.value)} />
                </label>
                <label>
                  種類
                  <select
                    value={scenario.tag}
                    onChange={(event) => updateScenario(scenario.id, "tag", event.target.value as ScenarioTag)}
                  >
                    {Object.entries(scenarioTagLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="scenario-description-field">
                  メモ
                  <input
                    value={scenario.description}
                    onChange={(event) => updateScenario(scenario.id, "description", event.target.value)}
                    placeholder="このシナリオの前提メモ"
                  />
                </label>
                <button type="button" className="text-button" onClick={() => removeScenario(scenario.id)}>
                  削除
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>シナリオ比較</h2>
        <p>入力条件に基づく参考試算として、現在プランと保存済みシナリオを横並びで確認します。</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>比較項目</th>
                {comparisonMetrics.map((item) => (
                  <th key={item.id}>{item.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { label: "月間貯蓄額", getValue: (item: (typeof comparisonMetrics)[number]) => manYen(item.monthlySavings) },
                { label: "年間収支", getValue: (item: (typeof comparisonMetrics)[number]) => manYen(item.annualBalance) },
                { label: "現在純資産", getValue: (item: (typeof comparisonMetrics)[number]) => manYen(item.netAssets) },
                { label: "10年後資産", getValue: (item: (typeof comparisonMetrics)[number]) => manYen(item.tenYear) },
                { label: "30年後資産", getValue: (item: (typeof comparisonMetrics)[number]) => manYen(item.thirtyYear) },
                { label: "主要目標の達成目安", getValue: (item: (typeof comparisonMetrics)[number]) => item.goalLabel },
                { label: "生活防衛資金の状態", getValue: (item: (typeof comparisonMetrics)[number]) => item.emergencyLabel }
              ].map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  {comparisonMetrics.map((item) => (
                    <td key={`${row.label}-${item.id}`}>{row.getValue(item)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>固定費見直しインパクト</h2>
            <p>月額の差分を、年間・10年・30年の単純差額として確認します。利回り、税金、契約条件などは含めません。</p>
          </div>
          <button type="button" onClick={addFixedCostItem}>
            項目を追加
          </button>
        </div>
        <div className="summary-grid compact">
          <Metric label="月間改善額" value={manYen(fixedCostImpact.monthlyImprovement)} helper="現在額 - 見直し後" />
          <Metric label="年間改善額" value={manYen(fixedCostImpact.annualImprovement)} helper="月間改善額 × 12" />
          <Metric label="10年の単純差額" value={manYen(fixedCostImpact.tenYearSimpleImpact)} helper="運用益等は含めない" />
          <Metric label="30年の単純差額" value={manYen(fixedCostImpact.thirtyYearSimpleImpact)} helper="前提条件に基づく試算" />
        </div>
        <FixedCostItemList
          items={fixedCostItems}
          updateFixedCostItem={updateFixedCostItem}
          removeFixedCostItem={removeFixedCostItem}
        />
      </section>

      <section className="panel">
        <h2>レビュー履歴のPro拡張</h2>
        <div className="boundary-grid">
          <div>
            <strong>現在入っている基盤</strong>
            <p>月次/四半期、予定値と実績値、前回比、次回TODOをブラウザ内に保存できます。</p>
          </div>
          <div>
            <strong>将来のPro制限ポイント</strong>
            <p>レビュー件数、シナリオ別レビュー、差分の詳細表示、TODO管理の強化をサブスク機能として分けられます。</p>
          </div>
        </div>
      </section>

      <section className="pro-grid">
        {[
          "複数シナリオ保存",
          "シナリオ比較",
          "ライフプラン診断",
          "世帯イベント管理",
          "予算・実績レビュー",
          "固定費見直しインパクト",
          "詳細収入変化",
          "老後生活プラン",
          "詳細取り崩しシミュレーション",
          "月次/四半期レビュー",
          "家族/世帯モード",
          "課金連携予定"
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
  reminders,
  notificationMessage,
  updateSettings,
  requestBrowserNotifications,
  setActiveView
}: {
  settings: AppSettings;
  reminders: AppReminder[];
  notificationMessage: string;
  updateSettings: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  requestBrowserNotifications: () => Promise<void>;
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
        <StepTitle step="2" title="リマインダー" description="月末の実績入力、レビュー、目標や近いイベントの確認忘れを減らします。" />
        <div className="reminder-settings">
          <label className="setting-switch">
            <input
              type="checkbox"
              checked={settings.remindersEnabled}
              onChange={(event) => updateSettings("remindersEnabled", event.target.checked)}
            />
            <span>
              <strong>アプリ内リマインダー</strong>
              <small>ダッシュボードに確認項目を表示します。</small>
            </span>
          </label>
          <label>
            毎月の実績入力を知らせる日
            <NumericInput
              value={settings.actualReminderDay}
              min={1}
              max={28}
              onChange={(value) => updateSettings("actualReminderDay", value)}
            />
            <small>29日以降がない月にも対応するため、1〜28日で設定します。</small>
          </label>
          <label>
            レビューの間隔
            <select
              value={settings.reviewReminderInterval}
              onChange={(event) => updateSettings("reviewReminderInterval", event.target.value as ReviewReminderInterval)}
            >
              <option value="monthly">月次</option>
              <option value="quarterly">四半期</option>
            </select>
          </label>
        </div>
        <div className="notice-band check">
          <strong>現在の確認項目: {reminders.length}件</strong>
          <span>入力データと設定はブラウザ内だけに保存されます。</span>
        </div>
        <div className="button-row">
          <button type="button" className="secondary" onClick={requestBrowserNotifications}>
            {settings.browserNotifications ? "ブラウザ通知を確認" : "ブラウザ通知を許可"}
          </button>
        </div>
        <p className="muted">ブラウザ通知はLife Compassを開いた日に補助表示します。ブラウザを閉じている間の予約通知は行いません。</p>
        {notificationMessage && <p className="inline-message">{notificationMessage}</p>}
      </section>

      <section className="panel">
        <StepTitle step="3" title="基本的な使い方" description="無料版で1つのライフプランを作る流れです。" />
        <ol className="manual-list">
          <li>ライフプランで年齢、家族構成、働き方、住居形態を入力します。</li>
          <li>資産入力で、現金、投資資産、その他資産、ローンなどの負債を整理します。</li>
          <li>家計入力で現在の収支を整理し、予算・実績で月末に大まかな支出を振り返ります。</li>
          <li>目標管理で目標額と期限を入力し、達成したい年齢と達成年齢の目安を確認します。</li>
          <li>シミュレーションで年次見通しを確認し、グラフの点をタップして詳細を見ます。</li>
          <li>年表に住宅、教育、車、転職などのイベントを追加し、予定年齢を確認します。</li>
          <li>メモに次の見直しや判断の理由を残します。</li>
          <li>データ管理からJSONをエクスポートしてバックアップします。</li>
          <li>別の端末やブラウザで使う場合は、保存済みJSONをインポートして復元します。</li>
        </ol>
      </section>

      <section className="settings-grid">
        <div className="panel">
          <h2>データとプライバシー</h2>
          <p>入力データはこのブラウザ内に保存されます。サーバー保存やクラウド同期は行わず、JSONでバックアップ・復元します。</p>
          <button type="button" className="secondary" onClick={() => setActiveView("data")}>
            データ管理を開く
          </button>
        </div>
        <div className="panel">
          <h2>Pro機能・料金</h2>
          <p>複数シナリオ比較、固定費見直しインパクト、見直し履歴の拡張などを予定しています。初期版では課金処理は実装していません。</p>
          <button type="button" className="secondary" onClick={() => setActiveView("pricing")}>
            Pro機能・料金を見る
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
  impactLabel?: string;
  returnLabel?: string;
};

function VariabilityBandChart({ rows }: { rows: VariabilityResult["rows"] }) {
  if (rows.length === 0) return null;

  const width = 900;
  const height = 300;
  const padding = {
    top: 38,
    right: 42,
    bottom: 48,
    left: 76
  };
  const minValue = Math.min(...rows.map((row) => row.lower), ...rows.map((row) => row.mode), 0);
  const maxValue = Math.max(...rows.map((row) => row.upper), ...rows.map((row) => row.mode), 1);
  const valueRange = maxValue - minValue || 1;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const xStep = chartWidth / Math.max(rows.length - 1, 1);
  const pointFor = (row: VariabilityResult["rows"][number], index: number, key: "lower" | "mode" | "median" | "upper") => ({
    x: padding.left + index * xStep,
    y: height - padding.bottom - ((row[key] - minValue) / valueRange) * chartHeight
  });
  const upperPoints = rows.map((row, index) => pointFor(row, index, "upper"));
  const lowerPoints = rows.map((row, index) => pointFor(row, index, "lower"));
  const modePoints = rows.map((row, index) => pointFor(row, index, "mode"));
  const medianPoints = rows.map((row, index) => pointFor(row, index, "median"));
  const bandPath = [
    ...upperPoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`),
    ...lowerPoints
      .slice()
      .reverse()
      .map((point) => `L ${point.x} ${point.y}`),
    "Z"
  ].join(" ");
  const medianPath = medianPoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const modePath = modePoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const labelStep = rows.length > 20 ? 5 : rows.length > 12 ? 3 : 1;

  return (
    <div className="chart-block">
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="ばらつき試算の範囲グラフ">
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
          <path d={bandPath} className="range-band" />
          <path d={medianPath} className="range-median-line" />
          <path d={modePath} className="range-mode-line" />
          {medianPoints.map((point, index) => {
            const row = rows[index];
            const showLabel = index % labelStep === 0 || index === rows.length - 1;
            return (
              <g key={`${row.label}-${index}`}>
                <circle cx={point.x} cy={point.y} r="3.5" className="range-dot" />
                {showLabel && (
                  <text x={point.x} y={height - 16} textAnchor="middle" className="year-label">
                    {row.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="chart-legend" aria-label="グラフ凡例">
        <span><i className="legend-band" />下位10%〜上位10%</span>
        <span><i className="legend-median" />中央値</span>
        <span><i className="legend-mode" />最頻帯</span>
      </div>
    </div>
  );
}

function LineChart({
  points,
  variabilityRows
}: {
  points: ChartPoint[];
  variabilityRows?: VariabilityResult["rows"];
}) {
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
  const rangeRows = variabilityRows?.slice(0, points.length) ?? [];
  const fixedValues = rangeRows.length > 0 ? [] : points.map((point) => point.value);
  const minValue = Math.min(...fixedValues, ...rangeRows.map((row) => row.lower), ...rangeRows.map((row) => row.mode), 0);
  const maxValue = Math.max(...fixedValues, ...rangeRows.map((row) => row.upper), ...rangeRows.map((row) => row.mode), 1);
  const valueRange = maxValue - minValue || 1;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const xStep = chartWidth / Math.max(points.length - 1, 1);
  const coordinates = points.map((point, index) => {
    const x = padding.left + index * xStep;
    const plottedValue = rangeRows[index]?.median ?? point.value;
    const y = height - padding.bottom - ((plottedValue - minValue) / valueRange) * chartHeight;
    return { ...point, x, y, plottedValue };
  });
  const rangePointFor = (row: VariabilityResult["rows"][number], index: number, key: "lower" | "mode" | "median" | "upper") => ({
    x: padding.left + index * xStep,
    y: height - padding.bottom - ((row[key] - minValue) / valueRange) * chartHeight
  });
  const upperRangePoints = rangeRows.map((row, index) => rangePointFor(row, index, "upper"));
  const lowerRangePoints = rangeRows.map((row, index) => rangePointFor(row, index, "lower"));
  const modeRangePoints = rangeRows.map((row, index) => rangePointFor(row, index, "mode"));
  const medianRangePoints = rangeRows.map((row, index) => rangePointFor(row, index, "median"));
  const bandPath =
    rangeRows.length > 0
      ? [
          ...upperRangePoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`),
          ...lowerRangePoints
            .slice()
            .reverse()
            .map((point) => `L ${point.x} ${point.y}`),
          "Z"
        ].join(" ")
      : "";
  const medianRangePath = medianRangePoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const modeRangePath = modeRangePoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const upperRangePath = upperRangePoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const lowerRangePath = lowerRangePoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const path = coordinates.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const selectedPoint = selectedIndex === null ? null : coordinates[selectedIndex];
  const selectedRange = selectedIndex === null ? null : rangeRows[selectedIndex] ?? null;
  const previousPoint = selectedIndex !== null && selectedIndex > 0 ? coordinates[selectedIndex - 1] : undefined;
  const selectedRangeCoordinates =
    selectedIndex !== null && selectedRange
      ? {
          lower: rangePointFor(selectedRange, selectedIndex, "lower"),
          mode: rangePointFor(selectedRange, selectedIndex, "mode"),
          median: rangePointFor(selectedRange, selectedIndex, "median"),
          upper: rangePointFor(selectedRange, selectedIndex, "upper")
        }
      : null;
  const labelStep = points.length > 20 ? 5 : points.length > 12 ? 3 : 1;
  const selectedLabelY = selectedPoint ? (selectedPoint.y < padding.top + 28 ? selectedPoint.y + 26 : selectedPoint.y - 16) : 0;
  const selectedPointLabel = selectedPoint?.label ?? (selectedPoint ? `${selectedPoint.year}年` : "");
  const selectedAgeLabel = selectedPoint?.age ? `${selectedPoint.age}歳` : "";
  const shouldAppendSelectedAge = selectedAgeLabel !== "" && !selectedPointLabel.includes(selectedAgeLabel);
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
          {rangeRows.length > 0 && (
            <>
              <path d={bandPath} className="range-band" />
              <path d={upperRangePath} className="range-upper-line" />
              <path d={lowerRangePath} className="range-lower-line" />
              <path d={medianRangePath} className="range-median-line" />
              <path d={modeRangePath} className="range-mode-line" />
            </>
          )}
          {rangeRows.length === 0 && <path d={path} className="chart-line" />}
          {selectedPoint && selectedRangeCoordinates && (
            <>
              <line
                x1={selectedPoint.x}
                y1={padding.top}
                x2={selectedPoint.x}
                y2={height - padding.bottom}
                className="chart-selected-guide"
              />
              <circle cx={selectedRangeCoordinates.upper.x} cy={selectedRangeCoordinates.upper.y} r="5" className="selected-range-dot upper" />
              <circle cx={selectedRangeCoordinates.lower.x} cy={selectedRangeCoordinates.lower.y} r="5" className="selected-range-dot lower" />
              <circle cx={selectedRangeCoordinates.mode.x} cy={selectedRangeCoordinates.mode.y} r="5" className="selected-range-dot mode" />
            </>
          )}
          {coordinates.map((point, index) => {
            const isSelected = selectedIndex === index;
            const isScheduledLabel = index % labelStep === 0 || index === coordinates.length - 1;
            const isNearSelectedLabel =
              selectedIndex !== null && !isSelected && Math.abs(index - selectedIndex) < labelStep;
            const showYearLabel = isSelected || (isScheduledLabel && !isNearSelectedLabel);
            const pointLabel = point.label ?? `${point.year}`;
            const pointValue = rangeRows[index]?.median ?? point.value;
            return (
              <g key={`${pointLabel}-${index}`}>
                <g
                  role="button"
                  tabIndex={0}
                  className="chart-hit-button"
                  aria-label={`${pointLabel} ${rangeRows[index] ? "中央値 " : ""}${manYen(pointValue)}`}
                  onClick={() => setSelectedIndex(index)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedIndex(index);
                    }
                  }}
                >
                  <circle cx={point.x} cy={point.y} r="16" className="chart-hit-area" />
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={isSelected ? "6" : rangeRows.length > 0 ? "3" : "4"}
                    className={`${isSelected ? "chart-dot selected" : "chart-dot"}${rangeRows.length > 0 ? " monte-carlo" : ""}`}
                  />
                </g>
                {isSelected && (
                  <text x={point.x} y={selectedLabelY} textAnchor="middle" className="point-value-label">
                    {manYen(pointValue)}
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
      {rangeRows.length > 0 && (
        <div className="chart-legend" aria-label="グラフの凡例">
          <span><i className="legend-upper" />上位10%</span>
          <span><i className="legend-lower" />下位10%</span>
          <span><i className="legend-median" />中央値</span>
          <span><i className="legend-mode" />最頻帯</span>
        </div>
      )}
      <div className="chart-selection-panel" aria-live="polite">
        {selectedPoint ? (
          <>
            <div>
              <span>{selectedPointLabel}{shouldAppendSelectedAge ? ` / ${selectedAgeLabel}` : ""}{selectedRange ? " / 中央値" : ""}</span>
              <strong>{manYen(selectedRange?.median ?? selectedPoint.value)}</strong>
            </div>
            {!selectedRange && (
              <div>
                <span>{isMonthly ? "前月差" : "前年差"}</span>
                <strong>{previousPoint ? manYen(selectedPoint.value - previousPoint.value) : "-"}</strong>
              </div>
            )}
            {selectedRange && (
              <>
                <div>
                  <span>下位10%</span>
                  <strong>{manYen(selectedRange.lower)}</strong>
                </div>
                <div>
                  <span>最頻帯</span>
                  <strong>{manYen(selectedRange.mode)}</strong>
                </div>
                <div>
                  <span>上位10%</span>
                  <strong>{manYen(selectedRange.upper)}</strong>
                </div>
              </>
            )}
            {!selectedRange && "annualSavings" in selectedPoint && (
              <div>
                <span>年間貯蓄</span>
                <strong>{selectedPoint.annualSavings ? manYen(selectedPoint.annualSavings) : "-"}</strong>
              </div>
            )}
            {!selectedRange && "monthlySavings" in selectedPoint && (
              <div>
                <span>月間貯蓄</span>
                <strong>{selectedPoint.monthlySavings ? manYen(selectedPoint.monthlySavings) : "-"}</strong>
              </div>
            )}
            {"eventImpact" in selectedPoint && (
              <div>
                <span>{selectedPoint.impactLabel ?? "イベント影響"}</span>
                <strong>{selectedPoint.eventImpact ? manYen(selectedPoint.eventImpact) : "-"}</strong>
              </div>
            )}
            {!selectedRange && "returnImpact" in selectedPoint && (
              <div>
                <span>{selectedPoint.returnLabel ?? "利回り等の影響"}</span>
                <strong>{selectedPoint.returnImpact ? manYen(selectedPoint.returnImpact) : "-"}</strong>
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
          <p>グラフ上の点をタップすると、その時点の試算額を確認できます。</p>
        )}
      </div>
    </div>
  );
}

export default App;
