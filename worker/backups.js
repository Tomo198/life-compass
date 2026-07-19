import { AuthError, getCurrentUser } from "./auth.js";
import { isOwnerTestUser } from "./access.js";

const MAX_BACKUP_BODY_BYTES = 7 * 1024 * 1024;
const MAX_BACKUPS_PER_USER = 5;
const BACKUP_FORMAT = "life-compass-encrypted-backup";
const BACKUP_VERSION = 1;
const PBKDF2_ITERATIONS = 600_000;
const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/u;

const base64ByteLength = (value) => {
  try {
    return atob(value).length;
  } catch {
    return -1;
  }
};

const sameOrigin = (request) => request.headers.get("Origin") === new URL(request.url).origin;

const requireUser = async (request, env) => {
  const user = await getCurrentUser(request, env);
  if (!user) throw new AuthError(401, "authentication_required", "Google sign-in is required.");
  return user;
};

const backupMode = (env) => ["preview", "enforced"].includes(env?.CLOUD_BACKUP_MODE) ? env.CLOUD_BACKUP_MODE : "disabled";

const requireBackupReadAccess = (user, env) => {
  const mode = backupMode(env);
  if (mode === "preview") {
    if (isOwnerTestUser(user, env)) return;
    throw new AuthError(403, "backup_preview_not_allowed", "Encrypted cloud backup preview is limited to test users.");
  }
  if (mode !== "enforced") {
    throw new AuthError(501, "cloud_backup_disabled", "Encrypted cloud backup is not enabled.");
  }
};

const requireBackupWriteAccess = async (user, env) => {
  requireBackupReadAccess(user, env);
  if (backupMode(env) === "preview" || isOwnerTestUser(user, env)) return;
  const subscription = await env.DB.prepare(
    `SELECT status
       FROM subscriptions
      WHERE user_id = ?
        AND tier = 'pro'
        AND status IN ('active', 'trialing')
        AND payment_status = 'paid'
        AND date(current_period_end) >= date('now')
      LIMIT 1`
  ).bind(user.id).first();
  if (!subscription) throw new AuthError(403, "pro_required", "An active Pro subscription is required.");
};

const requireBackupRateLimit = async (request, user, env) => {
  if (!env?.BACKUP_RATE_LIMITER) return;
  const result = await env.BACKUP_RATE_LIMITER.limit({ key: `${request.method}:${user.id}` });
  if (!result.success) throw new AuthError(429, "rate_limited", "Too many backup requests. Try again later.");
};

const parseBody = async (request) => {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new AuthError(415, "unsupported_media_type", "JSON request body required.");
  }
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_BACKUP_BODY_BYTES) {
    throw new AuthError(413, "backup_too_large", "Encrypted backup is too large.");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BODY_BYTES) {
    throw new AuthError(413, "backup_too_large", "Encrypted backup is too large.");
  }
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid");
    return body;
  } catch {
    throw new AuthError(400, "invalid_json", "Backup request is invalid.");
  }
};

