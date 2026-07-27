import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  canOpenView,
  defaultAccessState,
  getPlanScopedAccessState,
  hasFeatureAccess,
  type AccessState
} from "./features";
import { useHouseholdAutoSync, type HouseholdSyncStatus } from "./hooks/useHouseholdAutoSync";
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
import { DashboardView } from "./views/DashboardView";
import type { ViewKey } from "./types";
import {
  getAppReminders,
  loadAppSettings,
  resolveTheme,
  saveAppSettings,
  type AppSettings
} from "./utils/settings";
import { exportPlan } from "./utils/storage";

const ProfileView = lazy(() =>
  import("./views/ProfileView").then((module) => ({ default: module.ProfileView }))
);
const AssetsView = lazy(() =>
  import("./views/AssetsView").then((module) => ({ default: module.AssetsView }))
);
const BudgetView = lazy(() =>
  import("./views/BudgetView").then((module) => ({ default: module.BudgetView }))
);
const DataPage = lazy(() =>
  import("./views/DataView").then((module) => ({ default: module.DataView }))
);
const EventSettingsView = lazy(() =>
  import("./views/EventSettingsView").then((module) => ({ default: module.EventSettingsView }))
);
const GoalsView = lazy(() =>
  import("./views/GoalsView").then((module) => ({ default: module.GoalsView }))
);
const HouseholdView = lazy(() =>
  import("./views/HouseholdView").then((module) => ({ default: module.HouseholdView }))
);
const LegalDocumentView = lazy(() =>
  import("./views/LegalView").then((module) => ({ default: module.LegalDocumentView }))
);
const LegalIndexView = lazy(() =>
  import("./views/LegalView").then((module) => ({ default: module.LegalIndexView }))
);
const LifePlanDiagnosisView = lazy(() =>
  import("./views/LifePlanDiagnosisView").then((module) => ({ default: module.LifePlanDiagnosisView }))
);
const NotesView = lazy(() =>
  import("./views/NotesView").then((module) => ({ default: module.NotesView }))
);
const PricingPage = lazy(() =>
  import("./views/PricingView").then((module) => ({ default: module.PricingView }))
);
const RetirementPlanView = lazy(() =>
  import("./views/RetirementPlanView").then((module) => ({ default: module.RetirementPlanView }))
);
const ScenarioComparisonView = lazy(() =>
  import("./views/ScenarioComparisonView").then((module) => ({ default: module.ScenarioComparisonView }))
);
const SettingsView = lazy(() =>
  import("./views/SettingsView").then((module) => ({ default: module.SettingsView }))
);
const SimulationView = lazy(() =>
  import("./views/SimulationView").then((module) => ({ default: module.SimulationView }))
);
const TimelineView = lazy(() =>
  import("./views/TimelineView").then((module) => ({ default: module.TimelineView }))
);

const householdSyncLabels: Record<HouseholdSyncStatus, string> = {
  checking: "共有を確認中",
  disabled: "共有なし",
  locked: "共有設定が必要",
  pending: "共有へ保存待ち",
  syncing: "共有へ同期中",
  synced: "同期済み",
  offline: "オフライン",
  conflict: "共有を要確認",
  error: "共有エラー"
};

