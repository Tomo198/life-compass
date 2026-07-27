import { getCurrentUser } from "./auth.js";
import { getHouseholdSharingMode, resolveHouseholdAccess } from "./access.js";
import { AuthError, parseBoundedJsonBody, sameOrigin } from "./security.js";

const MAX_SHARED_PLAN_BODY_BYTES = 7 * 1024 * 1024;
const MAX_SHARED_PLAN_CIPHERTEXT_BYTES = 5 * 1024 * 1024 + 16;
const MAX_REVISIONS = 10;
const MAX_OBJECT_CLEANUP_BATCH = 100;
const MAX_RETENTION_CLEANUP_HOUSEHOLDS = 100;
const FRESH_SESSION_MAX_AGE_SECONDS = 10 * 60;
const SHARED_PLAN_FORMAT = "life-compass-shared-plan";
const SHARED_PLAN_VERSION = 1;
const PBKDF2_ITERATIONS = 600_000;
const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/u;

const base64ByteLength = (value) => {
  try {
    return atob(value).length;
  } catch {
    return -1;
  }
};

const sha256Hex = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const requireConfigured = (env) => {
  if (getHouseholdSharingMode(env) === "disabled" || !env?.DB) {
    throw new AuthError(501, "household_sharing_disabled", "Household sharing is not enabled.");
  }
  if (!env?.SHARED_PLANS) {
    throw new AuthError(503, "shared_plan_storage_unavailable", "Shared plan storage is not configured.");
  }
};

const requireAccess = async (request, env, write = false) => {
  requireConfigured(env);
  const user = await getCurrentUser(request, env);
  if (!user) throw new AuthError(401, "authentication_required", "Google sign-in is required.");
  if (!user.emailVerified || !user.email) {
    throw new AuthError(403, "verified_email_required", "A verified Google email is required.");
  }

  const access = await resolveHouseholdAccess(user, env);
  if (!access.available || !access.readAllowed) {
    throw new AuthError(403, "household_access_denied", "Household access is not available.");
  }
  if (write && !access.writeAllowed) {
    throw new AuthError(403, "household_write_locked", "Shared plan updates are currently locked.");
  }
  return { user, access };
};

const requireRateLimit = async (request, user, env, action) => {
  const limiter = env?.HOUSEHOLD_RATE_LIMITER || env?.BACKUP_RATE_LIMITER || env?.AUTH_RATE_LIMITER;
  if (!limiter) return;
  const result = await limiter.limit({ key: `${action}:${request.method}:${user.id}` });
  if (!result.success) {
    throw new AuthError(429, "rate_limited", "Too many shared plan requests. Try again later.");
  }
};

const parseBody = (request) => parseBoundedJsonBody(request, {
  maxBytes: MAX_SHARED_PLAN_BODY_BYTES,
  tooLargeCode: "shared_plan_too_large",
  tooLargeMessage: "Encrypted shared plan is too large.",
  invalidMessage: "Shared plan request is invalid."
});

const normalizeEnvelope = (value, expected) => {
  const envelope = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const encryption = envelope.encryption && typeof envelope.encryption === "object"
    ? envelope.encryption
    : {};
  const keyDerivation = envelope.keyDerivation && typeof envelope.keyDerivation === "object"
    ? envelope.keyDerivation
    : {};
  if (
    envelope.format !== SHARED_PLAN_FORMAT
    || envelope.version !== SHARED_PLAN_VERSION
    || envelope.householdId !== expected.householdId
    || envelope.revision !== expected.revision
    || envelope.keyEpoch !== expected.keyEpoch
    || encryption.name !== "AES-GCM"
    || encryption.keyLength !== 256
    || typeof encryption.iv !== "string"
    || !base64Pattern.test(encryption.iv)
    || base64ByteLength(encryption.iv) !== 12
    || keyDerivation.name !== "PBKDF2"
    || keyDerivation.hash !== "SHA-256"
    || keyDerivation.iterations !== PBKDF2_ITERATIONS
    || typeof keyDerivation.salt !== "string"
    || !base64Pattern.test(keyDerivation.salt)
    || base64ByteLength(keyDerivation.salt) !== 16
    || typeof envelope.ciphertext !== "string"
    || !base64Pattern.test(envelope.ciphertext)
  ) {
    throw new AuthError(400, "invalid_shared_plan_envelope", "Encrypted shared plan format is invalid.");
  }

  const ciphertextBytes = base64ByteLength(envelope.ciphertext);
  if (ciphertextBytes < 17) {
    throw new AuthError(400, "invalid_shared_plan_envelope", "Encrypted shared plan format is invalid.");
  }
  if (ciphertextBytes > MAX_SHARED_PLAN_CIPHERTEXT_BYTES) {
    throw new AuthError(413, "shared_plan_too_large", "Encrypted shared plan is too large.");
  }

  return {
    format: SHARED_PLAN_FORMAT,
    version: SHARED_PLAN_VERSION,
    householdId: expected.householdId,
    revision: expected.revision,
    keyEpoch: expected.keyEpoch,
    encryption: { name: "AES-GCM", keyLength: 256, iv: encryption.iv },
    keyDerivation: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: PBKDF2_ITERATIONS,
      salt: keyDerivation.salt
    },
    ciphertext: envelope.ciphertext
  };
};

