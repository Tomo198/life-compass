export type PersonalBillingStatus =
  | "none"
  | "pending_payment"
  | "active"
  | "past_due"
  | "cancel_at_period_end"
  | "expired"
  | "revoked";

export type PersonalEntitlementSource = "square" | "manual" | "none";
export type HouseholdRole = "none" | "owner" | "editor" | "viewer";
export type HouseholdAccessStatus = "none" | "active" | "read_only" | "deleting";

export interface PersonalEntitlement {
  status: PersonalBillingStatus;
  validUntil: string | null;
  graceUntil: string | null;
  source: PersonalEntitlementSource;
}

export interface HouseholdEntitlement {
  householdId: string | null;
  role: HouseholdRole;
  status: HouseholdAccessStatus;
  revision: number | null;
  revokedAt: string | null;
  readAllowed: boolean;
  writeAllowed: boolean;
  retentionUntil: string | null;
}

export interface EntitlementSnapshot {
  personal: PersonalEntitlement;
  household: HouseholdEntitlement;
  evaluatedAt: string;
  revision: number;
}

export type ProOperation =
  | "view_saved_pro_data"
  | "export_personal_data"
  | "import_personal_data"
  | "create_review_plan"
  | "edit_review_plan"
  | "compare_plans"
  | "adopt_plan"
  | "run_detailed_simulation"
  | "view_version_history"
  | "restore_version"
  | "create_cloud_backup"
  | "restore_cloud_backup"
  | "delete_cloud_backup"
  | "view_household"
  | "edit_household"
  | "manage_household_members"
  | "import_household_json";

export type PermissionReason =
  | "allowed"
  | "personal_pro_required"
  | "household_membership_required"
  | "household_read_permission_required"
  | "household_write_permission_required"
  | "household_owner_required"
  | "subscription_expired"
  | "grace_period_expired"
  | "revoked"
  | "invalid_entitlement";

export type PermissionDecision = {
  allowed: boolean;
  reason: PermissionReason;
};

export const ENTITLEMENT_SNAPSHOT_REVISION: 1;
export const PERSONAL_BILLING_STATUSES: readonly PersonalBillingStatus[];
export const PERSONAL_ENTITLEMENT_SOURCES: readonly PersonalEntitlementSource[];
export const HOUSEHOLD_ROLES: readonly HouseholdRole[];
export const HOUSEHOLD_ACCESS_STATUSES: readonly HouseholdAccessStatus[];
export const PRO_OPERATIONS: readonly ProOperation[];

export function createDefaultEntitlementSnapshot(evaluatedAt?: string): EntitlementSnapshot;
export function parseEntitlementSnapshot(value: unknown): EntitlementSnapshot | null;
export function canPerformOperation(
  snapshot: unknown,
  operation: ProOperation,
  currentTime: string
): PermissionDecision;
export function deriveLegacyPersonalTier(
  snapshot: unknown,
  currentTime: string
): "free" | "pro";
