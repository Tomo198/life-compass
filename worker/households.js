import { AuthError, getCurrentUser } from "./auth.js";
import {
  getActiveHouseholdMembership,
  getHouseholdSharingMode,
  isOwnerTestUser,
  resolveHouseholdAccess,
  resolvePersonalAccess
} from "./access.js";

const MAX_BODY_BYTES = 4 * 1024;
const INVITATION_TTL_SECONDS = 24 * 60 * 60;
const FRESH_SESSION_MAX_AGE_SECONDS = 10 * 60;
const inviteTokenPattern = /^[A-Za-z0-9_-]{40,128}$/u;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

const base64Url = (bytes) => {
  let binary = "";
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

const randomToken = (length = 32) => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
};

const sha256 = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
};

const emailHmac = async (email, pepper) => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(email));
  return base64Url(new Uint8Array(signature));
};

const constantTimeEqual = (left, right) => {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

const sameOrigin = (request) => request.headers.get("Origin") === new URL(request.url).origin;

const readBodyWithLimit = async (request, limit) => {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > limit) {
      await reader.cancel();
      throw new AuthError(413, "request_too_large", "Household request is too large.");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  chunks.forEach((chunk) => {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return new TextDecoder().decode(body);
};

const parseJsonBody = async (request) => {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new AuthError(415, "unsupported_media_type", "JSON request body required.");
  }

  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    throw new AuthError(413, "request_too_large", "Household request is too large.");
  }

  const text = await readBodyWithLimit(request, MAX_BODY_BYTES);

  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid");
    return body;
  } catch {
    throw new AuthError(400, "invalid_json", "Household request is invalid.");
  }
};

const requireSharingEnabled = (env) => {
  const mode = getHouseholdSharingMode(env);
  if (!env?.DB || mode === "disabled") {
    throw new AuthError(501, "household_sharing_disabled", "Household sharing is not enabled.");
  }
  return mode;
};

const requireSameOrigin = (request) => {
  if (!sameOrigin(request)) {
    throw new AuthError(403, "invalid_origin", "Household request origin is invalid.");
  }
};

const requireUser = async (request, env) => {
  const user = await getCurrentUser(request, env);
  if (!user) throw new AuthError(401, "authentication_required", "Google sign-in is required.");
  if (!user.emailVerified || !user.email) {
    throw new AuthError(403, "verified_email_required", "A verified Google email is required.");
  }
  return user;
};

const requireFreshUser = async (request, env) => {
  const user = await requireUser(request, env);
  const now = Math.floor(Date.now() / 1000);
  if (!user.sessionCreatedAt || now - user.sessionCreatedAt > FRESH_SESSION_MAX_AGE_SECONDS) {
    throw new AuthError(401, "fresh_authentication_required", "Sign out and sign in again before changing household access.");
  }
  return user;
};

const requireRateLimit = async (request, user, env, action) => {
  const limiter = env?.HOUSEHOLD_RATE_LIMITER || env?.AUTH_RATE_LIMITER;
  if (!limiter) return;
  const result = await limiter.limit({ key: `${action}:${request.method}:${user.id}` });
  if (!result.success) {
    throw new AuthError(429, "rate_limited", "Too many household requests. Try again later.");
  }
};

const requireInvitePepper = (env) => {
  const pepper = typeof env?.HOUSEHOLD_INVITE_PEPPER === "string"
    ? env.HOUSEHOLD_INVITE_PEPPER
    : "";
  if (pepper.length < 32) {
    throw new AuthError(501, "household_invites_not_configured", "Household invitations are not configured.");
  }
  return pepper;
};

const normalizeEmail = (value) => typeof value === "string" ? value.trim().toLowerCase() : "";

const requireMembership = async (user, env) => {
  const access = await resolveHouseholdAccess(user, env);
  if (!access.available || !access.readAllowed) {
    throw new AuthError(403, "household_access_denied", "Household access is not available.");
  }
  return access;
};

const requireOwner = async (user, env) => {
  const access = await requireMembership(user, env);
  if (access.role !== "owner") {
    throw new AuthError(403, "household_owner_required", "Only the household owner can perform this action.");
  }
  return access;
};