const publicRevision = (row) => row ? ({
  revision: Number(row.revision),
  keyEpoch: Number(row.key_epoch),
  planVersion: Number(row.plan_version),
  sizeBytes: Number(row.size_bytes),
  createdAt: row.created_at
}) : null;

const readRevisionRow = (env, householdId, revision) => env.DB.prepare(
  `SELECT household_id, revision, key_epoch, r2_object_key, envelope_version,
          plan_version, size_bytes, checksum_sha256, created_by, created_at
     FROM shared_plan_revisions
    WHERE household_id = ?
      AND revision = ?
    LIMIT 1`
).bind(householdId, revision).first();

const readEnvelope = async (env, row) => {
  const object = await env.SHARED_PLANS.get(row.r2_object_key);
  if (!object) throw new AuthError(404, "shared_plan_object_not_found", "Shared plan data not found.");
  if (typeof object.size === "number" && object.size > MAX_SHARED_PLAN_BODY_BYTES) {
    throw new AuthError(413, "shared_plan_too_large", "Encrypted shared plan is too large.");
  }

  const serialized = await object.text();
  if (new TextEncoder().encode(serialized).byteLength > MAX_SHARED_PLAN_BODY_BYTES) {
    throw new AuthError(413, "shared_plan_too_large", "Encrypted shared plan is too large.");
  }
  if (await sha256Hex(serialized) !== row.checksum_sha256) {
    throw new AuthError(409, "shared_plan_integrity_failed", "Shared plan integrity check failed.");
  }

  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new AuthError(409, "shared_plan_integrity_failed", "Shared plan integrity check failed.");
  }
  return normalizeEnvelope(parsed, {
    householdId: row.household_id,
    revision: Number(row.revision),
    keyEpoch: Number(row.key_epoch)
  });
};

const getCurrentPlan = async (request, env, jsonResponse) => {
  const { user, access } = await requireAccess(request, env);
  await requireRateLimit(request, user, env, "shared-plan-read");
  if (Number(access.currentRevision || 0) === 0) {
    return jsonResponse({
      ok: true,
      householdId: access.householdId,
      currentRevision: 0,
      keyEpoch: access.keyEpoch,
      revision: null,
      envelope: null
    });
  }

  const row = await readRevisionRow(env, access.householdId, access.currentRevision);
  if (!row) throw new AuthError(409, "shared_plan_metadata_missing", "Shared plan metadata is inconsistent.");
  return jsonResponse({
    ok: true,
    householdId: access.householdId,
    currentRevision: Number(access.currentRevision),
    keyEpoch: Number(access.keyEpoch),
    revision: publicRevision(row),
    envelope: await readEnvelope(env, row)
  });
};

const getRevision = async (request, env, revision, jsonResponse) => {
  const { user, access } = await requireAccess(request, env);
  await requireRateLimit(request, user, env, "shared-plan-revision-read");
  const row = await readRevisionRow(env, access.householdId, revision);
  if (!row) throw new AuthError(404, "shared_plan_revision_not_found", "Shared plan revision not found.");
  return jsonResponse({
    ok: true,
    householdId: access.householdId,
    currentRevision: Number(access.currentRevision),
    revision: publicRevision(row),
    envelope: await readEnvelope(env, row)
  });
};

