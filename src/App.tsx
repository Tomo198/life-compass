import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CURRENT_PLAN_VERSION,
  MAX_PLAN_YEAR
} from "./config";
import { AccountPanel } from "./components/AccountPanel";
import { EmptyState, Metric, MoneyInput, NumericInput, StepFlowNav, StepTitle } from "./components/CommonUi";
import { FixedCostItemList } from "./components/FixedCostItemList";
import { LineChart } from "./components/Charts";
import { createId, defaultPlan } from "./data/defaultPlan";
import type { EventTemplate } from "./data/eventTemplates";
import type { GoalTemplate } from "./data/goalTemplates";
import { budgetCategoryLabels, eventOwnerLabels, monthLabels } from "./data/labels";
import {
  canOpenView,
  defaultAccessState,
  hasFeatureAccess,
  proPriceLabel,
  type AccessState
} from "./features";
import { AssetsView } from "./views/AssetsView";
import { BudgetView } from "./views/BudgetView";
import { DashboardView } from "./views/DashboardView";
import { EventSettingsView } from "./views/EventSettingsView";
import { GoalsView } from "./views/GoalsView";
import { HouseholdView } from "./views/HouseholdView";
import { LegalDocumentView, LegalIndexView, type LegalDocumentKey } from "./views/LegalView";
import { ProfileView } from "./views/ProfileView";
import { PricingView as PricingPage } from "./views/PricingView";
import { DataView as DataPage } from "./views/DataView";
import { RetirementPlanView } from "./views/RetirementPlanView";
import { SimulationView } from "./views/SimulationView";
import { TimelineView } from "./views/TimelineView";
import type {
  Assets,
  BudgetItem,
  EventOwner,
  FixedCostItem,
  Goal,
  Household,
  LifeEvent,
  LifePlan,
  PlanNotes,
  PlanScenario,
  Profile,
  RetirementPlanSettings,
  ReviewNote,
  ScenarioSnapshot,
  ScenarioTag,
  SimulationSettings,
  TimelineMemo,
  WithdrawalPlanSettings,
  ViewKey
} from "./types";
import {
  buildPlanFromScenario,
  emergencyMonthsLabel,
  getAssetSummary,
  getAnnualProjectionRows,
  getBudgetHouseholdInputs,
  getBudgetSummary,
  getCashflowSummary,
  getEmergencyFundResult,
  getFixedCostImpact,
  getGoalAchievement,
  getGoalAchievements,
  getGoalFundingSummary,
  getGoalPreparedPercent,
  getPrimaryGoal,
  getTargetAgeForYear,
  manYen,
  percent,
  projectAssets
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
  { key: "events", label: "イベント設定" },
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

type MobileNavKey = "home" | "household" | "goals" | "forecast" | "menu";

const mobilePrimaryNavItems: Array<{ key: MobileNavKey; label: string; view?: ViewKey }> = [
  { key: "home", label: "ホーム", view: "dashboard" },
  { key: "household", label: "家計", view: "household" },
  { key: "goals", label: "目標", view: "goals" },
  { key: "forecast", label: "見通し", view: "simulation" },
  { key: "menu", label: "メニュー" }
];

const mobileViewGroups: Record<Exclude<MobileNavKey, "menu">, ViewKey[]> = {
  home: ["dashboard"],
  household: ["profile", "assets", "household", "budget"],
  goals: ["goals", "events", "timeline", "notes"],
  forecast: ["simulation", "retirement"]
};

const getMobileNavKey = (view: ViewKey): MobileNavKey =>
  (Object.entries(mobileViewGroups).find(([, views]) => views.includes(view))?.[0] as MobileNavKey | undefined) || "menu";

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
    (goal) =>
      (goal.dueYear < currentYear || (goal.dueYear === currentYear && goal.dueMonth <= currentMonth)) &&
      goal.goalType === "oneTime" &&
      getGoalPreparedPercent(goal) < 100
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

const scenarioTagLabels: Record<ScenarioTag, string> = {
  current: "現状維持",
  spending: "支出見直し",
  career: "転職",
  sideBusiness: "副業開始",
  home: "住宅購入",
  retirement: "早期退職",
  custom: "自由入力"
};

const cloneDefaultPlan = () => JSON.parse(JSON.stringify(defaultPlan)) as LifePlan;

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
  timelineMemos: [],
  simulation: {
    monthlyInvestmentAmount: 0,
    annualBonusInvestmentAmount: 0,
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

function App() {
  const [plan, setPlan] = useState<LifePlan>(() => loadPlan());
  const [activeView, setActiveViewState] = useState<ViewKey>(() => getInitialView());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accessState, setAccessState] = useState<AccessState>(() => defaultAccessState);
  const [importMessage, setImportMessage] = useState("");
  const [storageError, setStorageError] = useState("");
  const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings());
  const [notificationMessage, setNotificationMessage] = useState("");
  const reminders = useMemo(() => getAppReminders(plan, settings), [plan, settings]);

  const refreshAccessState = useCallback(async () => {
    try {
      const response = await fetch("/api/entitlement", { credentials: "same-origin" });
      if (!response.ok) return;
      const body = await response.json() as { access?: Partial<AccessState> };
      const access = body.access;
      if (
        (access?.tier === "free" || access?.tier === "pro") &&
        (access.mode === "preview" || access.mode === "enforced") &&
        (access.source === "local-preview" || access.source === "anonymous" || access.source === "subscription")
      ) {
        setAccessState({ tier: access.tier, mode: access.mode, source: access.source });
      }
    } catch {
      // Static development mode keeps the local preview state when the Worker API is unavailable.
    }
  }, []);

  useEffect(() => {
    void refreshAccessState();
  }, [refreshAccessState]);

  const setActiveView = (view: ViewKey) => {
    const nextView = canOpenView(accessState, view) ? view : "pricing";
    setMobileMenuOpen(false);
    setActiveViewState(nextView);
    const nextPath = publicRoutes[nextView] || "/";
    if (window.location.pathname !== nextPath) {
      window.history.pushState({ view }, "", nextPath);
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  useEffect(() => {
    const handlePopState = () => {
      const requestedView = getInitialView();
      setMobileMenuOpen(false);
      setActiveViewState(canOpenView(accessState, requestedView) ? requestedView : "pricing");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [accessState]);

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

  const addTimelineMemo = () => {
    const now = new Date();
    const nextMemo: TimelineMemo = {
      id: createId(),
      title: "新しい予定メモ",
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      owner: "self",
      memo: "",
      showOnTimeline: true
    };
    commitPlan({ ...plan, timelineMemos: [...(plan.timelineMemos || []), nextMemo] });
  };

  const updateTimelineMemo = <K extends keyof TimelineMemo>(id: string, key: K, value: TimelineMemo[K]) => {
    commitPlan({
      ...plan,
      timelineMemos: (plan.timelineMemos || []).map((memo) => (memo.id === id ? { ...memo, [key]: value } : memo))
    });
  };

  const removeTimelineMemo = (id: string) => {
    commitPlan({ ...plan, timelineMemos: (plan.timelineMemos || []).filter((memo) => memo.id !== id) });
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
      dueMonth: 12,
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
      dueMonth: 12,
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
        return <DashboardView plan={plan} reminders={reminders} setActiveView={setActiveView} startEmptyPlan={startEmptyPlan} />;
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
            accessState={accessState}
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
      case "events":
        return (
          <EventSettingsView
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
            accessState={accessState}
          />
        );
      case "timeline":
        return <TimelineView plan={plan} setActiveView={setActiveView} />;
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
            addTimelineMemo={addTimelineMemo}
            updateTimelineMemo={updateTimelineMemo}
            removeTimelineMemo={removeTimelineMemo}
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
            addTimelineMemo={addTimelineMemo}
            updateTimelineMemo={updateTimelineMemo}
            removeTimelineMemo={removeTimelineMemo}
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
            accessState={accessState}
          />
        );
      case "pricing":
        return <PricingPage setActiveView={setActiveView} accessState={accessState} />;
      case "pro":
        return <PricingPage setActiveView={setActiveView} accessState={accessState} />;
      case "settings":
        return (
          <SettingsView
            settings={settings}
            reminders={reminders}
            notificationMessage={notificationMessage}
            updateSettings={updateSettings}
            requestBrowserNotifications={requestBrowserNotifications}
            setActiveView={setActiveView}
            refreshAccessState={refreshAccessState}
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
    <div
      className="app-shell"
      data-testid="app-shell"
      data-access-mode={accessState.mode}
      data-access-tier={accessState.tier}
    >
      {mobileMenuOpen && (
        <button
          type="button"
          className="mobile-menu-backdrop"
          aria-label="メニューを閉じる"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
      <aside className={`sidebar${mobileMenuOpen ? " mobile-open" : ""}`} aria-label="メインナビゲーション">
        <div className="mobile-menu-heading">
          <div>
            <strong>すべての機能</strong>
            <small>入力、見直し、データ管理</small>
          </div>
          <button type="button" className="secondary" onClick={() => setMobileMenuOpen(false)}>閉じる</button>
        </div>
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
            <button type="button" className="secondary topbar-export" onClick={() => exportPlan(plan)}>
              JSONエクスポート
            </button>
            <button type="button" className="topbar-settings" onClick={() => setActiveView("settings")}>
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
      <nav className="mobile-bottom-nav" aria-label="スマートフォン用ナビゲーション" data-testid="mobile-bottom-nav">
        {mobilePrimaryNavItems.map((item) => {
          const currentKey = getMobileNavKey(activeView);
          const active = item.key === "menu" ? mobileMenuOpen || currentKey === "menu" : currentKey === item.key;
          return (
            <button
              key={item.key}
              type="button"
              className={active ? "active" : ""}
              aria-current={active ? "page" : undefined}
              aria-expanded={item.key === "menu" ? mobileMenuOpen : undefined}
              data-mobile-nav={item.key}
              onClick={() => item.view ? setActiveView(item.view) : setMobileMenuOpen((open) => !open)}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function NotesView({
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
          : `${emergencyMonthsLabel(emergency.lowerMonths, emergency.upperMonths)}の目安内`;

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
                { label: "通常月の家計余剰", getValue: (item: (typeof comparisonMetrics)[number]) => manYen(item.monthlySavings) },
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
  const goalFunding = getGoalFundingSummary(plan);
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
  const overBudgetCategories = budgetSummary.categoryRows.filter(
    (row) => row.actualEntryCount === row.itemCount && row.variance > 0
  );
  const items: DiagnosisItem[] = [];

  items.push({
    title: emergency.status === "short" ? "生活防衛資金に不足があります" : "生活防衛資金の目安を確認済みです",
    detail:
      emergency.status === "short"
        ? `${emergency.lowerMonths}ヶ月分まであと${manYen(emergency.shortageToLower)}です。固定費や現金へ残す額と合わせて確認します。`
        : `${emergencyMonthsLabel(emergency.lowerMonths, emergency.upperMonths)}の目安と現在の現金を比較しています。`,
    tone: emergency.status === "short" ? "notice" : "good",
    view: "simulation"
  });

  items.push({
    title: cashflow.monthlySavings < 0 ? "通常月の収支がマイナスの前提です" : "通常月の家計余剰を確認できます",
    detail:
      cashflow.monthlySavings < 0
        ? `毎月${manYen(Math.abs(cashflow.monthlySavings))}の不足です。固定費、変動費、特別支出の入力を確認します。`
        : `通常月の家計余剰は${manYen(cashflow.monthlySavings)}、貯蓄率は${percent(cashflow.savingsRate)}の前提です。`,
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
  if (goalFunding.overAllocatedAmount > 0) {
    items.push({
      title: "目標への毎月配分が家計余剰を超えています",
      detail: `毎月${manYen(goalFunding.overAllocatedAmount)}の超過です。複数の目標で同じ資金を重ねて見込んでいないか確認します。`,
      tone: "notice",
      view: "goals"
    });
  } else if (unreachableGoals.length > 0) {
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
                { label: "通常月の家計余剰", getValue: (item: (typeof comparisonMetrics)[number]) => manYen(item.monthlySavings) },
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
  setActiveView,
  refreshAccessState
}: {
  settings: AppSettings;
  reminders: AppReminder[];
  notificationMessage: string;
  updateSettings: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  requestBrowserNotifications: () => Promise<void>;
  setActiveView: (view: ViewKey) => void;
  refreshAccessState: () => Promise<void>;
}) {
  return (
    <div className="view-stack">
      <AccountPanel onAccountChange={refreshAccessState} />

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
          <span>通常の入力データと設定はブラウザ内に保存されます。暗号化クラウドバックアップは、データ管理で利用者が明示的に操作した場合だけ作成されます。</span>
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
          <p>入力データは通常このブラウザ内に保存されます。JSONでバックアップ・復元でき、ログイン後に利用者自身が操作した場合だけ暗号化クラウドバックアップを作成できます。自動同期は行いません。</p>
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
        <p>シミュレーション画面の年次見通しは、グラフ上の点をタップすると12ヶ月ごとの試算額、前回時点との差、貯蓄反映、イベント影響を確認できます。</p>
      </section>
    </div>
  );
}

export default App;
