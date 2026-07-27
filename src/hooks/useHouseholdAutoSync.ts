import { useCallback, useEffect, useRef, useState } from "react";
import { CURRENT_PLAN_VERSION } from "../config";
import type { LifePlan } from "../types";
import {
  getCurrentSharedPlan,
  getHouseholdOverview,
  HouseholdApiError,
  saveSharedPlan,
  type SharedHousehold,
  type SharedPlanResponse
} from "../utils/householdSharingApi";
import {
  forgetTrustedSharedPlanDevice,
  hasTrustedSharedPlanDevice,
  loadTrustedSharedPlanCredential,
  storeTrustedSharedPlanPassword,
  updateTrustedSharedPlanMetadata,
  type SharedPlanSyncMetadata,
  type TrustedSharedPlanCredential
} from "../utils/sharedPlanDeviceStore";
import { decryptSharedPlan, encryptSharedPlan } from "../utils/sharedPlanCrypto";
import { createRecoveryBackup, validateImportedPlan } from "../utils/storage";

export type HouseholdSyncStatus =
  | "checking"
  | "disabled"
  | "locked"
  | "pending"
  | "syncing"
  | "synced"
  | "offline"
  | "conflict"
  | "error";

export type HouseholdSyncController = {
  enabled: boolean;
  householdId: string | null;
  status: HouseholdSyncStatus;
  message: string;
  lastSyncedAt: string | null;
  enableAutoSync: (password: string) => Promise<void>;
  disableAutoSync: () => Promise<void>;
  syncNow: () => Promise<void>;
  useRemoteVersion: () => Promise<void>;
  keepLocalVersion: () => Promise<void>;
  refresh: () => Promise<void>;
};

type Runtime = {
  household: SharedHousehold;
  credential: TrustedSharedPlanCredential;
};

const SYNC_DELAY_MS = 20_000;
const POLL_INTERVAL_MS = 60_000;

const responseContext = (response: SharedPlanResponse) => {
  if (!response.revision || !response.envelope) throw new Error("共有プランはまだ保存されていません。");
  return {
    householdId: response.householdId,
    revision: response.revision.revision,
    keyEpoch: response.revision.keyEpoch
  };
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
};

const digestPlan = async (plan: LifePlan) => {
  const normalizedPlan = validateImportedPlan(plan);
  const normalized = JSON.stringify(canonicalize({ ...normalizedPlan, updatedAt: "" }));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
};

const isOfflineError = (error: unknown) =>
  !navigator.onLine || error instanceof TypeError;

