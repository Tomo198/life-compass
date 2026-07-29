import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canPerformOperation,
  createDefaultEntitlementSnapshot,
  deriveLegacyPersonalTier,
  parseEntitlementSnapshot,
  type EntitlementSnapshot,
  type HouseholdEntitlement,
  type PersonalEntitlement,
  type ProOperation
} from "../shared/entitlement-policy.js";

const NOW = "2026-07-30T00:00:00.000Z";
const VALID_UNTIL = "2026-08-01T00:00:00.000Z";
const GRACE_UNTIL = "2026-08-08T00:00:00.000Z";

const snapshot = ({
  personal = {},
  household = {},
  evaluatedAt = NOW,
  revision = 1
}: {
  personal?: Partial<PersonalEntitlement>;
  household?: Partial<HouseholdEntitlement>;
  evaluatedAt?: string;
  revision?: number;
} = {}): EntitlementSnapshot => ({
  ...createDefaultEntitlementSnapshot(evaluatedAt),
  personal: {
    ...createDefaultEntitlementSnapshot(evaluatedAt).personal,
    ...personal
  },
  household: {
    ...createDefaultEntitlementSnapshot(evaluatedAt).household,
    ...household
  },
  revision
});

const squareActive = (): EntitlementSnapshot => snapshot({
  personal: {
    status: "active",
    source: "square",
    validUntil: VALID_UNTIL
  }
});

const activeHousehold = (
  role: HouseholdEntitlement["role"],
  writeAllowed: boolean
): EntitlementSnapshot => snapshot({
  household: {
    householdId: "household-1",
    role,
    status: "active",
    revision: 4,
    readAllowed: true,
    writeAllowed
  }
});

test("personal billing states grant Pro only while their explicit UTC window is open", () => {
  const cases: Array<{
    name: string;
    value: EntitlementSnapshot;
    currentTime?: string;
    allowed: boolean;
    reason: string;
  }> = [
    {
      name: "free",
      value: snapshot(),
      allowed: false,
      reason: "personal_pro_required"
    },
    {
      name: "active Square",
      value: squareActive(),
      allowed: true,
      reason: "allowed"
    },
    {
      name: "active manual without expiry",
      value: snapshot({ personal: { status: "active", source: "manual" } }),
      allowed: true,
      reason: "allowed"
    },
    {
      name: "active exactly at validUntil",
      value: squareActive(),
      currentTime: VALID_UNTIL,
      allowed: false,
      reason: "subscription_expired"
    },
    {
      name: "cancel before validUntil",
      value: snapshot({
        personal: {
          status: "cancel_at_period_end",
          source: "square",
          validUntil: VALID_UNTIL
        }
      }),
      allowed: true,
      reason: "allowed"
    },
    {
      name: "cancel exactly at validUntil",
      value: snapshot({
        personal: {
          status: "cancel_at_period_end",
          source: "square",
          validUntil: VALID_UNTIL
        }
      }),
      currentTime: VALID_UNTIL,
      allowed: false,
      reason: "subscription_expired"
    },
    {
      name: "cancel after validUntil",
      value: snapshot({
        personal: {
          status: "cancel_at_period_end",
          source: "square",
          validUntil: VALID_UNTIL
        }
      }),
      currentTime: "2026-08-01T00:00:00.001Z",
      allowed: false,
      reason: "subscription_expired"
    },
    {
      name: "past due before graceUntil",
      value: snapshot({
        personal: {
          status: "past_due",
          source: "square",
          validUntil: VALID_UNTIL,
          graceUntil: GRACE_UNTIL
        }
      }),
      currentTime: "2026-08-07T23:59:59.999Z",
      allowed: true,
      reason: "allowed"
    },
    {
      name: "past due exactly at graceUntil",
      value: snapshot({
        personal: {
          status: "past_due",
          source: "square",
          validUntil: VALID_UNTIL,
          graceUntil: GRACE_UNTIL
        }
      }),
      currentTime: GRACE_UNTIL,
      allowed: false,
      reason: "grace_period_expired"
    },
    {
      name: "past due after graceUntil",
      value: snapshot({
        personal: {
          status: "past_due",
          source: "square",
          validUntil: VALID_UNTIL,
          graceUntil: GRACE_UNTIL
        }
      }),
      currentTime: "2026-08-08T00:00:00.001Z",
      allowed: false,
      reason: "grace_period_expired"
    },
    {
      name: "expired",
      value: snapshot({ personal: { status: "expired", source: "square", validUntil: VALID_UNTIL } }),
      allowed: false,
      reason: "subscription_expired"
    },
    {
      name: "revoked",
      value: snapshot({ personal: { status: "revoked", source: "manual" } }),
      allowed: false,
      reason: "revoked"
    },
    {
      name: "pending payment",
      value: snapshot({ personal: { status: "pending_payment", source: "square" } }),
      allowed: false,
      reason: "personal_pro_required"
    }
  ];

  for (const item of cases) {
    assert.deepEqual(
      canPerformOperation(item.value, "create_review_plan", item.currentTime ?? NOW),
      { allowed: item.allowed, reason: item.reason },
      item.name
    );
  }
});