const countActiveMembers = async (env, householdId) => {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count
       FROM household_memberships
      WHERE household_id = ?
        AND status = 'active'`
  ).bind(householdId).first();
  return Number(row?.count || 0);
};

const publicHousehold = async (user, env) => {
  const access = await resolveHouseholdAccess(user, env);
  if (!access.available) return null;
  return {
    id: access.householdId,
    role: access.role,
    status: access.status,
    keyEpoch: access.keyEpoch,
    currentRevision: access.currentRevision,
    memberCount: await countActiveMembers(env, access.householdId),
    readAllowed: access.readAllowed,
    writeAllowed: access.writeAllowed,
    ownerProActive: access.ownerProActive,
    createdAt: access.createdAt,
    updatedAt: access.updatedAt
  };
};

const getHouseholdResponse = async (request, env, jsonResponse) => {
  const mode = requireSharingEnabled(env);
  const user = await requireUser(request, env);
  await requireRateLimit(request, user, env, "household-read");
  const household = await publicHousehold(user, env);
  if (mode === "preview" && !household && !isOwnerTestUser(user, env)) {
    throw new AuthError(403, "household_preview_not_allowed", "Household sharing preview is not available.");
  }
  const personalAccess = await resolvePersonalAccess(user, env);
  return jsonResponse({
    ok: true,
    mode,
    household,
    canCreate: !household
      && personalAccess.tier === "pro"
      && (mode === "enforced" || isOwnerTestUser(user, env))
  });
};

const createHousehold = async (request, env, jsonResponse) => {
  const mode = requireSharingEnabled(env);
  requireSameOrigin(request);
  const user = await requireFreshUser(request, env);
  await requireRateLimit(request, user, env, "household-create");
  if (mode === "preview" && !isOwnerTestUser(user, env)) {
    throw new AuthError(403, "household_preview_not_allowed", "Household sharing preview is limited to the test owner.");
  }

  const body = await parseJsonBody(request);
  if (body.confirmation !== "CREATE_SHARED_HOUSEHOLD") {
    throw new AuthError(400, "household_creation_not_confirmed", "Household creation was not confirmed.");
  }

  const personalAccess = await resolvePersonalAccess(user, env);
  if (personalAccess.tier !== "pro") {
    throw new AuthError(403, "pro_required", "An active Pro subscription is required to create a shared household.");
  }
  if (await getActiveHouseholdMembership(env, user.id)) {
    throw new AuthError(409, "active_household_exists", "This account already belongs to a shared household.");
  }

  const householdId = crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO shared_households
          (id, owner_user_id, status, key_epoch, current_revision)
         VALUES (?, ?, 'active', 1, 0)`
      ).bind(householdId, user.id),
      env.DB.prepare(
        `INSERT INTO household_memberships
          (id, household_id, user_id, role, status)
         VALUES (?, ?, ?, 'owner', 'active')`
      ).bind(crypto.randomUUID(), householdId, user.id),
      env.DB.prepare(
        `INSERT INTO household_audit_events
          (id, household_id, actor_user_id, event_type)
         VALUES (?, ?, ?, 'created')`
      ).bind(crypto.randomUUID(), householdId, user.id)
    ]);
  } catch (error) {
    if (/constraint|unique/iu.test(error instanceof Error ? error.message : "")) {
      throw new AuthError(409, "active_household_exists", "This account already belongs to a shared household.");
    }
    throw error;
  }

  return jsonResponse({ ok: true, household: await publicHousehold(user, env) }, 201);
};