const waitForIdleOperation = async (operationRef: { current: boolean }) => {
  const deadline = Date.now() + 10_000;
  while (operationRef.current && Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  if (operationRef.current) throw new Error("同期状態の確認が終わるまで少しお待ちください。");
};

export function useHouseholdAutoSync({
  plan,
  commitPlan,
  accountVersion
}: {
  plan: LifePlan;
  commitPlan: (nextPlan: LifePlan) => boolean;
  accountVersion: number;
}): HouseholdSyncController {
  const planRef = useRef(plan);
  const runtimeRef = useRef<Runtime | null>(null);
  const operationRef = useRef(false);
  const [enabled, setEnabled] = useState(false);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [status, setStatus] = useState<HouseholdSyncStatus>("checking");
  const [message, setMessage] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  useEffect(() => {
    planRef.current = plan;
  }, [plan]);

  const saveMetadata = useCallback(async (
    runtime: Runtime,
    metadata: SharedPlanSyncMetadata
  ) => {
    runtime.credential = { ...runtime.credential, ...metadata };
    runtimeRef.current = runtime;
    setLastSyncedAt(metadata.lastSyncedAt);
    await updateTrustedSharedPlanMetadata(runtime.credential, metadata);
  }, []);

  const applyRemotePlan = useCallback(async (
    runtime: Runtime,
    response: SharedPlanResponse,
    preserveLocal: boolean
  ) => {
    const context = responseContext(response);
    const remotePlan = await decryptSharedPlan(response.envelope, runtime.credential.password, context);
    const remoteDigest = await digestPlan(remotePlan);
    if (preserveLocal) createRecoveryBackup(planRef.current, "before-import");
    if (!commitPlan(remotePlan)) throw new Error("共有プランをこのブラウザへ保存できませんでした。");
    const syncedAt = new Date().toISOString();
    await saveMetadata(runtime, {
      lastRevision: context.revision,
      lastPlanDigest: remoteDigest,
      lastSyncedAt: syncedAt
    });
    runtime.household = { ...runtime.household, currentRevision: context.revision };
    setStatus("synced");
    setMessage("共同世帯の最新内容をこの端末へ反映しました。");
  }, [commitPlan, saveMetadata]);

  const reconcile = useCallback(async (runtime: Runtime, overviewHousehold?: SharedHousehold) => {
    const household = overviewHousehold || runtime.household;
    runtime.household = household;
    if (household.keyEpoch !== runtime.credential.keyEpoch) {
      await forgetTrustedSharedPlanDevice(household.id);
      runtimeRef.current = null;
      setEnabled(false);
      setStatus("locked");
      setMessage("共有パスワードが更新されています。この端末でもう一度設定してください。");
      return;
    }
    if (household.currentRevision < runtime.credential.lastRevision) {
      setStatus("conflict");
      setMessage("共有履歴の状態が一致しません。手動で内容を確認してください。");
      return;
    }

    const localDigest = await digestPlan(planRef.current);
    if (household.currentRevision > runtime.credential.lastRevision) {
      if (
        runtime.credential.lastPlanDigest
        && localDigest !== runtime.credential.lastPlanDigest
      ) {
        setStatus("conflict");
        setMessage("この端末と共同利用者の両方に未反映の変更があります。残す内容を選んでください。");
        return;
      }
      await applyRemotePlan(runtime, await getCurrentSharedPlan(), false);
      return;
    }

    if (runtime.credential.lastPlanDigest === localDigest) {
      setStatus("synced");
      setMessage("");
    } else {
      setStatus("pending");
      setMessage("この端末の変更を共有へ保存します。");
    }
  }, [applyRemotePlan]);

  const initialize = useCallback(async () => {
    if (operationRef.current) return;
    operationRef.current = true;
    if (!runtimeRef.current) setStatus("checking");
    try {
      const overview = await getHouseholdOverview();
      const household = overview.household;
      setHouseholdId(household?.id || null);
      if (!household) {
        runtimeRef.current = null;
        setEnabled(false);
        setStatus("disabled");
        setMessage("");
        return;
      }
      if (!hasTrustedSharedPlanDevice(household.id)) {
        runtimeRef.current = null;
        setEnabled(false);
        setStatus("locked");
        setLastSyncedAt(null);
        setMessage("この端末の自動同期はまだ有効になっていません。");
        return;
      }
      const credential = await loadTrustedSharedPlanCredential(household.id, household.keyEpoch);
      if (!credential) {
        runtimeRef.current = null;
        setEnabled(false);
        setStatus("locked");
        setLastSyncedAt(null);
        setMessage("この端末の自動同期はまだ有効になっていません。");
        return;
      }
      const runtime = { household, credential };
      runtimeRef.current = runtime;
      setEnabled(true);
      setLastSyncedAt(credential.lastSyncedAt);
      await reconcile(runtime, household);
    } catch (error) {
      if (
        error instanceof HouseholdApiError
        && error.code === "household_access_denied"
        && runtimeRef.current
      ) {
        await forgetTrustedSharedPlanDevice(runtimeRef.current.household.id);
        runtimeRef.current = null;
        setEnabled(false);
        setStatus("locked");
        setMessage("共同世帯への参加が解除されたため、この端末の共有設定を削除しました。");
        return;
      }
      if (
        error instanceof HouseholdApiError
        && (
          error.code === "authentication_required"
          || error.code === "household_preview_not_allowed"
          || error.code === "household_sharing_disabled"
        )
      ) {
        runtimeRef.current = null;
        setEnabled(false);
        setStatus("disabled");
        setMessage("");
      } else if (isOfflineError(error)) {
        setEnabled(Boolean(runtimeRef.current));
        setStatus("offline");
        setMessage("オフラインです。ブラウザ内には保存され、接続後に同期します。");
      } else {
        setEnabled(Boolean(runtimeRef.current));
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "共同世帯の同期状態を確認できませんでした。");
      }
    } finally {
      operationRef.current = false;
    }
  }, [reconcile]);

  const syncNow = useCallback(async () => {
    const runtime = runtimeRef.current;
    if (!runtime || operationRef.current) return;
    operationRef.current = true;
    setStatus("syncing");
    setMessage("共同世帯へ暗号化して保存しています。");
    try {
      const overview = await getHouseholdOverview();
      const household = overview.household;
      if (!household || household.id !== runtime.household.id) {
        throw new Error("共同世帯へのアクセスを確認できません。");
      }
      runtime.household = household;
      if (household.currentRevision !== runtime.credential.lastRevision) {
        await reconcile(runtime, household);
        return;
      }
      const localPlan = planRef.current;
      const localDigest = await digestPlan(localPlan);
      if (localDigest === runtime.credential.lastPlanDigest) {
        setStatus("synced");
        setMessage("");
        return;
      }
      if (!household.writeAllowed) {
        setStatus("locked");
        setMessage("現在は共有への保存が停止されています。契約状態または共有鍵を確認してください。");
        return;
      }
      const revision = household.currentRevision + 1;
      const envelope = await encryptSharedPlan(localPlan, runtime.credential.password, {
        householdId: household.id,
        revision,
        keyEpoch: household.keyEpoch
      });
      await saveSharedPlan(household.currentRevision, CURRENT_PLAN_VERSION, envelope);
      const syncedAt = new Date().toISOString();
      await saveMetadata(runtime, {
        lastRevision: revision,
        lastPlanDigest: localDigest,
        lastSyncedAt: syncedAt
      });
      runtime.household = { ...household, currentRevision: revision };
      setStatus("synced");
      setMessage("この端末の変更を共同世帯へ保存しました。");
    } catch (error) {
      if (error instanceof HouseholdApiError && error.code === "shared_plan_conflict") {
        setStatus("conflict");
        setMessage("共同利用者が先に更新しました。残す内容を選んでください。");
      } else if (isOfflineError(error)) {
        setStatus("offline");
        setMessage("オフラインです。ブラウザ内には保存され、接続後に同期します。");
      } else {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "共同世帯へ保存できませんでした。");
      }
    } finally {
      operationRef.current = false;
    }
  }, [reconcile, saveMetadata]);

  const enableAutoSync = useCallback(async (password: string) => {
    await waitForIdleOperation(operationRef);
    operationRef.current = true;
    setStatus("checking");
    setMessage("共有パスワードと最新内容を確認しています。");
    let storedHouseholdId: string | null = null;
    try {
      const overview = await getHouseholdOverview();
      const household = overview.household;
      if (!household) throw new Error("共同世帯を確認できませんでした。");

      let remotePlan: LifePlan | null = null;
      let remoteDigest = "";
      if (household.currentRevision > 0) {
        const response = await getCurrentSharedPlan();
        remotePlan = await decryptSharedPlan(response.envelope, password, responseContext(response));
        remoteDigest = await digestPlan(remotePlan);
      }
      const syncedAt = household.currentRevision > 0 ? new Date().toISOString() : null;
      await storeTrustedSharedPlanPassword(household.id, household.keyEpoch, password, {
        lastRevision: household.currentRevision,
        lastPlanDigest: remoteDigest,
        lastSyncedAt: syncedAt
      });
      storedHouseholdId = household.id;
      const credential = await loadTrustedSharedPlanCredential(household.id, household.keyEpoch);
      if (!credential) throw new Error("この端末の共有設定を保存できませんでした。");
      const runtime = { household, credential };
      runtimeRef.current = runtime;
      setHouseholdId(household.id);
      setEnabled(true);
      setLastSyncedAt(syncedAt);

      if (remotePlan) {
        createRecoveryBackup(planRef.current, "before-import");
        if (!commitPlan(remotePlan)) throw new Error("共有プランをこのブラウザへ保存できませんでした。");
        setStatus("synced");
        setMessage("この端末で自動同期を開始し、共同世帯の最新内容を反映しました。");
      } else {
        setStatus("pending");
        setMessage("この端末で自動同期を開始しました。現在のプランを共有へ保存します。");
      }
    } catch (error) {
      if (storedHouseholdId) await forgetTrustedSharedPlanDevice(storedHouseholdId);
      runtimeRef.current = null;
      setEnabled(false);
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "この端末の自動同期を開始できませんでした。");
      throw error;
    } finally {
      operationRef.current = false;
    }
    if (runtimeRef.current?.credential.lastRevision === 0) await syncNow();
  }, [commitPlan, syncNow]);

  const disableAutoSync = useCallback(async () => {
    const id = runtimeRef.current?.household.id || householdId;
    if (id) await forgetTrustedSharedPlanDevice(id);
    runtimeRef.current = null;
    setEnabled(false);
    setStatus("locked");
    setLastSyncedAt(null);
    setMessage("この端末の自動同期を解除しました。ブラウザ内のプランは残っています。");
  }, [householdId]);

  const useRemoteVersion = useCallback(async () => {
    const runtime = runtimeRef.current;
    if (!runtime || operationRef.current) return;
    operationRef.current = true;
    setStatus("syncing");
    try {
      await applyRemotePlan(runtime, await getCurrentSharedPlan(), true);
    } catch (error) {
      setStatus(isOfflineError(error) ? "offline" : "error");
      setMessage(error instanceof Error ? error.message : "共同世帯の内容を反映できませんでした。");
    } finally {
      operationRef.current = false;
    }
  }, [applyRemotePlan]);

  const keepLocalVersion = useCallback(async () => {
    const runtime = runtimeRef.current;
    if (!runtime || operationRef.current) return;
    operationRef.current = true;
    setStatus("syncing");
    try {
      const response = await getCurrentSharedPlan();
      const remotePlan = await decryptSharedPlan(
        response.envelope,
        runtime.credential.password,
        responseContext(response)
      );
      createRecoveryBackup(remotePlan, "before-import");
      const localPlan = planRef.current;
      const localDigest = await digestPlan(localPlan);
      const revision = response.currentRevision + 1;
      const envelope = await encryptSharedPlan(localPlan, runtime.credential.password, {
        householdId: runtime.household.id,
        revision,
        keyEpoch: runtime.household.keyEpoch
      });
      await saveSharedPlan(response.currentRevision, CURRENT_PLAN_VERSION, envelope);
      const syncedAt = new Date().toISOString();
      await saveMetadata(runtime, {
        lastRevision: revision,
        lastPlanDigest: localDigest,
        lastSyncedAt: syncedAt
      });
      runtime.household = { ...runtime.household, currentRevision: revision };
      setStatus("synced");
      setMessage("この端末の内容を新しい共有版として保存しました。共同世帯側の変更は復旧用コピーへ残しています。");
    } catch (error) {
      setStatus(isOfflineError(error) ? "offline" : "error");
      setMessage(error instanceof Error ? error.message : "この端末の内容を共有へ保存できませんでした。");
    } finally {
      operationRef.current = false;
    }
  }, [saveMetadata]);

  useEffect(() => {
    void initialize();
  }, [accountVersion, initialize]);

  useEffect(() => {
    if (!enabled || (status !== "synced" && status !== "pending")) return undefined;
    const timer = window.setTimeout(() => void syncNow(), SYNC_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, plan, status, syncNow]);

  useEffect(() => {
    if (!enabled) return undefined;
    const poll = () => {
      if (document.visibilityState === "visible") void initialize();
    };
    const interval = window.setInterval(poll, POLL_INTERVAL_MS);
    window.addEventListener("online", poll);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", poll);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [enabled, initialize]);

  return {
    enabled,
    householdId,
    status,
    message,
    lastSyncedAt,
    enableAutoSync,
    disableAutoSync,
    syncNow,
    useRemoteVersion,
    keepLocalVersion,
    refresh: initialize
  };
}
