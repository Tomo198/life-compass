const normalizeSubject = (value) => typeof value === "string" ? value.trim() : "";
const HOUSEHOLD_RETENTION_DAYS = 90;

const addUtcDays = (value, days) => {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const getLatestProPeriodEnd = async (env, userId) => {
  if (!env?.DB || !userId) return null;
  const subscription = await env.DB.prepare(
    `SELECT current_period_end
       FROM subscriptions
      WHERE user_id = ?
        AND tier = 'pro'
        AND current_period_end IS NOT NULL
      ORDER BY date(current_period_end) DESC, updated_at DESC
      LIMIT 1`
  ).bind(userId).first();
  return subscription?.current_period_end || null;
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

export const getActiveProSubscription = async (env, userId) => {
  if (!env?.DB || !userId) return null;
  return env.DB.prepare(
    `SELECT tier, status, payment_status, current_period_end, cancel_at_period_end
       FROM subscriptions
      WHERE user_id = ?
        AND tier = 'pro'
        AND status IN ('active', 'trialing')
        AND payment_status = 'paid'
        AND date(current_period_end) >= date('now')
      ORDER BY updated_at DESC
      LIMIT 1`
  ).bind(userId).first();
};

export const resolvePersonalAccess = async (user, env) => {
  const subscription = user ? await getActiveProSubscription(env, user.id) : null;
  const operatorAccess = isOwnerTestUser(user, env);
  const subscriptionActive = Boolean(subscription);

  return {
    tier: subscriptionActive || operatorAccess ? "pro" : "free",
    source: subscriptionActive ? "subscription" : operatorAccess ? "operator" : "anonymous",
    subscriptionActive,
    currentPeriodEnd: subscription?.current_period_end || null,
    cancelAtPeriodEnd: subscription?.cancel_at_period_end === 1
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

export const resolveHouseholdAccess = async (user, env) => {
  const mode = getHouseholdSharingMode(env);
  if (!user || mode === "disabled") {
    return {
      mode,
      available: false,
      householdId: null,
      role: null,
      status: null,
      source: "none",
      effectiveTier: "free",
      readAllowed: false,
      writeAllowed: false
    };
  }

  const membership = await getActiveHouseholdMembership(env, user.id);
  if (!membership) {
    return {
      mode,
      available: false,
      householdId: null,
      role: null,
      status: null,
      source: "none",
      effectiveTier: "free",
      readAllowed: false,
      writeAllowed: false
    };
  }

  const owner = {
    id: membership.owner_user_id,
    googleSub: membership.owner_google_sub,
    emailVerified: membership.owner_email_verified === 1
  };
  const ownerAccess = await resolvePersonalAccess(owner, env);
  const ownerProActive = ownerAccess.tier === "pro";
  const householdActive = membership.household_status === "active";
  const householdReadable = membership.household_status !== "deleting";
  const latestPeriodEnd = ownerProActive
    ? ownerAccess.currentPeriodEnd
    : await getLatestProPeriodEnd(env, owner.id);
  const retentionUntil = ownerProActive
    ? null
    : addUtcDays(latestPeriodEnd, HOUSEHOLD_RETENTION_DAYS);
  const withinRetention = Boolean(
    retentionUntil
    && retentionUntil >= new Date().toISOString().slice(0, 10)
  );

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
    readAllowed: householdReadable && (ownerProActive || withinRetention),
    writeAllowed: ownerProActive && householdActive,
    ownerProActive,
    retentionUntil
  };
};
