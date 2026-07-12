import { useCallback, useEffect, useState } from "react";
import type { AccessState } from "../features";
import { hasFeatureAccess } from "../features";
import type { LifePlan } from "../types";
import { decryptCloudBackup, encryptCloudBackup } from "../utils/cloudBackupCrypto";

type CloudBackupSummary = {
  id: string;
  planVersion: number;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
};

type CloudState = "loading" | "unavailable" | "login-required" | "restricted" | "available";

const apiError = async (response: Response, fallback: string) => {
  try {
    const body = await response.json() as { error?: { code?: string } };
    const messages: Record<string, string> = {
      authentication_required: "Googleログインが必要です。",
      backup_preview_not_allowed: "現在は限定テストの対象外です。",
      pro_required: "この機能を利用するにはPro契約が必要です。",
      backup_limit_reached: "保存上限に達しています。既存のバックアップを削除してから保存してください。",
      backup_too_large: "暗号化バックアップが保存上限を超えています。",
      invalid_backup_envelope: "暗号化バックアップの形式を確認できませんでした。",
      backup_integrity_failed: "バックアップの整合性を確認できないため復元を中止しました。",
      backup_not_found: "指定したバックアップが見つかりません。",
      backup_object_not_found: "バックアップ本体が見つかりません。"
    };
    return (body.error?.code && messages[body.error.code]) || fallback;
  } catch {
    return fallback;
  }
};