test("Free downgrade keeps saved data and rescue operations while blocking new Pro generation", () => {
  const free = snapshot();
  const allowedOperations: ProOperation[] = [
    "view_saved_pro_data",
    "export_personal_data",
    "import_personal_data",
    "view_version_history",
    "restore_cloud_backup",
    "delete_cloud_backup"
  ];
  const blockedOperations: ProOperation[] = [
    "create_review_plan",
    "edit_review_plan",
    "compare_plans",
    "adopt_plan",
    "run_detailed_simulation",
    "restore_version",
    "create_cloud_backup"
  ];

  for (const operation of allowedOperations) {
    assert.equal(canPerformOperation(free, operation, NOW).allowed, true, operation);
  }
  for (const operation of blockedOperations) {
    assert.equal(canPerformOperation(free, operation, NOW).allowed, false, operation);
  }
});

test("active personal Pro allows every personal Pro operation", () => {
  const operations: ProOperation[] = [
    "create_review_plan",
    "edit_review_plan",
    "compare_plans",
    "adopt_plan",
    "run_detailed_simulation",
    "restore_version",
    "create_cloud_backup"
  ];
  for (const operation of operations) {
    assert.equal(canPerformOperation(squareActive(), operation, NOW).allowed, true, operation);
  }
});

test("household roles are independent from personal Pro operations", () => {
  const owner = activeHousehold("owner", true);
  const editor = activeHousehold("editor", true);
  const viewer = activeHousehold("viewer", false);
  const noMembership = squareActive();

  assert.equal(canPerformOperation(owner, "view_household", NOW).allowed, true);
  assert.equal(canPerformOperation(owner, "edit_household", NOW).allowed, true);
  assert.equal(canPerformOperation(owner, "import_household_json", NOW).allowed, true);
  assert.equal(canPerformOperation(owner, "manage_household_members", NOW).allowed, true);

  assert.equal(canPerformOperation(editor, "view_household", NOW).allowed, true);
  assert.equal(canPerformOperation(editor, "edit_household", NOW).allowed, true);
  assert.equal(canPerformOperation(editor, "import_household_json", NOW).allowed, true);
  assert.deepEqual(
    canPerformOperation(editor, "manage_household_members", NOW),
    { allowed: false, reason: "household_owner_required" }
  );

  assert.equal(canPerformOperation(viewer, "view_household", NOW).allowed, true);
  assert.equal(canPerformOperation(viewer, "edit_household", NOW).allowed, false);
  assert.equal(canPerformOperation(viewer, "import_household_json", NOW).allowed, false);
  assert.equal(canPerformOperation(viewer, "manage_household_members", NOW).allowed, false);

  assert.equal(canPerformOperation(snapshot(), "view_household", NOW).allowed, false);
  assert.equal(canPerformOperation(noMembership, "edit_household", NOW).allowed, false);
  assert.equal(canPerformOperation(owner, "create_cloud_backup", NOW).allowed, false);
  assert.equal(canPerformOperation(editor, "compare_plans", NOW).allowed, false);
  assert.equal(canPerformOperation(editor, "adopt_plan", NOW).allowed, false);
});