const normalizeEnvelope = (value) => {
  const envelope = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const encryption = envelope.encryption && typeof envelope.encryption === "object" ? envelope.encryption : {};
  const keyDerivation = envelope.keyDerivation && typeof envelope.keyDerivation === "object" ? envelope.keyDerivation : {};
  if (
    envelope.format !== BACKUP_FORMAT ||
    envelope.version !== BACKUP_VERSION ||
    encryption.name !== "AES-GCM" ||
    encryption.keyLength !== 256 ||
    typeof encryption.iv !== "string" ||
    !base64Pattern.test(encryption.iv) ||
    base64ByteLength(encryption.iv) !== 12 ||
    keyDerivation.name !== "PBKDF2" ||
    keyDerivation.hash !== "SHA-256" ||
    keyDerivation.iterations !== PBKDF2_ITERATIONS ||
    typeof keyDerivation.salt !== "string" ||
    !base64Pattern.test(keyDerivation.salt) ||
    base64ByteLength(keyDerivation.salt) !== 16 ||
    typeof envelope.ciphertext !== "string" ||
    !base64Pattern.test(envelope.ciphertext) ||
    base64ByteLength(envelope.ciphertext) < 17
  ) {
    throw new AuthError(400, "invalid_backup_envelope", "Encrypted backup format is invalid.");
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
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

const sha256Hex = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const publicBackup = (row) => ({
  id: row.id,
  planVersion: row.plan_version,
  sizeBytes: row.size_bytes,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const unavailable = (jsonResponse, privacy) => jsonResponse({
  ok: true,
  available: false,
  backups: [],
  reason: "r2_not_configured",
  message: "Encrypted cloud backup is not configured.",
  privacy
});

export const handleBackupsRequest = async (request, env, jsonResponse, privacy) => {
  if (!env?.DB || !env?.BACKUPS || backupMode(env) === "disabled") {
    if (request.method === "GET" && new URL(request.url).pathname === "/api/backups") return unavailable(jsonResponse, privacy);
    throw new AuthError(501, "cloud_backup_disabled", "Encrypted cloud backup is not enabled.");
  }

  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/backups(?:\/([0-9a-f-]{36}))?$/u);
  if (!match) throw new AuthError(404, "backup_not_found", "Backup not found.");
  const backupId = match[1] || "";

  if (request.method === "GET" && !backupId) {
    const user = await requireUser(request, env);
    requireBackupReadAccess(user, env);
    await requireBackupRateLimit(request, user, env);
    const result = await env.DB.prepare(
      `SELECT id, plan_version, size_bytes, created_at, updated_at
         FROM cloud_backups
        WHERE user_id = ?
        ORDER BY updated_at DESC
        LIMIT ?`
    ).bind(user.id, MAX_BACKUPS_PER_USER).all();
    return jsonResponse({
      ok: true,
      available: true,
      backups: (result.results || []).map(publicBackup),
      limit: MAX_BACKUPS_PER_USER,
      privacy
    });
  }

  if (request.method === "POST" && !backupId) {
    if (!sameOrigin(request)) throw new AuthError(403, "invalid_origin", "Backup request origin is invalid.");
    const user = await requireUser(request, env);
    await requireBackupWriteAccess(user, env);
    await requireBackupRateLimit(request, user, env);
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM cloud_backups WHERE user_id = ?").bind(user.id).first();
    if (Number(count?.count || 0) >= MAX_BACKUPS_PER_USER) {
      throw new AuthError(409, "backup_limit_reached", "Delete an existing backup before creating another one.");
    }

    const body = await parseBody(request);
    const planVersion = Number(body.planVersion);
    if (!Number.isInteger(planVersion) || planVersion < 0 || planVersion > 1000) {
      throw new AuthError(400, "invalid_plan_version", "Plan version is invalid.");
    }
    const envelope = normalizeEnvelope(body.envelope);
    const serialized = JSON.stringify(envelope);
    const sizeBytes = new TextEncoder().encode(serialized).byteLength;
    if (sizeBytes > MAX_BACKUP_BODY_BYTES) throw new AuthError(413, "backup_too_large", "Encrypted backup is too large.");

    const id = crypto.randomUUID();
    const objectKey = `users/${user.id}/backups/${id}.json`;
    const checksum = await sha256Hex(serialized);
    await env.BACKUPS.put(objectKey, serialized, {
      httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: "no-store" },
      customMetadata: { format: BACKUP_FORMAT, version: String(BACKUP_VERSION) }
    });
    try {
      await env.DB.prepare(
        `INSERT INTO cloud_backups
          (id, user_id, r2_object_key, plan_version, encryption_version, encrypted, size_bytes, checksum_sha256, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      ).bind(id, user.id, objectKey, planVersion, BACKUP_VERSION, sizeBytes, checksum).run();
    } catch (error) {
      await env.BACKUPS.delete(objectKey);
      throw error;
    }
    const row = await env.DB.prepare(
      `SELECT id, plan_version, size_bytes, created_at, updated_at
         FROM cloud_backups WHERE id = ? AND user_id = ? LIMIT 1`
    ).bind(id, user.id).first();
    return jsonResponse({ ok: true, available: true, backup: publicBackup(row), privacy }, 201);
  }

  if (request.method === "GET" && backupId) {
    const user = await requireUser(request, env);
    requireBackupReadAccess(user, env);
    await requireBackupRateLimit(request, user, env);
    const row = await env.DB.prepare(
      `SELECT id, r2_object_key, checksum_sha256
         FROM cloud_backups WHERE id = ? AND user_id = ? LIMIT 1`
    ).bind(backupId, user.id).first();
    if (!row) throw new AuthError(404, "backup_not_found", "Backup not found.");
    const object = await env.BACKUPS.get(row.r2_object_key);
    if (!object) throw new AuthError(404, "backup_object_not_found", "Backup data not found.");
    const serialized = await object.text();
    if (await sha256Hex(serialized) !== row.checksum_sha256) {
      throw new AuthError(409, "backup_integrity_failed", "Backup integrity check failed.");
    }
    return jsonResponse({ ok: true, envelope: JSON.parse(serialized), privacy });
  }

  if (request.method === "DELETE" && backupId) {
    if (!sameOrigin(request)) throw new AuthError(403, "invalid_origin", "Backup deletion origin is invalid.");
    const user = await requireUser(request, env);
    requireBackupReadAccess(user, env);
    await requireBackupRateLimit(request, user, env);
    const row = await env.DB.prepare(
      `SELECT id, r2_object_key FROM cloud_backups WHERE id = ? AND user_id = ? LIMIT 1`
    ).bind(backupId, user.id).first();
    if (!row) throw new AuthError(404, "backup_not_found", "Backup not found.");
    await env.BACKUPS.delete(row.r2_object_key);
    await env.DB.prepare("DELETE FROM cloud_backups WHERE id = ? AND user_id = ?").bind(backupId, user.id).run();
    return jsonResponse({ ok: true, deleted: true, id: backupId, privacy });
  }

  throw new AuthError(405, "method_not_allowed", "Backup endpoint does not support the requested method.");
};
