import { useCallback, useEffect, useMemo, useState } from "react";
import { CURRENT_PLAN_VERSION } from "./config";
import { AccountPanel } from "./components/AccountPanel";
import { NumericInput, StepTitle } from "./components/CommonUi";
import { createId, defaultPlan } from "./data/defaultPlan";
import type { EventTemplate } from "./data/eventTemplates";
import type { GoalTemplate } from "./data/goalTemplates";
import {
  createScenarioFromTemplate,
  type ScenarioTemplate
} from "./data/scenarios";
import {
  canOpenView,
  defaultAccessState,
  hasFeatureAccess,
  type AccessState
} from "./features";
import { AssetsView } from "./views/AssetsView";
import { BudgetView } from "./views/BudgetView";
import { DashboardView } from "./views/DashboardView";
import { EventSettingsView } from "./views/EventSettingsView";
import { GoalsView } from "./views/GoalsView";
import { HouseholdView } from "./views/HouseholdView";
import { LegalDocumentView, LegalIndexView, type LegalDocumentKey } from "./views/LegalView";
import { LifePlanDiagnosisView } from "./views/LifePlanDiagnosisView";
import { NotesView } from "./views/NotesView";
import { ProfileView } from "./views/ProfileView";
import { PricingView as PricingPage } from "./views/PricingView";
import { DataView as DataPage } from "./views/DataView";
import { RetirementPlanView } from "./views/RetirementPlanView";
import { ScenarioComparisonView } from "./views/ScenarioComparisonView";
import { SimulationView } from "./views/SimulationView";
import { TimelineView } from "./views/TimelineView";
import type {
  Assets,
  BudgetItem,
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
  SimulationSettings,
  TimelineMemo,
  WithdrawalPlanSettings,
  ViewKey
} from "./types";
import {
  getAssetSummary,
  getBudgetHouseholdInputs,
  getCashflowSummary,
  getGoalPreparedPercent,
  getTargetAgeForYear
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