export function CloudBackupPanel({
  plan,
  accessState,
  restorePlan
}: {
  plan: LifePlan;
  accessState: AccessState;
  restorePlan: (plan: LifePlan) => void;
}) {
  const [state, setState] = useState<CloudState>("loading");
  const [backups, setBackups] = useState<CloudBackupSummary[]>([]);
  const [limit, setLimit] = useState(5);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const hasProAccess = hasFeatureAccess(accessState, "encryptedCloudBackup");

  const loadBackups = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch("/api/backups", { credentials: "same-origin" });
      if (response.status === 401) {
        setState("login-required");
        return;
      }
      if (response.status === 403) {
        setState("restricted");
        return;
      }
      if (!response.ok) throw new Error(await apiError(response, "クラウドバックアップの状態を確認できませんでした。"));
      if (!(response.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) {
        setState("unavailable");
        setBackups([]);
        return;
      }
      const body = await response.json() as { available?: boolean; backups?: CloudBackupSummary[]; limit?: number };
      if (!body.available) {
        setState("unavailable");
        setBackups([]);
        return;
      }
      setBackups(Array.isArray(body.backups) ? body.backups : []);
      setLimit(typeof body.limit === "number" ? body.limit : 5);
      setState("available");
    } catch (error) {
      setState("unavailable");
      setMessage(error instanceof Error ? error.message : "クラウドバックアップの状態を確認できませんでした。");
    }
  }, []);

  useEffect(() => {
    if (!hasProAccess) {
      setState("restricted");
      return;
    }
    void loadBackups();
  }, [hasProAccess, loadBackups]);

  const saveBackup = async () => {
    if (password !== confirmation) {
      setMessage("復旧パスワードと確認入力が一致していません。");
      return;
    }
    setBusy(true);
    setMessage("ブラウザ内で暗号化しています。画面を閉じずにお待ちください。");
    try {
      const envelope = await encryptCloudBackup(plan, password);
      const response = await fetch("/api/backups", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planVersion: plan.version, envelope })
      });
      if (!response.ok) throw new Error(await apiError(response, "クラウドバックアップを保存できませんでした。"));
      setPassword("");
      setConfirmation("");
      setMessage("暗号化クラウドバックアップを保存しました。復旧パスワードは運営側では確認できません。");
      await loadBackups();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "クラウドバックアップを保存できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const restoreBackup = async (backup: CloudBackupSummary) => {
    if (!password) {
      setMessage("保存時に設定した復旧パスワードを入力してください。");
      return;
    }
    if (!window.confirm(`${new Date(backup.createdAt).toLocaleString("ja-JP")}のバックアップを復号して現在のプランへ反映しますか？`)) return;
    setBusy(true);
    setMessage("バックアップを取得し、ブラウザ内で復号しています。");
    try {
      const response = await fetch(`/api/backups/${backup.id}`, { credentials: "same-origin" });
      if (!response.ok) throw new Error(await apiError(response, "クラウドバックアップを取得できませんでした。"));
      const body = await response.json() as { envelope?: unknown };
      const restored = await decryptCloudBackup(body.envelope, password);
      restorePlan(restored);
      setPassword("");
      setConfirmation("");
      setMessage("暗号化クラウドバックアップから復元しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "クラウドバックアップから復元できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const deleteBackup = async (backup: CloudBackupSummary) => {
    if (!window.confirm(`${new Date(backup.createdAt).toLocaleString("ja-JP")}のクラウドバックアップを削除しますか？`)) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/backups/${backup.id}`, {
        method: "DELETE",
        credentials: "same-origin"
      });
      if (!response.ok) throw new Error(await apiError(response, "クラウドバックアップを削除できませんでした。"));
      setMessage("暗号化クラウドバックアップを削除しました。");
      await loadBackups();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "クラウドバックアップを削除できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel cloud-backup-panel" data-testid="cloud-backup-panel">
      <div className="section-heading-row">
        <div>
          <h2>暗号化クラウドバックアップ <span className="pro-inline-badge">Pro</span></h2>
          <p>必要なときだけ手動で保存・復元します。Google Driveへの保存や自動同期は行いません。</p>
        </div>
        <span className={`status-chip${state === "available" ? " complete" : ""}`}>
          {state === "loading" ? "確認中" : state === "available" ? `${backups.length}/${limit}件` : "準備中"}
        </span>
      </div>

      {state === "unavailable" && (
        <div className="notice-band"><strong>現在は準備中です</strong><span>R2接続と安全確認が完了するまで、JSONバックアップを利用してください。</span></div>
      )}
      {state === "login-required" && (
        <div className="notice-band"><strong>Googleログインが必要です</strong><span>設定画面でログインしてから、もう一度この画面を開いてください。</span></div>
      )}
      {state === "restricted" && (
        <div className="notice-band"><strong>現在の利用対象外です</strong><span>テスト期間中は指定された利用者だけが確認できます。</span></div>
      )}

      {state === "available" && (
        <>
          <div className="cloud-password-grid">
            <label>
              復旧パスワード
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                minLength={12}
                maxLength={200}
                onChange={(event) => setPassword(event.target.value)}
              />
              <small>12文字以上。保存されず、忘れると運営者でも復元できません。</small>
            </label>
            <label>
              復旧パスワード（確認）
              <input
                type="password"
                autoComplete="new-password"
                value={confirmation}
                minLength={12}
                maxLength={200}
                onChange={(event) => setConfirmation(event.target.value)}
              />
              <small>新しく保存するときだけ確認入力が必要です。</small>
            </label>
          </div>
          <div className="button-row">
            <button type="button" disabled={busy || backups.length >= limit} onClick={saveBackup}>暗号化して保存</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => void loadBackups()}>一覧を更新</button>
          </div>

          {backups.length === 0 ? (
            <p className="muted">クラウドバックアップはまだありません。</p>
          ) : (
            <div className="recovery-list cloud-backup-list">
              {backups.map((backup) => (
                <div className="recovery-item" key={backup.id}>
                  <div>
                    <strong>{new Date(backup.createdAt).toLocaleString("ja-JP")}</strong>
                    <span>v{backup.planVersion}・約{Math.max(1, Math.ceil(backup.sizeBytes / 1024))}KB・暗号化済み</span>
                  </div>
                  <div className="button-row">
                    <button type="button" className="secondary" disabled={busy} onClick={() => void restoreBackup(backup)}>復元</button>
                    <button type="button" className="text-button danger-text" disabled={busy} onClick={() => void deleteBackup(backup)}>削除</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {message && <p className="inline-message" role="status">{message}</p>}
      <p className="muted cloud-backup-footnote">暗号化と復号はこのブラウザ内で行い、復旧パスワードをLife Compassへ送信しません。</p>
    </section>
  );
}
