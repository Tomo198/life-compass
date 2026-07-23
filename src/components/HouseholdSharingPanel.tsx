import { useCallback, useEffect, useMemo, useState } from "react";
import { CURRENT_PLAN_VERSION } from "../config";
import type { LifePlan } from "../types";
import {
  acceptHouseholdInvitation,
  createHouseholdInvitation,
  createSharedHousehold,
  deleteSharedHousehold,
  getCurrentSharedPlan,
  getHouseholdOverview,
  getSharedRevision,
  HouseholdApiError,
  leaveSharedHousehold,
  listSharedRevisions,
  removeHouseholdMember,
  revokeHouseholdInvitation,
  saveSharedPlan,
  type HouseholdOverview,
  type SharedPlanResponse,
  type SharedRevision
} from "../utils/householdSharingApi";
import { decryptSharedPlan, encryptSharedPlan } from "../utils/sharedPlanCrypto";
import { createRecoveryBackup } from "../utils/storage";

type HouseholdSharingPanelProps = {
  plan: LifePlan;
  commitPlan: (nextPlan: LifePlan) => boolean;
  accountVersion: number;
  refreshAccessState: () => Promise<void>;
};

const invitationToken = () => {
  const match = window.location.hash.match(/^#\/household-invite\/([A-Za-z0-9_-]{40,128})$/u);
  return match?.[1] || "";
};

const formatDateTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "日時不明"
    : new Intl.DateTimeFormat("ja-JP", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      }).format(date);
};

const PasswordField = ({
  label,
  value,
  onChange,
  visible,
  onToggle,
  autoComplete = "off"
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  autoComplete?: string;
}) => (
  <label>
    {label}
    <div className="password-input-row">
      <input
        type={visible ? "text" : "password"}
        value={value}
        minLength={12}
        maxLength={200}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
      />
      <button type="button" className="secondary password-visibility-button" onClick={onToggle}>
        {visible ? "隠す" : "表示"}
      </button>
    </div>
  </label>
);

const responseContext = (response: SharedPlanResponse) => {
  if (!response.revision || !response.envelope) throw new Error("共有プランはまだ保存されていません。");
  return {
    householdId: response.householdId,
    revision: response.revision.revision,
    keyEpoch: response.revision.keyEpoch
  };
};