const createInvitation = async (request, env, jsonResponse) => {
  requireSharingEnabled(env);
  requireSameOrigin(request);
  const user = await requireFreshUser(request, env);
  await requireRateLimit(request, user, env, "household-invite");
  const access = await requireOwner(user, env);
  if (!access.writeAllowed) {
    throw new AuthError(403, "household_write_locked", "An active owner Pro subscription is required to invite a household member.");
  }
  if (await countActiveMembers(env, access.householdId) >= 2) {
    throw new AuthError(409, "household_member_limit", "This household already has the maximum number of members.");
  }

  const body = await parseJsonBody(request);
  const inviteeEmail = normalizeEmail(body.email);
  if (!emailPattern.test(inviteeEmail) || inviteeEmail.length > 254) {
    throw new AuthError(400, "invalid_invitee_email", "Enter a valid Google account email.");
  }
  if (inviteeEmail === normalizeEmail(user.email)) {
    throw new AuthError(400, "cannot_invite_self", "Invite a different Google account.");
  }

  const pepper = requireInvitePepper(env);
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const inviteeEmailHmac = await emailHmac(inviteeEmail, pepper);
  const invitationId = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + INVITATION_TTL_SECONDS;

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE household_invitations
          SET revoked_at = CURRENT_TIMESTAMP
        WHERE household_id = ?
          AND accepted_at IS NULL
          AND revoked_at IS NULL`
    ).bind(access.householdId),
    env.DB.prepare(
      `INSERT INTO household_invitations
        (id, household_id, created_by, token_hash, invitee_email_hmac, role, expires_at)
       VALUES (?, ?, ?, ?, ?, 'editor', ?)`
    ).bind(
      invitationId,
      access.householdId,
      user.id,
      tokenHash,
      inviteeEmailHmac,
      expiresAt
    ),
    env.DB.prepare(
      `INSERT INTO household_audit_events
        (id, household_id, actor_user_id, event_type)
       VALUES (?, ?, ?, 'invited')`
    ).bind(crypto.randomUUID(), access.householdId, user.id)
  ]);

  const inviteUrl = new URL(request.url);
  inviteUrl.pathname = "/";
  inviteUrl.search = "";
  inviteUrl.hash = `/household-invite/${token}`;
  return jsonResponse({
    ok: true,
    invitation: {
      id: invitationId,
      inviteUrl: inviteUrl.toString(),
      expiresAt: new Date(expiresAt * 1000).toISOString()
    }
  }, 201);
};

const revokeInvitation = async (request, env, invitationId, jsonResponse) => {
  requireSharingEnabled(env);
  requireSameOrigin(request);
  const user = await requireFreshUser(request, env);
  await requireRateLimit(request, user, env, "household-invite-revoke");
  const access = await requireOwner(user, env);

  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE household_invitations
          SET revoked_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND household_id = ?
          AND accepted_at IS NULL
          AND revoked_at IS NULL`
    ).bind(invitationId, access.householdId),
    env.DB.prepare(
      `INSERT INTO household_audit_events
        (id, household_id, actor_user_id, event_type)
       SELECT ?, ?, ?, 'invitation_revoked'
        WHERE EXISTS (
          SELECT 1
            FROM household_invitations
           WHERE id = ?
             AND household_id = ?
             AND revoked_at IS NOT NULL
        )`
    ).bind(
      crypto.randomUUID(),
      access.householdId,
      user.id,
      invitationId,
      access.householdId
    )
  ]);
  if (Number(results?.[0]?.meta?.changes || 0) !== 1) {
    throw new AuthError(404, "invitation_not_found", "Invitation not found.");
  }
  return jsonResponse({ ok: true, invitationRevoked: true });
};

