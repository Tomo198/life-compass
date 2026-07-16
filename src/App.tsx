import { useCallback, useEffect, useMemo, useState } from "react";
import { CURRENT_PLAN_VERSION } from "./config";
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
import {
  getMobileNavKey,
  getPublicPath,
  getViewForPath,
  getViewTitle,
  isLegalDocumentView,
  mobilePrimaryNavItems,
  navItems
} from "./navigation";
import { AssetsView } from "./views/AssetsView";
import { BudgetView } from "./views/BudgetView";
import { DashboardView } from "./views/DashboardView";
import { EventSettingsView } from "./views/EventSettingsView";
import { GoalsView } from "./views/GoalsView";
import { HouseholdView } from "./views/HouseholdView";
import { LegalDocumentView, LegalIndexView } from "./views/LegalView";
import { LifePlanDiagnosisView } from "./views/LifePlanDiagnosisView";
import { NotesView } from "./views/NotesView";
import { ProfileView } from "./views/ProfileView";
import { PricingView as PricingPage } from "./views/PricingView";
import { DataView as DataPage } from "./views/DataView";
import { RetirementPlanView } from "./views/RetirementPlanView";
import { ScenarioComparisonView } from "./views/ScenarioComparisonView";
import { SettingsView } from "./views/SettingsView";
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
  getTargetAgeForYear
} from "./utils/calculations";
import {
  getAppReminders,
  loadAppSettings,
  resolveTheme,
  saveAppSettings,
  type AppSettings
} from "./utils/settings";
import { createRecoveryBackup, exportPlan, loadPlan, savePlan } from "./utils/storage";

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
  const [activeView, setActiveViewState] = useState<ViewKey>(() => getViewForPath(window.location.pathname));
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
    const nextPath = getPublicPath(nextView);
    if (window.location.pathname !== nextPath) {
      window.history.pushState({ view }, "", nextPath);
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  useEffect(() => {
    const handlePopState = () => {
      const requestedView = getViewForPath(window.location.pathname);
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
              className={activeView === item.key || (item.key === "legal" && isLegalDocumentView(activeView)) ? "active" : ""}
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

export default App;
