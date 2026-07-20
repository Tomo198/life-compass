import { useCallback, useEffect, useMemo, useState } from "react";
import {
  canOpenView,
  defaultAccessState,
  hasFeatureAccess,
  type AccessState
} from "./features";
import { useLifePlanEditor } from "./hooks/useLifePlanEditor";
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
import type { ViewKey } from "./types";
import {
  getAppReminders,
  loadAppSettings,
  resolveTheme,
  saveAppSettings,
  type AppSettings
} from "./utils/settings";
import { exportPlan } from "./utils/storage";

function App() {
  const {
    plan,
    commitPlan,
    importMessage,
    setImportMessage,
    storageError,
    updateProfile,
    updateHousehold,
    addCashflowPeriod,
    updateCashflowPeriod,
    removeCashflowPeriod,
    updateAssets,
    updateSimulation,
    updateWithdrawalPlan,
    updateWithdrawalPlanPatch,
    updateRetirementPlan,
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
    removePlanRevision,
    addScenario,
    updateScenario,
    updateScenarioHousehold,
    updateScenarioAssets,
    updateScenarioSimulation,
    adoptScenario,
    removeScenario,
    addFixedCostItem,
    updateFixedCostItem,
    removeFixedCostItem,
    addBudgetItem,
    updateBudgetItem,
    updateBudgetActual,
    removeBudgetItem,
    applyBudgetToHousehold,
    addGoal,
    addGoalFromTemplate,
    updateGoal,
    removeGoal,
    addEvent,
    addEventFromTemplate,
    updateEvent,
    updateEventSchedule,
    removeEvent,
    resetPlan,
    startEmptyPlan
  } = useLifePlanEditor();
  const [activeView, setActiveViewState] = useState<ViewKey>(() => getViewForPath(window.location.pathname));
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accessState, setAccessState] = useState<AccessState>(() => defaultAccessState);
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
        (access.source === "local-preview" || access.source === "operator" || access.source === "anonymous" || access.source === "subscription")
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

  const updateSettings = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const nextSettings = { ...settings, [key]: value };
    saveAppSettings(nextSettings);
    setSettings(nextSettings);
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

  const renderView = () => {
    switch (activeView) {
      case "dashboard":
        return (
          <DashboardView
            plan={plan}
            reminders={reminders}
            setActiveView={setActiveView}
            startEmptyPlan={startEmptyPlan}
            proAccess={hasFeatureAccess(accessState, "reviewHistory")}
          />
        );
      case "profile":
        return <ProfileView plan={plan} updateProfile={updateProfile} setActiveView={setActiveView} />;
      case "household":
        return (
          <HouseholdView
            plan={plan}
            updateHousehold={updateHousehold}
            addCashflowPeriod={addCashflowPeriod}
            updateCashflowPeriod={updateCashflowPeriod}
            removeCashflowPeriod={removeCashflowPeriod}
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
            updateScenarioHousehold={updateScenarioHousehold}
            updateScenarioAssets={updateScenarioAssets}
            updateScenarioSimulation={updateScenarioSimulation}
            adoptScenario={adoptScenario}
            removeScenario={removeScenario}
          />
        );
      case "diagnosis":
        return <LifePlanDiagnosisView plan={plan} setActiveView={setActiveView} addScenario={addScenario} />;
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
            applyBudgetActualsToReviewRecord={applyBudgetActualsToReviewRecord}
            addScenarioFromReview={addScenarioFromReview}
            saveCurrentPlanRevision={saveCurrentPlanRevision}
            restorePlanRevision={restorePlanRevision}
            removePlanRevision={removePlanRevision}
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
            applyBudgetActualsToReviewRecord={applyBudgetActualsToReviewRecord}
            addScenarioFromReview={addScenarioFromReview}
            saveCurrentPlanRevision={saveCurrentPlanRevision}
            restorePlanRevision={restorePlanRevision}
            removePlanRevision={removePlanRevision}
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