const listRevisions = async (request, env, jsonResponse) => {
  const { user, access } = await requireAccess(request, env);
  await requireRateLimit(request, user, env, "shared-plan-revisions-list");
  const result = await env.DB.prepare(
    `SELECT revision, key_epoch, plan_version, size_bytes, created_by, created_at
       FROM shared_plan_revisions
      WHERE household_id = ?
      ORDER BY revision DESC
      LIMIT ?`
  ).bind(access.householdId, MAX_REVISIONS).all();
  return jsonResponse({
    ok: true,
    householdId: access.householdId,
    currentRevision: Number(access.currentRevision),
    revisions: (result.results || []).map(publicRevision),
    limit: MAX_REVISIONS
  });
};

const clearPendingObjectBestEffort = async (env, objectKey) => {
  try {
    await env.DB.prepare(
      `DELETE FROM shared_plan_object_cleanup
        WHERE r2_object_key = ?`
    ).bind(objectKey).run();
  } catch {
    console.error(JSON.stringify({
      event: "shared_plan_cleanup_marker_delete_failed"
    }));
  }
};

const deletePendingObjectBestEffort = async (env, objectKey, event) => {
  try {
    await env.SHARED_PLANS.delete(objectKey);
    await clearPendingObjectBestEffort(env, objectKey);
    return true;
  } catch {
    console.error(JSON.stringify({ event, objectCount: 1 }));
    return false;
  }
};

const cleanupOldRevisions = async (env, householdId) => {
  try {
    const result = await env.DB.prepare(
      `SELECT revision, r2_object_key
         FROM shared_plan_revisions
        WHERE household_id = ?
        ORDER BY revision DESC`
    ).bind(householdId).all();
    const stale = (result.results || []).slice(MAX_REVISIONS);
    if (stale.length === 0) return;

    for (const row of stale) {
      try {
        await env.SHARED_PLANS.delete(row.r2_object_key);
      } catch {
        console.error(JSON.stringify({
          event: "shared_plan_retention_object_cleanup_failed",
          objectCount: 1
        }));
        continue;
      }
      await env.DB.prepare(
        `DELETE FROM shared_plan_revisions
          WHERE household_id = ?
            AND revision = ?`
      ).bind(householdId, row.revision).run();
    }
  } catch {
    console.error(JSON.stringify({
      event: "shared_plan_retention_metadata_cleanup_failed"
    }));
  }
};

const cleanupExcessRevisions = async (env) => {
  try {
    const result = await env.DB.prepare(
      `SELECT household_id
         FROM shared_plan_revisions
        GROUP BY household_id
       HAVING COUNT(*) > ?
        ORDER BY household_id ASC
        LIMIT ?`
    ).bind(MAX_REVISIONS, MAX_RETENTION_CLEANUP_HOUSEHOLDS).all();

    for (const row of result.results || []) {
      await cleanupOldRevisions(env, row.household_id);
    }
  } catch {
    console.error(JSON.stringify({
      event: "shared_plan_retention_scan_failed"
    }));
  }
};

