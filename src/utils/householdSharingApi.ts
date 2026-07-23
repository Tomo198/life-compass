import type { EncryptedSharedPlanEnvelope } from "./sharedPlanCrypto";

export type SharedHouseholdMember = {
  id: string;
  role: "owner" | "editor";
  email: string | null;
  isCurrentUser: boolean;
  joinedAt: string;
};

export type SharedHouseholdInvitation = {
  id: string;
  expiresAt: string;
  createdAt: string;
};

export type SharedHousehold = {
  id: string;
  role: "owner" | "editor";
  status: "active" | "read_only" | "deleting";
  keyEpoch: number;
  currentRevision: number;
  memberCount: number;
  members: SharedHouseholdMember[];
  pendingInvitations: SharedHouseholdInvitation[];
  readAllowed: boolean;
  writeAllowed: boolean;
  ownerProActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SharedRevision = {
  revision: number;
  keyEpoch: number;
  planVersion: number;
  sizeBytes: number;
  createdAt: string;
};

export type HouseholdOverview = {
  mode: "preview" | "enforced";
  household: SharedHousehold | null;
  canCreate: boolean;
};

export type SharedPlanResponse = {
  householdId: string;
  currentRevision: number;
  keyEpoch?: number;
  revision: SharedRevision | null;
  envelope: EncryptedSharedPlanEnvelope | null;
};

const errorMessages: Record<string, string> = {
  authentication_required: "Googleでログインしてください。",
  verified_email_required: "確認済みのGoogleメールアドレスが必要です。",
  fresh_authentication_required: "安全確認のため、ログアウトしてGoogleで再ログインしてから操作してください。",
  household_preview_not_allowed: "このアカウントは世帯共有テストの対象外です。",
  household_access_denied: "この共同世帯へのアクセス権がありません。",
  household_owner_required: "この操作は契約者本人だけが行えます。",
  household_write_locked: "鍵の更新または契約状態の確認が終わるまで保存できません。",
  pro_required: "共同世帯の作成と更新には契約者のPro権限が必要です。",
  active_household_exists: "このアカウントはすでに共同世帯へ参加しています。",
  household_member_limit: "共同利用者は1人までです。",
  invalid_invitee_email: "招待するGoogleアカウントのメールアドレスを確認してください。",
  cannot_invite_self: "契約者本人とは別のGoogleアカウントを指定してください。",
  invalid_invitation: "招待リンクが無効、期限切れ、または対象アカウントと一致しません。",
  invitation_unavailable: "この招待はすでに使用済みか、利用できなくなっています。",
  household_member_not_found: "共同利用者を確認できませんでした。",
  household_state_changed: "別の端末で共有状態が変わりました。最新の状態を読み直してください。",
  owner_cannot_leave: "契約者は退出できません。共同世帯を削除してください。",
  shared_plan_conflict: "別の端末または共同利用者が先に更新しました。最新の共有プランを読み直してください。",
  shared_plan_integrity_failed: "共有プランの整合性を確認できませんでした。",
  shared_plan_object_not_found: "暗号化された共有プランが見つかりませんでした。",
  shared_plan_storage_unavailable: "共有プランの保存先を確認できないため、現在は操作できません。",
  shared_plan_deletion_failed: "暗号化データを削除できませんでした。時間をおいてもう一度お試しください。",
  rate_limited: "操作が集中しています。少し待ってからもう一度お試しください。"
};

export class HouseholdApiError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, fallback: string) {
    super(errorMessages[code] || fallback);
    this.name = "HouseholdApiError";
    this.code = code;
    this.status = status;
  }
}

const request = async <T>(path: string, init: RequestInit = {}, fallback = "世帯共有の操作に失敗しました。") => {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: init.body
      ? { "Content-Type": "application/json", ...init.headers }
      : init.headers
  });
  if (!response.ok) {
    let code = "unknown_error";
    try {
      const body = await response.json() as { error?: { code?: string } };
      if (typeof body.error?.code === "string") code = body.error.code;
    } catch {
      // A generic message is safer than exposing an upstream response body.
    }
    throw new HouseholdApiError(response.status, code, fallback);
  }
  return response.json() as Promise<T>;
};

export const getHouseholdOverview = () =>
  request<HouseholdOverview>("/api/shared-household", {}, "共同世帯の状態を確認できませんでした。");

export const createSharedHousehold = () =>
  request<{ household: SharedHousehold }>(
    "/api/shared-household",
    { method: "POST", body: JSON.stringify({ confirmation: "CREATE_SHARED_HOUSEHOLD" }) },
    "共同世帯を作成できませんでした。"
  );

export const createHouseholdInvitation = (email: string) =>
  request<{ invitation: { id: string; inviteUrl: string; expiresAt: string } }>(
    "/api/shared-household/invitations",
    { method: "POST", body: JSON.stringify({ email }) },
    "招待リンクを作成できませんでした。"
  );

export const revokeHouseholdInvitation = (id: string) =>
  request<{ invitationRevoked: boolean }>(
    `/api/shared-household/invitations/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    "招待を取り消せませんでした。"
  );

export const acceptHouseholdInvitation = (token: string) =>
  request<{ household: SharedHousehold }>(
    "/api/shared-household/invitations/accept",
    { method: "POST", body: JSON.stringify({ token }) },
    "共同世帯へ参加できませんでした。"
  );

export const removeHouseholdMember = (membershipId: string) =>
  request<{ memberRemoved: boolean; requiresKeyRotation: boolean }>(
    `/api/shared-household/members/${encodeURIComponent(membershipId)}`,
    { method: "DELETE" },
    "共同利用者を解除できませんでした。"
  );

export const leaveSharedHousehold = () =>
  request<{ leftHousehold: boolean }>(
    "/api/shared-household/leave",
    { method: "POST" },
    "共同世帯から退出できませんでした。"
  );

export const deleteSharedHousehold = () =>
  request<{ householdDeleted: boolean }>(
    "/api/shared-household",
    { method: "DELETE", body: JSON.stringify({ confirmation: "DELETE_SHARED_HOUSEHOLD" }) },
    "共同世帯を削除できませんでした。"
  );

export const getCurrentSharedPlan = () =>
  request<SharedPlanResponse>(
    "/api/shared-household/plan",
    {},
    "最新の共有プランを取得できませんでした。"
  );

export const getSharedRevision = (revision: number) =>
  request<SharedPlanResponse>(
    `/api/shared-household/revisions/${revision}`,
    {},
    "指定した共有プランを取得できませんでした。"
  );

export const listSharedRevisions = () =>
  request<{ currentRevision: number; revisions: SharedRevision[]; limit: number }>(
    "/api/shared-household/revisions",
    {},
    "共有プランの履歴を取得できませんでした。"
  );

export const saveSharedPlan = (
  expectedRevision: number,
  planVersion: number,
  envelope: EncryptedSharedPlanEnvelope,
  rotateKey = false
) =>
  request<{ currentRevision: number; keyEpoch: number; revision: SharedRevision }>(
    rotateKey ? "/api/shared-household/plan/rotate-key" : "/api/shared-household/plan",
    {
      method: "PUT",
      body: JSON.stringify({ expectedRevision, planVersion, envelope })
    },
    rotateKey ? "共有鍵を更新できませんでした。" : "共有プランを保存できませんでした。"
  );
