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

function PasswordInput({
  label,
  value,
  onChange,
  helper,
  autoComplete,
  disabled = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  helper: string;
  autoComplete: string;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <label>
      {label}
      <div className="password-input-row">
        <input
          type={visible ? "text" : "password"}
          aria-label={label}
          autoComplete={autoComplete}
          value={value}
          minLength={12}
          maxLength={200}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="secondary password-visibility-button"
          disabled={disabled}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >{visible ? "隠す" : "表示"}</button>
      </div>
      <small>{helper}</small>
    </label>
  );
}

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
  const [savePassword, setSavePassword] = useState("");
  const [saveConfirmation, setSaveConfirmation] = useState("");
  const [restoreTarget, setRestoreTarget] = useState<CloudBackupSummary | null>(null);
  const [restorePassword, setRestorePassword] = useState("");
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
      const nextBackups = Array.isArray(body.backups) ? body.backups : [];
      setBackups(nextBackups);
      setRestoreTarget((current) => current && nextBackups.some((backup) => backup.id === current.id) ? current : null);
      setLimit(typeof body.limit === "number" ? body.limit : 5);
      setState("available");
    } catch (error) {
      setState("unavailable");
      setMessage(error instanceof Error ? error.message : "クラウドバックアップの状態を確認できませんでした。");
    }
  }, []);

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  const saveBackup = async () => {
    if (!hasProAccess) {
      setMessage("新しいクラウドバックアップの保存にはPro契約が必要です。");
      return;
    }
    if (savePassword.length < 12) {
      setMessage("保存用の復旧パスワードは12文字以上で入力してください。");
      return;
    }
    if (savePassword !== saveConfirmation) {
      setMessage("復旧パスワードと確認入力が一致していません。");
      return;
    }
    if (!window.confirm(
      "現在のプランを暗号化してクラウドへ保存します。\n\n復旧パスワードを忘れると復元できません。安全な場所へ保管したことを確認してから保存してください。"
    )) return;
    setBusy(true);
    setMessage("ブラウザ内で暗号化しています。画面を閉じずにお待ちください。");
    try {
      const envelope = await encryptCloudBackup(plan, savePassword);
      const response = await fetch("/api/backups", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planVersion: plan.version, envelope })
      });
      if (!response.ok) throw new Error(await apiError(response, "クラウドバックアップを保存できませんでした。"));
      setSavePassword("");
      setSaveConfirmation("");
      setMessage("暗号化クラウドバックアップを保存しました。復旧パスワードは運営側では確認できません。");
      await loadBackups();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "クラウドバックアップを保存できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const restoreBackup = async (backup: CloudBackupSummary) => {
    if (restorePassword.length < 12) {
      setMessage("選択したバックアップの保存時に設定した復旧パスワードを入力してください。");
      return;
    }
    if (!window.confirm(`${new Date(backup.createdAt).toLocaleString("ja-JP")}のバックアップを復号して現在のプランへ反映しますか？`)) return;
    setBusy(true);
    setMessage("バックアップを取得し、ブラウザ内で復号しています。");
    try {
      const response = await fetch(`/api/backups/${backup.id}`, { credentials: "same-origin" });
      if (!response.ok) throw new Error(await apiError(response, "クラウドバックアップを取得できませんでした。"));
      const body = await response.json() as { envelope?: unknown };
      const restored = await decryptCloudBackup(body.envelope, restorePassword);
      restorePlan(restored);
      setRestorePassword("");
      setRestoreTarget(null);
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
          {hasProAccess ? (
            <>
              <div className="cloud-action-heading">
                <h3>新しいバックアップを保存</h3>
                <p>現在のプランを、ここで設定する復旧パスワードで暗号化して保存します。</p>
              </div>
              <div className="cloud-password-grid">
                <PasswordInput
                  label="保存用の復旧パスワード"
                  value={savePassword}
                  onChange={setSavePassword}
                  helper="12文字以上で入力してください。"
                  autoComplete="new-password"
                />
                <PasswordInput
                  label="保存用の復旧パスワード（確認）"
                  value={saveConfirmation}
                  onChange={setSaveConfirmation}
                  helper="同じ復旧パスワードを入力してください。"
                  autoComplete="new-password"
                />
              </div>
              <div className="cloud-password-warning" role="note">
                <strong>復旧パスワードを忘れると、運営者でも復元できません。</strong>
                <span>パスワード管理アプリや安全なメモへ必ず記録してください。</span>
              </div>
              <div className="button-row">
                <button type="button" disabled={busy || backups.length >= limit} onClick={saveBackup}>内容を確認して保存</button>
                <button type="button" className="secondary" disabled={busy} onClick={() => void loadBackups()}>一覧を更新</button>
              </div>
            </>
          ) : (
            <div className="notice-band">
              <strong>新しいクラウドバックアップの保存はPro版</strong>
              <span>契約終了後も、保存済みバックアップの復元と削除は本人がログインして行えます。</span>
            </div>
          )}

          <div className="cloud-action-heading cloud-list-heading">
            <h3>保存済みバックアップ</h3>
            <p>保存日時と容量を確認できます。復元するときは、この下の専用欄を使用します。</p>
          </div>
          {backups.length === 0 ? (
            <p className="muted">クラウドバックアップはまだありません。</p>
          ) : (
            <>
              <div className="recovery-list cloud-backup-list">
                {backups.map((backup) => (
                  <div className="recovery-item" key={backup.id}>
                    <div>
                      <strong>{new Date(backup.createdAt).toLocaleString("ja-JP")}</strong>
                      <span>v{backup.planVersion}・約{Math.max(1, Math.ceil(backup.sizeBytes / 1024))}KB・暗号化済み</span>
                    </div>
                    <button type="button" className="text-button danger-text" disabled={busy} onClick={() => void deleteBackup(backup)}>削除</button>
                  </div>
                ))}
              </div>

              <div className="cloud-restore-controls">
                <div>
                  <h3>バックアップを復元</h3>
                  <p>復元するバックアップを選択し、保存したときの復旧パスワードを入力してから実行します。</p>
                </div>
                <label>
                  復元するバックアップ
                  <select
                    value={restoreTarget?.id || ""}
                    onChange={(event) => {
                      setRestoreTarget(backups.find((backup) => backup.id === event.target.value) || null);
                      setRestorePassword("");
                    }}
                  >
                    <option value="">選択してください</option>
                    {backups.map((backup) => (
                      <option value={backup.id} key={backup.id}>
                        {new Date(backup.createdAt).toLocaleString("ja-JP")}・約{Math.max(1, Math.ceil(backup.sizeBytes / 1024))}KB
                      </option>
                    ))}
                  </select>
                </label>
                <PasswordInput
                  label="保存時の復旧パスワード"
                  value={restorePassword}
                  onChange={setRestorePassword}
                  helper="新しいパスワードを設定する欄ではありません。選択したバックアップを保存したときのパスワードを入力してください。"
                  autoComplete="off"
                  disabled={!restoreTarget}
                />
                <div className="button-row">
                  <button type="button" disabled={busy || !restoreTarget} onClick={() => restoreTarget && void restoreBackup(restoreTarget)}>復元内容を確認</button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || (!restoreTarget && !restorePassword)}
                    onClick={() => {
                      setRestoreTarget(null);
                      setRestorePassword("");
                    }}
                  >入力をクリア</button>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {message && <p className="inline-message" role="status">{message}</p>}
      <p className="muted cloud-backup-footnote">暗号化と復号はこのブラウザ内で行い、復旧パスワードをLife Compassへ送信しません。</p>
    </section>
  );
}