const acceptInvitation = async (request, env, jsonResponse) => {
  requireSharingEnabled(env);
  requireSameOrigin(request);
  const user = await requireUser(request, env);
  await requireRateLimit(request, user, env, "household-invite-accept");
  const body = await parseJsonBody(request);
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!inviteTokenPattern.test(token)) {
    throw new AuthError(400, "invalid_invitation", "Invitation is invalid or expired.");
  }
  if (await getActiveHouseholdMembership(env, user.id)) {
    throw new AuthError(409, "active_household_exists", "This account already belongs to a shared household.");
  }

  const tokenHash = await sha256(token);
  const invitation = await env.DB.prepare(
    `SELECT invitations.id,
            invitations.household_id,
            invitations.invitee_email_hmac,
            invitations.expires_at
       FROM household_invitations AS invitations
       JOIN shared_households AS households
         ON households.id = invitations.household_id
      WHERE invitations.token_hash = ?
        AND invitations.accepted_at IS NULL
        AND invitations.revoked_at IS NULL
        AND invitations.expires_at > unixepoch()
        AND households.deleted_at IS NULL
        AND households.status = 'active'
      LIMIT 1`
  ).bind(tokenHash).first();
  if (!invitation) {
    throw new AuthError(400, "invalid_invitation", "Invitation is invalid or expired.");
  }

  const expectedEmailHmac = await emailHmac(normalizeEmail(user.email), requireInvitePepper(env));
  if (!constantTimeEqual(expectedEmailHmac, invitation.invitee_email_hmac)) {
    throw new AuthError(400, "invalid_invitation", "Invitation is invalid or expired.");
  }

  const membershipId = crypto.randomUUID();
  let results;
  try {
    results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO household_memberships
          (id, household_id, user_id, role, status)
         SELECT ?, invitations.household_id, ?, 'editor', 'active'
           FROM household_invitations AS invitations
           JOIN shared_households AS households
             ON households.id = invitations.household_id
          WHERE invitations.id = ?
            AND invitations.token_hash = ?
            AND invitations.invitee_email_hmac = ?
            AND invitations.accepted_at IS NULL
            AND invitations.revoked_at IS NULL
            AND invitations.expires_at > unixepoch()
            AND households.deleted_at IS NULL
            AND households.status = 'active'
            AND (
              SELECT COUNT(*)
                FROM household_memberships
               WHERE household_id = invitations.household_id
                 AND status = 'active'
            ) < 2
            AND NOT EXISTS (
              SELECT 1
                FROM household_memberships
               WHERE user_id = ?
                 AND status = 'active'
            )`
      ).bind(
        membershipId,
        user.id,
        invitation.id,
        tokenHash,
        expectedEmailHmac,
        user.id
      ),
      env.DB.prepare(
        `UPDATE household_invitations
            SET accepted_at = CURRENT_TIMESTAMP,
                accepted_by = ?
          WHERE id = ?
            AND accepted_at IS NULL
            AND revoked_at IS NULL
            AND expires_at > unixepoch()
            AND EXISTS (
              SELECT 1
                FROM household_memberships
               WHERE household_id = household_invitations.household_id
                 AND user_id = ?
                 AND status = 'active'
            )`
      ).bind(user.id, invitation.id, user.id),
      env.DB.prepare(
        `INSERT INTO household_audit_events
          (id, household_id, actor_user_id, event_type)
         SELECT ?, household_id, ?, 'joined'
           FROM household_invitations
          WHERE id = ?
            AND accepted_by = ?
            AND accepted_at IS NOT NULL`
      ).bind(crypto.randomUUID(), user.id, invitation.id, user.id)
    ]);
  } catch (error) {
    if (/constraint|unique/iu.test(error instanceof Error ? error.message : "")) {
      throw new AuthError(409, "invitation_unavailable", "Invitation can no longer be accepted.");
    }
    throw error;
  }

  if (Number(results?.[0]?.meta?.changes || 0) !== 1) {
    throw new AuthError(409, "invitation_unavailable", "Invitation can no longer be accepted.");
  }
  return jsonResponse({ ok: true, household: await publicHousehold(user, env) });
};

const removeMember = async (request, env, memberUserId, jsonResponse) => {
  requireSharingEnabled(env);
  requireSameOrigin(request);
  const user = await requireFreshUser(request, env);
  await requireRateLimit(request, user, env, "household-member-remove");
  const access = await requireOwner(user, env);
  if (memberUserId === user.id) {
    throw new AuthError(400, "cannot_remove_owner", "The owner cannot be removed from the household.");
  }

  const member = await env.DB.prepare(
    `SELECT user_id, role
       FROM household_memberships
      WHERE household_id = ?
        AND user_id = ?
        AND status = 'active'
      LIMIT 1`
  ).bind(access.householdId, memberUserId).first();
  if (!member || member.role !== "editor") {
    throw new AuthError(404, "household_member_not_found", "Household member not found.");
  }

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE household_memberships
          SET status = 'revoked',
              revoked_at = CURRENT_TIMESTAMP
        WHERE household_id = ?
          AND user_id = ?
          AND role = 'editor'
          AND status = 'active'`
    ).bind(access.householdId, memberUserId),
    env.DB.prepare(
      `UPDATE shared_households
          SET status = 'read_only',
              key_epoch = key_epoch + 1,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND deleted_at IS NULL`
    ).bind(access.householdId),
    env.DB.prepare(
      `INSERT INTO household_audit_events
        (id, household_id, actor_user_id, event_type)
       VALUES (?, ?, ?, 'removed')`
    ).bind(crypto.randomUUID(), access.householdId, user.id)
  ]);

  return jsonResponse({ ok: true, memberRemoved: true, requiresKeyRotation: true });
};

