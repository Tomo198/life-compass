import {
  canPerformOperation,
  createDefaultEntitlementSnapshot,
  parseEntitlementSnapshot
} from "../shared/entitlement-policy.js";

const normalizeSubject = (value) => typeof value === "string" ? value.trim() : "";
const HOUSEHOLD_RETENTION_DAYS = 90;
const PAYMENT_GRACE_DAYS = 7;
const householdRoles = new Set(["owner", "editor", "viewer"]);

const normalizeUtcInstant = (value) => {
  if (typeof value !== "string" || !value) return null;
  const dateOnlyMatch = value.match(/^(\d{4}-\d{2}-\d{2})$/u);
  const timestampWithZoneMatch = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u
  );
  if (!dateOnlyMatch && !timestampWithZoneMatch) return null;
  const calendarMatch = timestampWithZoneMatch || value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  const year = Number(calendarMatch?.[1]);
  const month = Number(calendarMatch?.[2]);
  const day = Number(calendarMatch?.[3]);
  const hour = Number(timestampWithZoneMatch?.[4] || 0);
  const minute = Number(timestampWithZoneMatch?.[5] || 0);
  const second = Number(timestampWithZoneMatch?.[6] || 0);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    month < 1
    || month > 12
    || day < 1
    || day > daysInMonth
    || hour > 23
    || minute > 59
    || second > 59
  ) return null;
  const normalizedValue = dateOnlyMatch
    ? `${dateOnlyMatch[1]}T00:00:00.000Z`
    : value;
  const milliseconds = Date.parse(normalizedValue);
  if (!Number.isFinite(milliseconds)) return null;
  const instant = new Date(milliseconds).toISOString();
  if (dateOnlyMatch && instant.slice(0, 10) !== value) return null;
  return Date.parse(instant) === milliseconds ? instant : null;
};

const normalizeDatabaseTimestamp = (value) => {
  if (typeof value !== "string") return null;
  const sqliteUtcMatch = value.match(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/u
  );
  return normalizeUtcInstant(
    sqliteUtcMatch
      ? `${sqliteUtcMatch[1]}T${sqliteUtcMatch[2]}.000Z`
      : value
  );
};

const normalizePeriodEnd = (value) => {
  const instant = normalizeUtcInstant(value);
  if (!instant) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return instant;
  return new Date(Date.parse(instant) + 24 * 60 * 60 * 1000).toISOString();
};

const addUtcDays = (value, days) => {
  const instant = normalizeUtcInstant(value);
  return instant
    ? new Date(Date.parse(instant) + days * 24 * 60 * 60 * 1000).toISOString()
    : null;
};

export const isOwnerTestUser = (user, env) => {
  const ownerSubject = normalizeSubject(env?.OWNER_GOOGLE_SUB);
  return Boolean(
    ownerSubject
    && user?.emailVerified
    && normalizeSubject(user.googleSub) === ownerSubject
  );
};

export const getHouseholdSharingMode = (env) =>
  ["preview", "enforced"].includes(env?.HOUSEHOLD_SHARING_MODE)
    ? env.HOUSEHOLD_SHARING_MODE
    : "disabled";

const getLatestProSubscription = async (env, userId) => {
  if (!env?.DB || !userId) return null;
  return env.DB.prepare(
    `SELECT tier, status, payment_status, current_period_end, cancel_at_period_end,
            billing_provider, provider_subscription_id
       FROM subscriptions
      WHERE user_id = ?
        AND tier = 'pro'
      ORDER BY updated_at DESC
      LIMIT 1`
  ).bind(userId).first();
};

const getCurrentPaymentFailureAt = async (env, subscription) => {
  if (
    !env?.DB
    || subscription?.billing_provider !== "square"
    || typeof subscription?.provider_subscription_id !== "string"
    || !subscription.provider_subscription_id
  ) return null;
  const event = await env.DB.prepare(
    `SELECT failed.received_at
       FROM billing_webhook_events AS failed
      WHERE failed.provider = 'square'
        AND failed.provider_object_id = ?
        AND failed.event_type = 'invoice.scheduled_charge_failed'
        AND failed.status = 'processed'
        AND failed.received_at >= COALESCE(
          (
            SELECT MAX(paid.received_at)
              FROM billing_webhook_events AS paid
             WHERE paid.provider = failed.provider
               AND paid.provider_object_id = failed.provider_object_id
               AND paid.event_type = 'invoice.payment_made'
               AND paid.status = 'processed'
          ),
          '0000-01-01 00:00:00'
        )
      ORDER BY failed.received_at ASC
      LIMIT 1`
  ).bind(subscription.provider_subscription_id).first();
  return normalizeDatabaseTimestamp(event?.received_at);
};