const savePlan = async (request, env, jsonResponse, rotateKey = false) => {
  if (!sameOrigin(request)) {
    throw new AuthError(403, "invalid_origin", "Shared plan request origin is invalid.");
  }
  const { user, access } = await requireAccess(request, env, !rotateKey);
  await requireRateLimit(request, user, env, rotateKey ? "shared-plan-rotate-key" : "shared-plan-save");
  if (rotateKey) {
    const now = Math.floor(Date.now() / 1000);
    if (access.role !== "owner") {
      throw new AuthError(403, "household_owner_required", "Only the household owner can change the shared key.");
    }
    if (!access.ownerProActive) {
      throw new AuthError(403, "pro_required", "An active Pro subscription is required to change the shared key.");
    }
    if (!user.sessionCreatedAt || now - user.sessionCreatedAt > FRESH_SESSION_MAX_AGE_SECONDS) {
      throw new AuthError(401, "fresh_authentication_required", "Sign out and sign in again before changing the shared key.");
    }
  }
  const body = await parseBody(request);
  const expectedRevision = Number(body.expectedRevision);
  const planVersion = Number(body.planVersion);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new AuthError(400, "invalid_expected_revision", "Expected revision is invalid.");
  }
  if (!Number.isInteger(planVersion) || planVersion < 1 || planVersion > 1000) {
    throw new AuthError(400, "invalid_plan_version", "Plan version is invalid.");
  }
  if (expectedRevision !== Number(access.currentRevision)) {
    throw new AuthError(409, "shared_plan_conflict", "Another device or household member updated the shared plan.");
  }

  const revision = expectedRevision + 1;
  const previousKeyEpoch = Number(access.keyEpoch);
  const keyEpoch = rotateKey && access.status === "active"
    ? previousKeyEpoch + 1
    : previousKeyEpoch;
  const envelope = normalizeEnvelope(body.envelope, {
    householdId: access.householdId,
    revision,
    keyEpoch
  });
  const serialized = JSON.stringify(envelope);
  const sizeBytes = new TextEncoder().encode(serialized).byteLength;
  if (sizeBytes > MAX_SHARED_PLAN_BODY_BYTES) {
    throw new AuthError(413, "shared_plan_too_large", "Encrypted shared plan is too large.");
  }

  const objectKey = `households/${access.householdId}/revisions/${revision}-${crypto.randomUUID()}.json`;
  const checksum = await sha256Hex(serialized);
  await env.DB.prepare(
    `INSERT INTO shared_plan_object_cleanup
      (r2_object_key, household_id, revision)
     VALUES (?, ?, ?)`
  ).bind(objectKey, access.householdId, revision).run();
  try {
    await env.SHARED_PLANS.put(objectKey, serialized, {
      httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: "no-store" },
      customMetadata: {
        format: SHARED_PLAN_FORMAT,
        version: String(SHARED_PLAN_VERSION),
        revision: String(revision),
        keyEpoch: String(keyEpoch)
      }
    });
  } catch (error) {
    await clearPendingObjectBestEffort(env, objectKey);
    throw error;
  }

  let results;
  try {
    const updateHousehold = rotateKey
      ? env.DB.prepare(
        `UPDATE shared_households
            SET current_revision = ?,
                key_epoch = ?,
                status = 'active',
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND owner_user_id = ?
            AND status = ?
            AND key_epoch = ?
            AND current_revision = ?
            AND deleted_at IS NULL
            AND EXISTS (
              SELECT 1
                FROM household_memberships
               WHERE household_id = shared_households.id
                 AND user_id = ?
                 AND role = 'owner'
                 AND status = 'active'
            )`
      ).bind(
        revision,
        keyEpoch,
        access.householdId,
        user.id,
        access.status,
        previousKeyEpoch,
        expectedRevision,
        user.id
      )
      : env.DB.prepare(
        `UPDATE shared_households
            SET current_revision = ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND status = 'active'
            AND key_epoch = ?
            AND current_revision = ?
            AND deleted_at IS NULL
            AND EXISTS (
              SELECT 1
                FROM household_memberships
               WHERE household_id = shared_households.id
                 AND user_id = ?
                 AND status = 'active'
            )`
      ).bind(revision, access.householdId, keyEpoch, expectedRevision, user.id);
    results = await env.DB.batch([
      updateHousehold,
      env.DB.prepare(
        `INSERT INTO shared_plan_revisions
          (household_id, revision, key_epoch, r2_object_key, envelope_version,
           plan_version, size_bytes, checksum_sha256, created_by)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1
              FROM shared_households AS households
              JOIN household_memberships AS memberships
                ON memberships.household_id = households.id
             WHERE households.id = ?
               AND households.status = 'active'
               AND households.key_epoch = ?
               AND households.current_revision = ?
               AND households.deleted_at IS NULL
               AND memberships.user_id = ?
               AND memberships.status = 'active'
          )`
      ).bind(
        access.householdId,
        revision,
        keyEpoch,
        objectKey,
        SHARED_PLAN_VERSION,
        planVersion,
        sizeBytes,
        checksum,
        user.id,
        access.householdId,
        keyEpoch,
        revision,
        user.id
      ),
      env.DB.prepare(
        `INSERT INTO household_audit_events
          (id, household_id, actor_user_id, event_type, revision)
         SELECT ?, ?, ?, 'saved', ?
          WHERE EXISTS (
            SELECT 1
              FROM shared_plan_revisions
             WHERE household_id = ?
               AND revision = ?
               AND created_by = ?
          )`
      ).bind(
        crypto.randomUUID(),
        access.householdId,
        user.id,
        revision,
        access.householdId,
        revision,
        user.id
      )
    ]);
  } catch (error) {
    await deletePendingObjectBestEffort(env, objectKey, "shared_plan_rollback_cleanup_failed");
    if (/constraint|unique/iu.test(error instanceof Error ? error.message : "")) {
      throw new AuthError(409, "shared_plan_conflict", "Another device or household member updated the shared plan.");
    }
    throw error;
  }

  if (
    Number(results?.[0]?.meta?.changes || 0) !== 1
    || Number(results?.[1]?.meta?.changes || 0) !== 1
  ) {
    await deletePendingObjectBestEffort(env, objectKey, "shared_plan_conflict_cleanup_failed");
    throw new AuthError(409, "shared_plan_conflict", "Another device or household member updated the shared plan.");
  }

  await clearPendingObjectBestEffort(env, objectKey);
  await cleanupOldRevisions(env, access.householdId);
  const row = await readRevisionRow(env, access.householdId, revision);
  return jsonResponse({
    ok: true,
    householdId: access.householdId,
    currentRevision: revision,
    keyEpoch,
    revision: publicRevision(row)
  }, 201);
};