const leaveHousehold = async (request, env, jsonResponse) => {
  requireSharingEnabled(env);
  requireSameOrigin(request);
  const user = await requireUser(request, env);
  await requireRateLimit(request, user, env, "household-leave");
  const access = await requireMembership(user, env);
  if (access.role === "owner") {
    throw new AuthError(409, "owner_cannot_leave", "Delete the shared household before leaving as owner.");
  }

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE household_memberships
          SET status = 'left',
              revoked_at = CURRENT_TIMESTAMP
        WHERE household_id = ?
          AND user_id = ?
          AND role = 'editor'
          AND status = 'active'`
    ).bind(access.householdId, user.id),
    env.DB.prepare(
      `UPDATE shared_households
          SET status = 'read_only',
              key_epoch = key_epoch + 1,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND deleted_at IS NULL`
    ).bind(access.householdId),
    env.DB.prepare(
      `INSERT INTO household_audit_events
        (id, household_id, actor_user_id, event_type)
       VALUES (?, ?, ?, 'left')`
    ).bind(crypto.randomUUID(), access.householdId, user.id)
  ]);
  return jsonResponse({ ok: true, leftHousehold: true });
};

const deleteHousehold = async (request, env, jsonResponse) => {
  requireSharingEnabled(env);
  requireSameOrigin(request);
  const user = await requireFreshUser(request, env);
  await requireRateLimit(request, user, env, "household-delete");
  const access = await requireOwner(user, env);
  const body = await parseJsonBody(request);
  if (body.confirmation !== "DELETE_SHARED_HOUSEHOLD") {
    throw new AuthError(400, "household_deletion_not_confirmed", "Household deletion was not confirmed.");
  }

  const revisions = await env.DB.prepare(
    `SELECT COUNT(*) AS count
       FROM shared_plan_revisions
      WHERE household_id = ?`
  ).bind(access.householdId).first();
  if (Number(revisions?.count || 0) > 0) {
    throw new AuthError(
      409,
      "shared_plan_deletion_not_ready",
      "Delete encrypted shared plan revisions before deleting the household."
    );
  }

  await env.DB.prepare(
    `DELETE FROM shared_households
      WHERE id = ?
        AND owner_user_id = ?`
  ).bind(access.householdId, user.id).run();
  return jsonResponse({ ok: true, householdDeleted: true });
};

export const handleHouseholdRequest = async (request, env, jsonResponse) => {
  const pathname = new URL(request.url).pathname;

  if (pathname === "/api/shared-household") {
    if (request.method === "GET") return getHouseholdResponse(request, env, jsonResponse);
    if (request.method === "POST") return createHousehold(request, env, jsonResponse);
    if (request.method === "DELETE") return deleteHousehold(request, env, jsonResponse);
    throw new AuthError(405, "method_not_allowed", "Household endpoint does not support this method.");
  }

  if (pathname === "/api/shared-household/invitations") {
    if (request.method === "POST") return createInvitation(request, env, jsonResponse);
    throw new AuthError(405, "method_not_allowed", "Invitation endpoint does not support this method.");
  }

  if (pathname === "/api/shared-household/invitations/accept") {
    if (request.method === "POST") return acceptInvitation(request, env, jsonResponse);
    throw new AuthError(405, "method_not_allowed", "Invitation endpoint does not support this method.");
  }

  const invitationMatch = pathname.match(/^\/api\/shared-household\/invitations\/([0-9a-f-]{36})$/u);
  if (invitationMatch) {
    if (request.method === "DELETE") {
      return revokeInvitation(request, env, invitationMatch[1], jsonResponse);
    }
    throw new AuthError(405, "method_not_allowed", "Invitation endpoint does not support this method.");
  }

  const memberMatch = pathname.match(/^\/api\/shared-household\/members\/([0-9a-f-]{36})$/u);
  if (memberMatch) {
    if (request.method === "DELETE") {
      return removeMember(request, env, memberMatch[1], jsonResponse);
    }
    throw new AuthError(405, "method_not_allowed", "Household member endpoint does not support this method.");
  }

  if (pathname === "/api/shared-household/leave") {
    if (request.method === "POST") return leaveHousehold(request, env, jsonResponse);
    throw new AuthError(405, "method_not_allowed", "Household endpoint does not support this method.");
  }

  throw new AuthError(404, "household_endpoint_not_found", "Household endpoint not found.");
};
