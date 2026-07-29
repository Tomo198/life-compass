export const ENTITLEMENT_SNAPSHOT_REVISION = 1;
export const PERSONAL_BILLING_STATUSES = Object.freeze([
  "none",
  "pending_payment",
  "active",
  "past_due",
  "cancel_at_period_end",
  "expired",
  "revoked"
]);
export const PERSONAL_ENTITLEMENT_SOURCES = Object.freeze(["square", "manual", "none"]);
export const HOUSEHOLD_ROLES = Object.freeze(["none", "owner", "editor", "viewer"]);
export const HOUSEHOLD_ACCESS_STATUSES = Object.freeze(["none", "active", "read_only", "deleting"]);
export const PRO_OPERATIONS = Object.freeze([
  "view_saved_pro_data",
  "export_personal_data",
  "import_personal_data",
  "create_review_plan",
  "edit_review_plan",
  "compare_plans",
  "adopt_plan",
  "run_detailed_simulation",
  "view_version_history",
  "restore_version",
  "create_cloud_backup",
  "restore_cloud_backup",
  "delete_cloud_backup",
  "view_household",
  "edit_household",
  "manage_household_members",
  "import_household_json"
]);

const UTC_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const personalStatuses = new Set(PERSONAL_BILLING_STATUSES);
const personalSources = new Set(PERSONAL_ENTITLEMENT_SOURCES);
const householdRoles = new Set(HOUSEHOLD_ROLES);
const householdStatuses = new Set(HOUSEHOLD_ACCESS_STATUSES);
const operations = new Set(PRO_OPERATIONS);
const freePersonalOperations = new Set([
  "view_saved_pro_data",
  "export_personal_data",
  "import_personal_data",
  "view_version_history",
  "restore_cloud_backup",
  "delete_cloud_backup"
]);
const personalProOperations = new Set([
  "create_review_plan",
  "edit_review_plan",
  "compare_plans",
  "adopt_plan",
  "run_detailed_simulation",
  "restore_version",
  "create_cloud_backup"
]);
const householdReadOperations = new Set(["view_household"]);
const householdWriteOperations = new Set(["edit_household", "import_household_json"]);

const allowed = Object.freeze({ allowed: true, reason: "allowed" });
const denied = (reason) => ({ allowed: false, reason });
const isRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));

const parseUtcInstant = (value) => {
  if (typeof value !== "string" || !UTC_INSTANT_PATTERN.test(value)) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  return new Date(milliseconds).toISOString() === value ? milliseconds : null;
};

const isNullableUtcInstant = (value) => value === null || parseUtcInstant(value) !== null;

const isValidPersonalEntitlement = (personal) => {
  if (
    !isRecord(personal)
    || !personalStatuses.has(personal.status)
    || !personalSources.has(personal.source)
    || !isNullableUtcInstant(personal.validUntil)
    || !isNullableUtcInstant(personal.graceUntil)
  ) {
    return false;
  }

  const validUntil = parseUtcInstant(personal.validUntil);
  const graceUntil = parseUtcInstant(personal.graceUntil);

  if (personal.status === "none") {
    return personal.source === "none" && personal.validUntil === null && personal.graceUntil === null;
  }
  if (personal.source === "none") return false;

  if (personal.status === "pending_payment") {
    return personal.source === "square" && personal.graceUntil === null;
  }
  if (personal.status === "active") {
    return personal.graceUntil === null
      && (personal.source === "manual" || validUntil !== null);
  }
  if (personal.status === "past_due") {
    return personal.source === "square"
      && validUntil !== null
      && graceUntil !== null
      && graceUntil - validUntil === SEVEN_DAYS_MS;
  }
  if (personal.status === "cancel_at_period_end") {
    return personal.source === "square"
      && validUntil !== null
      && personal.graceUntil === null;
  }
  if (personal.status === "expired" || personal.status === "revoked") {
    return personal.graceUntil === null;
  }
  return false;
};

const isValidHouseholdEntitlement = (household) => {
  if (
    !isRecord(household)
    || !householdRoles.has(household.role)
    || !householdStatuses.has(household.status)
    || !isNullableUtcInstant(household.revokedAt)
    || !isNullableUtcInstant(household.retentionUntil)
    || typeof household.readAllowed !== "boolean"
    || typeof household.writeAllowed !== "boolean"
  ) {
    return false;
  }

  if (household.householdId === null) {
    return household.role === "none"
      && household.status === "none"
      && household.revision === null
      && household.revokedAt === null
      && household.retentionUntil === null
      && !household.readAllowed
      && !household.writeAllowed;
  }

  if (
    typeof household.householdId !== "string"
    || household.householdId.trim() === ""
    || household.role === "none"
    || household.status === "none"
    || !Number.isInteger(household.revision)
    || household.revision < 0
    || (household.writeAllowed && !household.readAllowed)
    || (household.role === "viewer" && household.writeAllowed)
    || (household.status !== "active" && household.writeAllowed)
    || (household.status === "deleting" && household.readAllowed)
    || (household.revokedAt !== null && (household.readAllowed || household.writeAllowed))
    || (household.retentionUntil !== null && household.writeAllowed)
  ) {
    return false;
  }

  return true;
};