test("malformed or contradictory elevated entitlement states fail closed", () => {
  const malformed: Array<{ name: string; value: unknown; operation: ProOperation }> = [
    {
      name: "unknown personal status",
      value: {
        ...squareActive(),
        personal: { ...squareActive().personal, status: "future_status" }
      },
      operation: "create_review_plan"
    },
    {
      name: "invalid personal date",
      value: snapshot({
        personal: { status: "active", source: "square", validUntil: "not-a-date" }
      }) as unknown,
      operation: "create_review_plan"
    },
    {
      name: "Square active without validUntil",
      value: snapshot({ personal: { status: "active", source: "square" } }),
      operation: "create_review_plan"
    },
    {
      name: "past due without graceUntil",
      value: snapshot({
        personal: { status: "past_due", source: "square", validUntil: VALID_UNTIL }
      }),
      operation: "create_review_plan"
    },
    {
      name: "past due grace is not seven days after validUntil",
      value: snapshot({
        personal: {
          status: "past_due",
          source: "square",
          validUntil: VALID_UNTIL,
          graceUntil: "2026-08-07T23:59:59.999Z"
        }
      }),
      operation: "create_review_plan"
    },
    {
      name: "manual cancellation is not a Square contract",
      value: snapshot({
        personal: {
          status: "cancel_at_period_end",
          source: "manual",
          validUntil: VALID_UNTIL
        }
      }),
      operation: "create_review_plan"
    },
    {
      name: "owner without household id",
      value: snapshot({ household: { role: "owner" } }),
      operation: "view_household"
    },
    {
      name: "editor without household id",
      value: snapshot({ household: { role: "editor" } }),
      operation: "edit_household"
    },
    {
      name: "viewer without household id",
      value: snapshot({ household: { role: "viewer" } }),
      operation: "view_household"
    },
    {
      name: "household id with none role",
      value: snapshot({
        household: {
          householdId: "household-1",
          status: "active",
          revision: 0,
          readAllowed: true
        }
      }),
      operation: "view_household"
    },
    {
      name: "negative household revision",
      value: snapshot({
        household: {
          householdId: "household-1",
          role: "owner",
          status: "active",
          revision: -1,
          readAllowed: true,
          writeAllowed: true
        }
      }),
      operation: "edit_household"
    },
    {
      name: "fractional household revision",
      value: snapshot({
        household: {
          householdId: "household-1",
          role: "owner",
          status: "active",
          revision: 1.5,
          readAllowed: true,
          writeAllowed: true
        }
      }),
      operation: "edit_household"
    },
    {
      name: "deleting household cannot remain readable",
      value: snapshot({
        household: {
          householdId: "household-1",
          role: "owner",
          status: "deleting",
          revision: 1,
          readAllowed: true,
          writeAllowed: false
        }
      }),
      operation: "edit_household"
    },
    {
      name: "future snapshot",
      value: snapshot({ evaluatedAt: "2026-08-01T00:00:00.000Z" }),
      operation: "create_review_plan"
    }
  ];

  for (const item of malformed) {
    assert.deepEqual(
      canPerformOperation(item.value, item.operation, NOW),
      { allowed: false, reason: "invalid_entitlement" },
      item.name
    );
  }
});

test("revoked and read-only household states cannot write", () => {
  const revoked = activeHousehold("owner", true);
  revoked.household.revokedAt = "2026-07-29T00:00:00.000Z";
  revoked.household.readAllowed = false;
  revoked.household.writeAllowed = false;
  assert.deepEqual(
    canPerformOperation(revoked, "view_household", NOW),
    { allowed: false, reason: "revoked" }
  );

  const readOnly = activeHousehold("editor", false);
  readOnly.household.status = "read_only";
  readOnly.household.retentionUntil = "2026-08-01T00:00:00.000Z";
  assert.equal(canPerformOperation(readOnly, "view_household", NOW).allowed, true);
  assert.equal(canPerformOperation(readOnly, "edit_household", NOW).allowed, false);
  assert.equal(
    canPerformOperation(readOnly, "view_household", "2026-08-01T00:00:00.000Z").allowed,
    false
  );
});

test("legacy personal tier is derived only from personal entitlement", () => {
  assert.equal(deriveLegacyPersonalTier(squareActive(), NOW), "pro");
  assert.equal(deriveLegacyPersonalTier(activeHousehold("owner", true), NOW), "free");
});

test("the response parser rejects invalid snapshots but Free rescue operations stay available", () => {
  const invalid = {
    ...snapshot(),
    personal: { ...snapshot().personal, status: "unknown" }
  };
  assert.equal(parseEntitlementSnapshot(invalid), null);
  assert.equal(canPerformOperation(invalid, "create_cloud_backup", NOW).allowed, false);
  assert.equal(canPerformOperation(invalid, "export_personal_data", NOW).allowed, true);
  assert.equal(canPerformOperation(invalid, "restore_cloud_backup", NOW).allowed, true);
});