function App() {
  const {
    plan,
    commitPlan,
    importMessage,
    setImportMessage,
    storageError,
    updateProfile,
    addHouseholdMember,
    updateHouseholdMember,
    removeHouseholdMember,
    updateHousehold,
    enableDetailedCashflow,
    useBasicCashflow,
    addDetailedCashflowItem,
    updateDetailedCashflowItem,
    removeDetailedCashflowItem,
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
    addScenarioCashflowPeriod,
    updateScenarioCashflowPeriod,
    removeScenarioCashflowPeriod,
    addScenarioDetailedCashflowItem,
    updateScenarioDetailedCashflowItem,
    removeScenarioDetailedCashflowItem,
    addScenarioGoal,
    updateScenarioGoal,
    removeScenarioGoal,
    addScenarioEvent,
    updateScenarioEvent,
    updateScenarioEventSchedule,
    removeScenarioEvent,
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
    updateGoal,
    removeGoal,
    addEvent,
    updateEvent,
    updateEventSchedule,
    removeEvent,
    resetPlan,
    startEmptyPlan
  } = useLifePlanEditor();
  const [activeView, setActiveViewState] = useState<ViewKey>(() =>
    /^#\/household-invite\/[A-Za-z0-9_-]{40,128}$/u.test(window.location.hash)
      ? "settings"
      : getViewForPath(window.location.pathname)
  );
  const [reviewPlanYear, setReviewPlanYear] = useState<number | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accessState, setAccessState] = useState<AccessState>(() => defaultAccessState);
  const [accountVersion, setAccountVersion] = useState(0);
  const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings());
  const [notificationMessage, setNotificationMessage] = useState("");
  const reminders = useMemo(() => getAppReminders(plan, settings), [plan, settings]);
  const householdSync = useHouseholdAutoSync({ plan, commitPlan, accountVersion });
  const planAccessState = useMemo(
    () => getPlanScopedAccessState(accessState, {
      enabled: householdSync.enabled,
      householdId: householdSync.householdId
    }),
    [accessState, householdSync.enabled, householdSync.householdId]
  );

  const refreshAccessState = useCallback(async () => {
    try {
      const response = await fetch("/api/entitlement", { credentials: "same-origin" });
      if (!response.ok) return;
      const body = await response.json() as { access?: unknown };
      if (!body.access || typeof body.access !== "object") return;
      const access = body.access as Record<string, unknown>;
      if (
        (access.tier === "free" || access.tier === "pro") &&
        (access.mode === "preview" || access.mode === "enforced") &&
        (access.source === "local-preview" || access.source === "operator" || access.source === "anonymous" || access.source === "subscription")
      ) {
        const household = access.household && typeof access.household === "object"
          ? access.household as Record<string, unknown>
          : null;
        const householdTier = household?.effectiveTier;
        const householdAccess: AccessState["household"] = household
          && typeof household.householdId === "string"
          && (householdTier === "free" || householdTier === "pro")
          && typeof household.writeAllowed === "boolean"
          ? {
              householdId: household.householdId,
              effectiveTier: householdTier,
              writeAllowed: household.writeAllowed
            }
          : null;
        setAccessState({
          tier: access.tier,
          mode: access.mode,
          source: access.source,
          household: householdAccess
        });
      }
    } catch {
      // Static development mode keeps the local preview state when the Worker API is unavailable.
    }
  }, []);

  useEffect(() => {
    void refreshAccessState();
  }, [refreshAccessState]);

  const handleAccountChange = useCallback(async () => {
    setAccountVersion((value) => value + 1);
    await refreshAccessState();
  }, [refreshAccessState]);

  const setActiveView = (view: ViewKey) => {
    const nextView = canOpenView(planAccessState, view) ? view : "pricing";
    if (nextView !== "scenarios") setReviewPlanYear(null);
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
      setActiveViewState(canOpenView(planAccessState, requestedView) ? requestedView : "pricing");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [planAccessState]);

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
            proAccess={hasFeatureAccess(planAccessState, "reviewHistory")}
          />
        );
      case "profile":
        return (
          <ProfileView
            plan={plan}
            updateProfile={updateProfile}
            addHouseholdMember={addHouseholdMember}
            updateHouseholdMember={updateHouseholdMember}
            removeHouseholdMember={removeHouseholdMember}
            setActiveView={setActiveView}
          />
        );
      case "household":
        return (
          <HouseholdView
            plan={plan}
            updateHousehold={updateHousehold}
            enableDetailedCashflow={enableDetailedCashflow}
            useBasicCashflow={useBasicCashflow}
            addDetailedCashflowItem={addDetailedCashflowItem}
            updateDetailedCashflowItem={updateDetailedCashflowItem}
            removeDetailedCashflowItem={removeDetailedCashflowItem}
            addCashflowPeriod={addCashflowPeriod}
            updateCashflowPeriod={updateCashflowPeriod}
            removeCashflowPeriod={removeCashflowPeriod}
            addFixedCostItem={addFixedCostItem}
            updateFixedCostItem={updateFixedCostItem}
            removeFixedCostItem={removeFixedCostItem}
            setActiveView={setActiveView}
            accessState={planAccessState}
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
            openReviewPlan={(year) => {
              setReviewPlanYear(year);
              setActiveView("scenarios");
            }}
            accessState={planAccessState}
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
            addScenarioCashflowPeriod={addScenarioCashflowPeriod}
            updateScenarioCashflowPeriod={updateScenarioCashflowPeriod}
            removeScenarioCashflowPeriod={removeScenarioCashflowPeriod}
            addScenarioDetailedCashflowItem={addScenarioDetailedCashflowItem}
            updateScenarioDetailedCashflowItem={updateScenarioDetailedCashflowItem}
            removeScenarioDetailedCashflowItem={removeScenarioDetailedCashflowItem}
            addScenarioGoal={addScenarioGoal}
            updateScenarioGoal={updateScenarioGoal}
            removeScenarioGoal={removeScenarioGoal}
            addScenarioEvent={addScenarioEvent}
            updateScenarioEvent={updateScenarioEvent}
            updateScenarioEventSchedule={updateScenarioEventSchedule}
            removeScenarioEvent={removeScenarioEvent}
            adoptScenario={adoptScenario}
            removeScenario={removeScenario}
            initialReviewYear={reviewPlanYear}
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
            accountVersion={accountVersion}
            onAccountChange={handleAccountChange}
            householdSync={householdSync}
            plan={plan}
            commitPlan={commitPlan}
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
            <small>入力、見直し、バックアップ</small>
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
            {householdSync.enabled && (
              <button
                type="button"
                className={`secondary household-sync-button ${householdSync.status}`}
                onClick={() => setActiveView("settings")}
                title={
                  householdSync.lastSyncedAt
                    ? `最終同期: ${new Date(householdSync.lastSyncedAt).toLocaleString("ja-JP")}`
                    : householdSync.message || "共同世帯の同期状態"
                }
              >
                {householdSyncLabels[householdSync.status]}
              </button>
            )}
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
              バックアップ・復元を開く
            </button>
          </section>
        )}
        <Suspense fallback={<section className="panel" aria-live="polite">画面を読み込んでいます。</section>}>
          {renderView()}
        </Suspense>
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