const isValidSnapshotEnvelope = (snapshot, currentTime) => {
  if (
    !isRecord(snapshot)
    || snapshot.revision !== ENTITLEMENT_SNAPSHOT_REVISION
    || parseUtcInstant(snapshot.evaluatedAt) === null
  ) {
    return false;
  }
  const currentMilliseconds = parseUtcInstant(currentTime);
  return currentMilliseconds !== null
    && parseUtcInstant(snapshot.evaluatedAt) <= currentMilliseconds;
};

export const createDefaultEntitlementSnapshot = (evaluatedAt = "1970-01-01T00:00:00.000Z") => ({
  personal: {
    status: "none",
    validUntil: null,
    graceUntil: null,
    source: "none"
  },
  household: {
    householdId: null,
    role: "none",
    status: "none",
    revision: null,
    revokedAt: null,
    readAllowed: false,
    writeAllowed: false,
    retentionUntil: null
  },
  evaluatedAt,
  revision: ENTITLEMENT_SNAPSHOT_REVISION
});

export const parseEntitlementSnapshot = (value) => {
  if (
    !isRecord(value)
    || value.revision !== ENTITLEMENT_SNAPSHOT_REVISION
    || parseUtcInstant(value.evaluatedAt) === null
    || !isValidPersonalEntitlement(value.personal)
    || !isValidHouseholdEntitlement(value.household)
  ) {
    return null;
  }

  return {
    personal: {
      status: value.personal.status,
      validUntil: value.personal.validUntil,
      graceUntil: value.personal.graceUntil,
      source: value.personal.source
    },
    household: {
      householdId: value.household.householdId,
      role: value.household.role,
      status: value.household.status,
      revision: value.household.revision,
      revokedAt: value.household.revokedAt,
      readAllowed: value.household.readAllowed,
      writeAllowed: value.household.writeAllowed,
      retentionUntil: value.household.retentionUntil
    },
    evaluatedAt: value.evaluatedAt,
    revision: value.revision
  };
};

const personalProDecision = (personal, currentTime) => {
  if (!isValidPersonalEntitlement(personal)) return denied("invalid_entitlement");
  const now = parseUtcInstant(currentTime);
  if (now === null) return denied("invalid_entitlement");

  if (personal.status === "active") {
    const validUntil = parseUtcInstant(personal.validUntil);
    return validUntil === null || now < validUntil
      ? allowed
      : denied("subscription_expired");
  }
  if (personal.status === "cancel_at_period_end") {
    return now < parseUtcInstant(personal.validUntil)
      ? allowed
      : denied("subscription_expired");
  }
  if (personal.status === "past_due") {
    return now < parseUtcInstant(personal.graceUntil)
      ? allowed
      : denied("grace_period_expired");
  }
  if (personal.status === "expired") return denied("subscription_expired");
  if (personal.status === "revoked") return denied("revoked");
  return denied("personal_pro_required");
};

const householdDecision = (household, operation, currentTime) => {
  if (!isValidHouseholdEntitlement(household)) return denied("invalid_entitlement");
  const now = parseUtcInstant(currentTime);
  if (now === null) return denied("invalid_entitlement");
  if (household.householdId === null || household.role === "none") {
    return denied("household_membership_required");
  }
  if (household.revokedAt !== null) return denied("revoked");
  if (
    household.retentionUntil !== null
    && now >= parseUtcInstant(household.retentionUntil)
  ) {
    return denied("household_read_permission_required");
  }

  if (householdReadOperations.has(operation)) {
    return household.readAllowed ? allowed : denied("household_read_permission_required");
  }
  if (householdWriteOperations.has(operation)) {
    return ["owner", "editor"].includes(household.role) && household.writeAllowed
      ? allowed
      : denied("household_write_permission_required");
  }
  if (operation === "manage_household_members") {
    if (household.role !== "owner") return denied("household_owner_required");
    return household.writeAllowed
      ? allowed
      : denied("household_write_permission_required");
  }
  return denied("invalid_entitlement");
};

export const canPerformOperation = (snapshot, operation, currentTime) => {
  if (!operations.has(operation)) return denied("invalid_entitlement");

  // These are Free data-access and data-rescue operations. They do not grant a
  // paid entitlement; authentication and resource ownership remain server-side.
  if (freePersonalOperations.has(operation)) return allowed;

  if (!isValidSnapshotEnvelope(snapshot, currentTime)) return denied("invalid_entitlement");
  if (personalProOperations.has(operation)) {
    return personalProDecision(snapshot.personal, currentTime);
  }
  return householdDecision(snapshot.household, operation, currentTime);
};

export const deriveLegacyPersonalTier = (snapshot, currentTime) =>
  canPerformOperation(snapshot, "create_review_plan", currentTime).allowed ? "pro" : "free";