const personalEntitlementFromSubscription = (subscription, currentTime, paymentFailureAt) => {
  if (!subscription) return createDefaultEntitlementSnapshot(currentTime).personal;
  if (subscription.billing_provider !== "square") {
    return {
      status: "revoked",
      validUntil: null,
      graceUntil: null,
      source: "square"
    };
  }

  const periodValidUntil = normalizePeriodEnd(subscription.current_period_end);
  const paymentStatus = subscription.payment_status;
  const subscriptionStatus = subscription.status;
  let status;

  if (["canceled", "deactivated", "completed"].includes(subscriptionStatus)) {
    status = "expired";
  } else if (
    paymentStatus === "failed"
    || ["past_due", "unpaid"].includes(subscriptionStatus)
  ) {
    status = "past_due";
  } else if (
    subscriptionStatus === "pending"
    || ["pending", "unknown"].includes(paymentStatus)
  ) {
    status = "pending_payment";
  } else if (
    ["active", "trialing"].includes(subscriptionStatus)
    && paymentStatus === "paid"
  ) {
    status = subscription.cancel_at_period_end === 1
      ? "cancel_at_period_end"
      : "active";
  } else {
    status = "revoked";
  }

  if (
    ["active", "cancel_at_period_end"].includes(status)
    && periodValidUntil
    && Date.parse(currentTime) >= Date.parse(periodValidUntil)
  ) {
    status = "expired";
  }

  const validUntil = status === "past_due"
    ? paymentFailureAt
    : periodValidUntil;
  const candidate = {
    status,
    validUntil,
    graceUntil: status === "past_due"
      ? addUtcDays(validUntil, PAYMENT_GRACE_DAYS)
      : null,
    source: "square"
  };
  const parsed = parseEntitlementSnapshot({
    ...createDefaultEntitlementSnapshot(currentTime),
    personal: candidate
  });
  return parsed?.personal || {
    status: "revoked",
    validUntil: null,
    graceUntil: null,
    source: "square"
  };
};

export const getActiveProSubscription = async (
  env,
  userId,
  currentTime = new Date().toISOString()
) => {
  const subscription = await getLatestProSubscription(env, userId);
  const paymentFailureAt = await getCurrentPaymentFailureAt(env, subscription);
  const entitlement = personalEntitlementFromSubscription(
    subscription,
    currentTime,
    paymentFailureAt
  );
  const snapshot = {
    ...createDefaultEntitlementSnapshot(currentTime),
    personal: entitlement
  };
  return canPerformOperation(snapshot, "create_review_plan", currentTime).allowed
    ? subscription
    : null;
};

export const resolvePersonalAccess = async (
  user,
  env,
  currentTime = new Date().toISOString()
) => {
  const subscription = user ? await getLatestProSubscription(env, user.id) : null;
  const operatorAccess = isOwnerTestUser(user, env);
  const paymentFailureAt = operatorAccess
    ? null
    : await getCurrentPaymentFailureAt(env, subscription);
  const entitlement = operatorAccess
    ? {
        status: "active",
        validUntil: null,
        graceUntil: null,
        source: "manual"
      }
    : personalEntitlementFromSubscription(
        subscription,
        currentTime,
        paymentFailureAt
      );
  const snapshot = {
    ...createDefaultEntitlementSnapshot(currentTime),
    personal: entitlement
  };
  const subscriptionActive = canPerformOperation(
    snapshot,
    "create_review_plan",
    currentTime
  ).allowed;

  return {
    tier: subscriptionActive ? "pro" : "free",
    source: subscriptionActive && entitlement.source === "square"
      ? "subscription"
      : operatorAccess
        ? "operator"
        : "anonymous",
    subscriptionActive,
    currentPeriodEnd: subscription?.current_period_end || null,
    cancelAtPeriodEnd: subscription?.cancel_at_period_end === 1,
    entitlement,
    snapshot
  };
};