export const cleanupPendingSharedPlanObjects = async (env) => {
  if (!env?.DB || !env?.SHARED_PLANS) return;
  const result = await env.DB.prepare(
    `SELECT cleanup.r2_object_key
       FROM shared_plan_object_cleanup AS cleanup
      WHERE cleanup.created_at <= datetime('now', '-15 minutes')
      ORDER BY cleanup.created_at ASC
      LIMIT ?`
  ).bind(MAX_OBJECT_CLEANUP_BATCH).all();

  for (const row of result.results || []) {
    const referenced = await env.DB.prepare(
      `SELECT 1 AS referenced
         FROM shared_plan_revisions
        WHERE r2_object_key = ?
        LIMIT 1`
    ).bind(row.r2_object_key).first();
    if (referenced) {
      await clearPendingObjectBestEffort(env, row.r2_object_key);
      continue;
    }
    await deletePendingObjectBestEffort(
      env,
      row.r2_object_key,
      "shared_plan_scheduled_object_cleanup_failed"
    );
  }

  await cleanupExcessRevisions(env);
};

export const handleSharedPlanRequest = async (request, env, jsonResponse) => {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/shared-household/plan/rotate-key") {
    if (request.method === "PUT") return savePlan(request, env, jsonResponse, true);
    throw new AuthError(405, "method_not_allowed", "Shared plan key endpoint does not support this method.");
  }
  if (pathname === "/api/shared-household/plan") {
    if (request.method === "GET") return getCurrentPlan(request, env, jsonResponse);
    if (request.method === "PUT") return savePlan(request, env, jsonResponse);
    throw new AuthError(405, "method_not_allowed", "Shared plan endpoint does not support this method.");
  }
  if (pathname === "/api/shared-household/revisions") {
    if (request.method === "GET") return listRevisions(request, env, jsonResponse);
    throw new AuthError(405, "method_not_allowed", "Shared plan revisions endpoint does not support this method.");
  }

  const revisionMatch = pathname.match(/^\/api\/shared-household\/revisions\/([1-9][0-9]{0,8})$/u);
  if (revisionMatch) {
    if (request.method === "GET") {
      return getRevision(request, env, Number(revisionMatch[1]), jsonResponse);
    }
    throw new AuthError(405, "method_not_allowed", "Shared plan revision endpoint does not support this method.");
  }

  throw new AuthError(404, "shared_plan_endpoint_not_found", "Shared plan endpoint not found.");
};