export function HouseholdSharingPanel({
  plan,
  commitPlan,
  accountVersion,
  refreshAccessState
}: HouseholdSharingPanelProps) {
  const [display, setDisplay] = useState<"loading" | "hidden" | "visible">("loading");
  const [overview, setOverview] = useState<HouseholdOverview | null>(null);
  const [revisions, setRevisions] = useState<SharedRevision[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [createdInvite, setCreatedInvite] = useState<{ url: string; expiresAt: string } | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const token = useMemo(invitationToken, [accountVersion]);

  const loadOverview = useCallback(async () => {
    try {
      const nextOverview = await getHouseholdOverview();
      setOverview(nextOverview);
      setDisplay("visible");
      if (nextOverview.household?.readAllowed && nextOverview.household.currentRevision > 0) {
        const revisionResponse = await listSharedRevisions();
        setRevisions(revisionResponse.revisions);
      } else {
        setRevisions([]);
      }
    } catch (error) {
      if (
        error instanceof HouseholdApiError
        && (
          error.code === "household_sharing_disabled"
          || (error.code === "household_preview_not_allowed" && !token)
          || (error.code === "authentication_required" && !token)
        )
      ) {
        setDisplay("hidden");
        setOverview(null);
        setRevisions([]);
        return;
      }
      setDisplay(token ? "visible" : "hidden");
      setOverview(null);
      setRevisions([]);
      if (token) setMessage(error instanceof Error ? error.message : "招待を確認できませんでした。");
    }
  }, [token]);

  useEffect(() => {
    setDisplay("loading");
    void loadOverview();
  }, [accountVersion, loadOverview]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "世帯共有の操作に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  const readAndDecrypt = async (
    password: string,
    responsePromise: Promise<SharedPlanResponse>
  ) => {
    const response = await responsePromise;
    const context = responseContext(response);
    return {
      plan: await decryptSharedPlan(response.envelope, password, context),
      response
    };
  };

  const loadIntoBrowser = async (responsePromise: Promise<SharedPlanResponse>, label: string) => {
    if (!currentPassword) throw new Error("共有パスワードを入力してください。");
    const shared = await readAndDecrypt(currentPassword, responsePromise);
    if (!window.confirm(`${label}をこのブラウザへ読み込みます。現在のブラウザ内プランを置き換えますか？`)) return;
    createRecoveryBackup(plan, "before-import");
    if (!commitPlan(shared.plan)) throw new Error("ブラウザ内へ共有プランを保存できませんでした。");
    setMessage(`${label}をブラウザ内へ読み込みました。`);
  };

  const handleCreate = () => run(async () => {
    if (!window.confirm("1契約で本人と共同利用者1人が使う共同世帯を作成しますか？")) return;
    await createSharedHousehold();
    await loadOverview();
    setMessage("共同世帯を作成しました。最初の共有プランを暗号化して保存してください。");
  });

  const handleAccept = () => run(async () => {
    if (!token) throw new Error("招待トークンを確認できませんでした。");
    await acceptHouseholdInvitation(token);
    window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
    await loadOverview();
    await refreshAccessState();
    setMessage("共同世帯へ参加しました。契約者から共有パスワードを別の安全な方法で受け取ってください。");
  });

  const handleSave = () => run(async () => {
    const household = overview?.household;
    if (!household) throw new Error("共同世帯を確認できませんでした。");
    if (!currentPassword) throw new Error("共有パスワードを入力してください。");
    const revision = household.currentRevision + 1;
    const envelope = await encryptSharedPlan(plan, currentPassword, {
      householdId: household.id,
      revision,
      keyEpoch: household.keyEpoch
    });
    await saveSharedPlan(household.currentRevision, CURRENT_PLAN_VERSION, envelope);
    await loadOverview();
    setMessage(`共有プランを版${revision}として暗号化保存しました。`);
  });

  const handleInvite = () => run(async () => {
    const response = await createHouseholdInvitation(inviteEmail);
    setCreatedInvite({
      url: response.invitation.inviteUrl,
      expiresAt: response.invitation.expiresAt
    });
    setInviteEmail("");
    await loadOverview();
    setMessage("24時間有効の招待リンクを作成しました。共有パスワードはリンクと別の方法で伝えてください。");
  });

  const handleCopyInvite = () => run(async () => {
    if (!createdInvite) return;
    await navigator.clipboard.writeText(createdInvite.url);
    setMessage("招待リンクをコピーしました。");
  });

  const handleRevokeInvitation = (id: string) => run(async () => {
    if (!window.confirm("この未使用の招待を取り消しますか？")) return;
    await revokeHouseholdInvitation(id);
    setCreatedInvite(null);
    await loadOverview();
    setMessage("招待を取り消しました。");
  });

  const handleRemoveMember = (id: string) => run(async () => {
    const household = overview?.household;
    if (!household) throw new Error("共同世帯を確認できませんでした。");
    if (household.currentRevision > 0) {
      if (!currentPassword) {
        throw new Error("解除前に現在の共有パスワードを入力してください。");
      }
      await readAndDecrypt(currentPassword, getCurrentSharedPlan());
    }
    if (
      !window.confirm(
        "共同利用者のアクセスを直ちに解除します。解除後は新しい共有パスワードへの更新が終わるまで保存できません。続けますか？"
      )
    ) return;
    await removeHouseholdMember(id);
    setNewPassword("");
    setNewPasswordConfirmation("");
    await loadOverview();
    await refreshAccessState();
    setMessage("共同利用者を解除しました。現在は読み取り専用です。新しい共有パスワードへ更新してください。");
  });

  const handleRotateKey = () => run(async () => {
    const household = overview?.household;
    if (!household) throw new Error("共同世帯を確認できませんでした。");
    if (newPassword !== newPasswordConfirmation) throw new Error("新しい共有パスワードが一致しません。");
    if (newPassword === currentPassword) throw new Error("現在とは異なる共有パスワードを設定してください。");

    let sourcePlan = plan;
    if (household.currentRevision > 0) {
      if (!currentPassword) throw new Error("現在の共有パスワードを入力してください。");
      sourcePlan = (await readAndDecrypt(currentPassword, getCurrentSharedPlan())).plan;
    }

    const targetKeyEpoch = household.status === "active"
      ? household.keyEpoch + 1
      : household.keyEpoch;
    const revision = household.currentRevision + 1;
    const envelope = await encryptSharedPlan(sourcePlan, newPassword, {
      householdId: household.id,
      revision,
      keyEpoch: targetKeyEpoch
    });
    await saveSharedPlan(household.currentRevision, CURRENT_PLAN_VERSION, envelope, true);
    setCurrentPassword(newPassword);
    setNewPassword("");
    setNewPasswordConfirmation("");
    await loadOverview();
    setMessage(`共有パスワードを更新し、版${revision}として保存しました。`);
  });

  const handleLeave = () => run(async () => {
    if (!window.confirm("共同世帯から退出しますか？退出後は共有プランへアクセスできません。")) return;
    await leaveSharedHousehold();
    setOverview(null);
    setRevisions([]);
    setCurrentPassword("");
    await refreshAccessState();
    setMessage("共同世帯から退出しました。ブラウザ内のプランは残っています。");
  });

  const handleDelete = () => run(async () => {
    if (deleteConfirmation !== "削除") throw new Error("確認欄へ「削除」と入力してください。");
    await deleteSharedHousehold();
    setDeleteConfirmation("");
    setCurrentPassword("");
    setNewPassword("");
    setNewPasswordConfirmation("");
    setRevisions([]);
    await loadOverview();
    await refreshAccessState();
    setMessage("共同世帯と暗号化された共有プランを削除しました。ブラウザ内のプランは残っています。");
  });

  if (display === "loading") return null;
  if (display === "hidden") return null;

  const household = overview?.household || null;
  const editor = household?.members.find((member) => member.role === "editor");
  const canManage = household?.role === "owner";

  return (
    <section className="panel household-sharing-panel" data-testid="household-sharing-panel">
      <div className="section-heading-row">
        <div>
          <div className="title-with-badge">
            <h2>夫婦・世帯共有</h2>
            <span className="pro-inline-badge">Proテスト</span>
          </div>
          <p>本人と共同利用者1人で、暗号化した1つのライフプランを確認できます。</p>
        </div>
        <span className={`status-chip${household?.status === "active" ? " complete" : ""}`}>
          {household?.status === "active"
            ? "共有中"
            : household?.status === "read_only"
              ? "鍵更新待ち"
              : household?.status === "deleting"
                ? "削除再試行"
                : "未設定"}
        </span>
      </div>

      <div className="notice-band check household-security-note">
        <strong>平文の家計データや共有パスワードはサーバーへ送りません</strong>
        <span>暗号化と復号はこのブラウザ内で行います。共有パスワードはブラウザにも保存されません。</span>
      </div>

      {token && !household && (
        <div className="household-invite-accept">
          <h3>共同世帯への招待</h3>
          <p>招待されたGoogleアカウントでログイン後、参加してください。招待リンクだけではプランを開けません。</p>
          <button type="button" disabled={busy} onClick={() => void handleAccept()}>招待を確認して参加</button>
        </div>
      )}

      {!token && !household && overview?.canCreate && (
        <div className="household-empty-state">
          <p>共同世帯を作成しても、現在のブラウザ内プランは自動送信されません。作成後に共有パスワードを設定して手動保存します。</p>
          <button type="button" disabled={busy} onClick={() => void handleCreate()}>共同世帯を作成</button>
        </div>
      )}

      {!token && !household && !overview?.canCreate && (
        <div className="notice-band">
          <strong>Googleログインを確認してください</strong>
          <span>招待された場合は招待リンクを開き、対象のGoogleアカウントでログインします。</span>
        </div>
      )}

      {household && (
        <>
          <dl className="household-status-grid">
            <div><dt>権限</dt><dd>{household.role === "owner" ? "契約者" : "共同利用者"}</dd></div>
            <div><dt>参加人数</dt><dd>{household.memberCount}/2人</dd></div>
            <div><dt>現在版</dt><dd>{household.currentRevision > 0 ? `版${household.currentRevision}` : "未保存"}</dd></div>
            <div><dt>最終更新</dt><dd>{formatDateTime(household.updatedAt)}</dd></div>
          </dl>

          {household.status === "read_only" && (
            <div className="notice-band notice">
              <strong>共同利用者の解除後のため読み取り専用です</strong>
              <span>現在の共有パスワードで最新データを確認し、新しい共有パスワードへ更新すると保存を再開できます。</span>
            </div>
          )}
          {household.status === "deleting" && (
            <div className="notice-band notice">
              <strong>暗号化データの削除が完了していません</strong>
              <span>他の操作は停止されています。下の削除操作をもう一度実行してください。</span>
            </div>
          )}

          {household.status !== "deleting" && (
            <div className="household-password-section">
              <PasswordField
                label="現在の共有パスワード"
                value={currentPassword}
                onChange={setCurrentPassword}
                visible={showCurrentPassword}
                onToggle={() => setShowCurrentPassword((value) => !value)}
              />
              <small>12文字以上。契約者と共同利用者が、招待リンクとは別の安全な方法で共有します。</small>
            </div>
          )}

          {household.status !== "deleting" && (
            <div className="household-plan-actions">
              <button
                type="button"
                disabled={busy || !household.readAllowed || household.currentRevision === 0}
                onClick={() => void run(() => loadIntoBrowser(getCurrentSharedPlan(), "最新の共有プラン"))}
              >
                共有から読み込む
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy || !household.writeAllowed}
                onClick={() => void handleSave()}
              >
                現在のプランを共有へ保存
              </button>
            </div>
          )}

          {revisions.length > 0 && household.status !== "deleting" && (
            <details className="projection-details household-revisions">
              <summary>過去の共有版を確認（{revisions.length}件）</summary>
              <div className="recovery-list">
                {revisions.map((revision) => (
                  <div className="recovery-item" key={revision.revision}>
                    <div>
                      <strong>版{revision.revision}</strong>
                      <span>{formatDateTime(revision.createdAt)} / 鍵世代{revision.keyEpoch}</span>
                    </div>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => void run(() => loadIntoBrowser(
                        getSharedRevision(revision.revision),
                        `共有プランの版${revision.revision}`
                      ))}
                    >
                      ブラウザへ読み込む
                    </button>
                  </div>
                ))}
              </div>
            </details>
          )}

          <div className="household-members">
            <h3>参加アカウント</h3>
            <div className="recovery-list">
              {household.members.map((member) => (
                <div className="recovery-item" key={member.id}>
                  <div>
                    <strong>{member.email || "確認済みアカウント"}{member.isCurrentUser ? "（このアカウント）" : ""}</strong>
                    <span>{member.role === "owner" ? "契約者" : "共同利用者"} / {formatDateTime(member.joinedAt)}参加</span>
                  </div>
                  {canManage && member.role === "editor" && (
                    <button
                      type="button"
                      className="text-button danger-text"
                      data-testid="household-remove-member"
                      disabled={busy}
                      onClick={() => void handleRemoveMember(member.id)}
                    >
                      共有を解除
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {canManage && household.status === "active" && !editor && (
            <div className="household-invite-section">
              <h3>共同利用者を招待</h3>
              <label>
                招待するGoogleアカウントのメール
                <input
                  type="email"
                  value={inviteEmail}
                  autoComplete="email"
                  onChange={(event) => setInviteEmail(event.target.value)}
                />
              </label>
              <button type="button" disabled={busy || !inviteEmail.trim()} onClick={() => void handleInvite()}>
                招待リンクを作成
              </button>
              {createdInvite && (
                <div className="household-invite-link">
                  <input type="text" readOnly value={createdInvite.url} aria-label="招待リンク" />
                  <button type="button" className="secondary" onClick={() => void handleCopyInvite()}>コピー</button>
                  <small>{formatDateTime(createdInvite.expiresAt)}まで有効</small>
                </div>
              )}
              {household.pendingInvitations.map((invitation) => (
                <div className="notice-band" key={invitation.id}>
                  <strong>未使用の招待があります</strong>
                  <span>{formatDateTime(invitation.expiresAt)}まで有効</span>
                  <button
                    type="button"
                    className="text-button danger-text"
                    disabled={busy}
                    onClick={() => void handleRevokeInvitation(invitation.id)}
                  >
                    招待を取り消す
                  </button>
                </div>
              ))}
            </div>
          )}

          {canManage && household.status !== "deleting" && (
            <details className="projection-details household-key-rotation" open={household.status === "read_only"}>
              <summary>{household.status === "read_only" ? "新しい共有パスワードへ更新" : "共有パスワードを変更"}</summary>
              <div className="cloud-password-grid">
                <PasswordField
                  label="新しい共有パスワード"
                  value={newPassword}
                  onChange={setNewPassword}
                  visible={showNewPassword}
                  onToggle={() => setShowNewPassword((value) => !value)}
                  autoComplete="new-password"
                />
                <PasswordField
                  label="新しい共有パスワード（確認）"
                  value={newPasswordConfirmation}
                  onChange={setNewPasswordConfirmation}
                  visible={showNewPassword}
                  onToggle={() => setShowNewPassword((value) => !value)}
                  autoComplete="new-password"
                />
              </div>
              <div className="cloud-password-warning">
                <strong>新しい共有パスワードも運営者は復元できません</strong>
                <span>共同利用者がいる場合は、招待リンクと別の方法で新しいパスワードを伝えてください。</span>
              </div>
              <button
                type="button"
                disabled={busy || !newPassword || !newPasswordConfirmation}
                onClick={() => void handleRotateKey()}
              >
                暗号鍵を更新して保存
              </button>
            </details>
          )}

          {household.role === "editor" && (
            <div className="household-danger-zone">
              <h3>共同世帯から退出</h3>
              <p>退出後も、このブラウザへ読み込み済みのプランは自動削除されません。</p>
              <button type="button" className="danger" disabled={busy} onClick={() => void handleLeave()}>
                共同世帯から退出
              </button>
            </div>
          )}

          {canManage && (
            <div className="household-danger-zone">
              <h3>共同世帯を削除</h3>
              <p>参加権限、暗号化された共有プラン、共有版を削除します。ブラウザ内のプランは残ります。</p>
              <label>
                確認のため「削除」と入力
                <input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} />
              </label>
              <button
                type="button"
                className="danger"
                disabled={busy || deleteConfirmation !== "削除"}
                onClick={() => void handleDelete()}
              >
                共同世帯と暗号化データを削除
              </button>
            </div>
          )}
        </>
      )}

      {message && <p className="inline-message" role="status">{message}</p>}
      <p className="muted household-sharing-footnote">共有機能は運営者テスト中です。一般利用者向けにはまだ有効化していません。</p>
    </section>
  );
}