export const getActiveHouseholdMembership = async (env, userId) => {
  if (!env?.DB || !userId || getHouseholdSharingMode(env) === "disabled") return null;
  return env.DB.prepare(
    `SELECT memberships.household_id,
            memberships.role,
            households.owner_user_id,
            households.status AS household_status,
            households.key_epoch,
            households.current_revision,
            households.created_at,
            households.updated_at,
            owners.google_sub AS owner_google_sub,
            owners.email_verified AS owner_email_verified
       FROM household_memberships AS memberships
       JOIN shared_households AS households
         ON households.id = memberships.household_id
       JOIN users AS owners
         ON owners.id = households.owner_user_id
      WHERE memberships.user_id = ?
        AND memberships.status = 'active'
        AND households.deleted_at IS NULL
        AND households.status IN ('active', 'read_only', 'deleting')
        AND owners.deleted_at IS NULL
      LIMIT 1`
  ).bind(userId).first();
};

const unavailableHouseholdAccess = (mode, currentTime) => ({
  mode,
  available: false,
  householdId: null,
  role: null,
  status: null,
  source: "none",
  effectiveTier: "free",
  readAllowed: false,
  writeAllowed: false,
  householdEntitlement: createDefaultEntitlementSnapshot(currentTime).household,
  snapshot: createDefaultEntitlementSnapshot(currentTime)
});

export const resolveHouseholdAccess = async (
  user,
  env,
  currentTime = new Date().toISOString()
) => {
  const mode = getHouseholdSharingMode(env);
  if (!user || mode === "disabled") {
    return unavailableHouseholdAccess(mode, currentTime);
  }

  const membership = await getActiveHouseholdMembership(env, user.id);
  if (!membership || !householdRoles.has(membership.role)) {
    return unavailableHouseholdAccess(mode, currentTime);
  }

  const owner = {
    id: membership.owner_user_id,
    googleSub: membership.owner_google_sub,
    emailVerified: membership.owner_email_verified === 1
  };
  const ownerAccess = await resolvePersonalAccess(owner, env, currentTime);
  const ownerProActive = ownerAccess.tier === "pro";
  const householdActive = membership.household_status === "active";
  const householdReadable = membership.household_status !== "deleting";
  const roleCanWrite = ["owner", "editor"].includes(membership.role);
  const retentionBaseUntil = ownerAccess.entitlement.status === "expired"
    ? ownerAccess.entitlement.validUntil
    : ownerAccess.entitlement.status === "past_due"
      ? ownerAccess.entitlement.graceUntil
      : null;
  const retentionUntil = ownerProActive
    ? null
    : addUtcDays(retentionBaseUntil, HOUSEHOLD_RETENTION_DAYS);
  const withinRetention = Boolean(
    retentionUntil
    && Date.parse(currentTime) < Date.parse(retentionUntil)
  );
  const readAllowed = householdReadable && (ownerProActive || withinRetention);
  const writeAllowed = roleCanWrite && ownerProActive && householdActive;
  const householdEntitlement = {
    householdId: membership.household_id,
    role: membership.role,
    status: membership.household_status,
    revision: membership.current_revision,
    revokedAt: null,
    readAllowed,
    writeAllowed,
    retentionUntil
  };
  const snapshot = {
    ...createDefaultEntitlementSnapshot(currentTime),
    household: householdEntitlement
  };

  return {
    mode,
    available: true,
    householdId: membership.household_id,
    role: membership.role,
    status: membership.household_status,
    keyEpoch: membership.key_epoch,
    currentRevision: membership.current_revision,
    createdAt: membership.created_at,
    updatedAt: membership.updated_at,
    source: ownerAccess.source === "subscription"
      ? "household-subscription"
      : ownerAccess.source === "operator"
        ? "household-operator"
        : "none",
    effectiveTier: ownerProActive ? "pro" : "free",
    readAllowed,
    writeAllowed,
    ownerProActive,
    retentionUntil,
    householdEntitlement,
    snapshot
  };
};

export const combineEntitlementSnapshot = (
  personalAccess,
  householdAccess,
  evaluatedAt
) => ({
  ...createDefaultEntitlementSnapshot(evaluatedAt),
  personal: personalAccess?.entitlement
    || createDefaultEntitlementSnapshot(evaluatedAt).personal,
  household: householdAccess?.householdEntitlement
    || createDefaultEntitlementSnapshot(evaluatedAt).household
});
