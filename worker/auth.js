import { createRemoteJWKSet, jwtVerify } from "jose";

const SESSION_COOKIE = "lc_session";
const OAUTH_NONCE_COOKIE = "lc_oauth_nonce";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const NONCE_MAX_AGE_SECONDS = 60 * 10;
const MAX_AUTH_BODY_BYTES = 24 * 1024;
const SENSITIVE_ACTION_MAX_SESSION_AGE_SECONDS = 60 * 10;
const googleJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

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

const parseCookies = (request) => {
  const cookies = new Map();
  const header = request.headers.get("Cookie") || "";
  header.split(";").forEach((part) => {
    const separator = part.indexOf("=");
    if (separator < 1) return;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) cookies.set(name, value);
  });
  return cookies;
};

const cookie = (request, name, value, maxAge, sameSite = "Lax") => {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=${sameSite}${secure}`;
};

const cookieName = (request, name) =>
  new URL(request.url).protocol === "https:" ? `__Host-${name}` : `${name}_dev`;

const clearCookie = (request, name, sameSite = "Lax") => cookie(request, name, "", 0, sameSite);

const authConfigured = (env) => Boolean(env?.DB && env?.GOOGLE_CLIENT_ID);

const sameOrigin = (request) => request.headers.get("Origin") === new URL(request.url).origin;

const parseJsonBody = async (request) => {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new AuthError(415, "unsupported_media_type", "JSON request body required.");
  }

  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_AUTH_BODY_BYTES) {
    throw new AuthError(413, "request_too_large", "Authentication request is too large.");
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_AUTH_BODY_BYTES) {
    throw new AuthError(413, "request_too_large", "Authentication request is too large.");
  }

  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid");
    return body;
  } catch {
    throw new AuthError(400, "invalid_json", "Authentication request is invalid.");
  }
};

export class AuthError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

export const verifyGoogleIdToken = async ({ credential, clientId, nonce }) => {
  const { payload } = await jwtVerify(credential, googleJwks, {
    audience: clientId,
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    algorithms: ["RS256"],
    clockTolerance: 5
  });

  if (!payload.sub || payload.nonce !== nonce) {
    throw new AuthError(401, "invalid_google_credential", "Google sign-in could not be verified.");
  }

  return {
    sub: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
    emailVerified: payload.email_verified === true
  };
};

const getSessionToken = (request) => parseCookies(request).get(cookieName(request, SESSION_COOKIE)) || "";

export const getCurrentUser = async (request, env) => {
  if (!authConfigured(env)) return null;
  const token = getSessionToken(request);
  if (!token) return null;

  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT users.id, users.google_sub, users.email, users.email_verified,
            unixepoch(sessions.created_at) AS session_created_at
       FROM sessions
       JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ?
        AND sessions.revoked_at IS NULL
        AND sessions.expires_at > unixepoch()
        AND users.deleted_at IS NULL
      LIMIT 1`
  ).bind(tokenHash).first();

  if (!row) return null;
  return {
    id: row.id,
    googleSub: row.google_sub,
    email: row.email || null,
    emailVerified: row.email_verified === 1,
    sessionCreatedAt: Number(row.session_created_at || 0)
  };
};

export const getAuthConfig = (env) => ({
  configured: authConfigured(env),
  clientId: authConfigured(env) ? env.GOOGLE_CLIENT_ID : null
});

export const issueGoogleNonce = (request, env, jsonResponse) => {
  if (!authConfigured(env)) {
    throw new AuthError(501, "google_login_not_configured", "Google sign-in is not configured.");
  }
  const nonce = randomToken();
  const response = jsonResponse({ ok: true, nonce, expiresIn: NONCE_MAX_AGE_SECONDS });
  const nonceCookieName = cookieName(request, OAUTH_NONCE_COOKIE);
  response.headers.append("Set-Cookie", cookie(request, nonceCookieName, nonce, NONCE_MAX_AGE_SECONDS, "Strict"));
  return response;
};

export const loginWithGoogle = async (request, env, verifyGoogleToken, jsonResponse) => {
  if (!authConfigured(env)) {
    throw new AuthError(501, "google_login_not_configured", "Google sign-in is not configured.");
  }
  if (!sameOrigin(request)) {
    throw new AuthError(403, "invalid_origin", "Authentication request origin is invalid.");
  }

  const body = await parseJsonBody(request);
  const credential = typeof body.credential === "string" ? body.credential : "";
  const nonce = typeof body.nonce === "string" ? body.nonce : "";
  const nonceCookieName = cookieName(request, OAUTH_NONCE_COOKIE);
  const sessionCookieName = cookieName(request, SESSION_COOKIE);
  const cookieNonce = parseCookies(request).get(nonceCookieName) || "";
  if (!credential || !nonce || nonce.length > 256 || !cookieNonce || cookieNonce !== nonce) {
    throw new AuthError(400, "invalid_login_request", "Google sign-in request is invalid or expired.");
  }

  let identity;
  try {
    identity = await verifyGoogleToken({ credential, clientId: env.GOOGLE_CLIENT_ID, nonce });
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(401, "invalid_google_credential", "Google sign-in could not be verified.");
  }

  const newUserId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(google_sub) DO UPDATE SET
       email = excluded.email,
       email_verified = excluded.email_verified,
       updated_at = CURRENT_TIMESTAMP,
       deleted_at = NULL`
  ).bind(newUserId, identity.sub, identity.email, identity.emailVerified ? 1 : 0).run();

  const user = await env.DB.prepare(
    `SELECT id, email, email_verified FROM users WHERE google_sub = ? LIMIT 1`
  ).bind(identity.sub).first();
  if (!user) throw new AuthError(500, "account_creation_failed", "Account could not be created.");

  const sessionToken = randomToken(48);
  const tokenHash = await sha256(sessionToken);
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?)`
  ).bind(crypto.randomUUID(), user.id, tokenHash, expiresAt).run();

  const response = jsonResponse({
    ok: true,
    authenticated: true,
    user: {
      id: user.id,
      email: user.email || null,
      emailVerified: user.email_verified === 1
    }
  });
  response.headers.append("Set-Cookie", cookie(request, sessionCookieName, sessionToken, SESSION_MAX_AGE_SECONDS));
  response.headers.append("Set-Cookie", clearCookie(request, nonceCookieName, "Strict"));
  return response;
};

export const logout = async (request, env, jsonResponse) => {
  if (!sameOrigin(request)) {
    throw new AuthError(403, "invalid_origin", "Authentication request origin is invalid.");
  }

  const token = getSessionToken(request);
  if (token && env?.DB) {
    const tokenHash = await sha256(token);
    await env.DB.prepare(
      `UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND revoked_at IS NULL`
    ).bind(tokenHash).run();
  }

  const response = jsonResponse({ ok: true, authenticated: false, user: null });
  response.headers.append("Set-Cookie", clearCookie(request, cookieName(request, SESSION_COOKIE)));
  return response;
};

export const logoutAll = async (request, env, jsonResponse) => {
  if (!sameOrigin(request)) {
    throw new AuthError(403, "invalid_origin", "Session revocation origin is invalid.");
  }
  const user = await getCurrentUser(request, env);
  if (!user) throw new AuthError(401, "authentication_required", "Google sign-in is required.");
  await env.DB.prepare(
    "UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL"
  ).bind(user.id).run();
  const response = jsonResponse({ ok: true, authenticated: false, user: null, allSessionsRevoked: true });
  response.headers.append("Set-Cookie", clearCookie(request, cookieName(request, SESSION_COOKIE)));
  return response;
};

export const deleteAccount = async (request, env, jsonResponse) => {
  if (!authConfigured(env)) {
    throw new AuthError(501, "account_management_not_configured", "Account management is not configured.");
  }
  if (!sameOrigin(request)) {
    throw new AuthError(403, "invalid_origin", "Account deletion request origin is invalid.");
  }

  const user = await getCurrentUser(request, env);
  if (!user) {
    throw new AuthError(401, "authentication_required", "Sign in again before deleting the account.");
  }
  const now = Math.floor(Date.now() / 1000);
  if (!user.sessionCreatedAt || now - user.sessionCreatedAt > SENSITIVE_ACTION_MAX_SESSION_AGE_SECONDS) {
    throw new AuthError(401, "fresh_authentication_required", "Sign out and sign in again before deleting the account.");
  }

  const body = await parseJsonBody(request);
  if (body.confirmation !== "DELETE_ACCOUNT") {
    throw new AuthError(400, "account_deletion_not_confirmed", "Account deletion was not confirmed.");
  }

  const activeSubscription = await env.DB.prepare(
    `SELECT status
       FROM subscriptions
      WHERE user_id = ?
        AND status IN ('active', 'trialing', 'past_due', 'unpaid')
      LIMIT 1`
  ).bind(user.id).first();
  if (activeSubscription) {
    throw new AuthError(409, "active_subscription", "Cancel the active subscription before deleting the account.");
  }

  let householdMembership = null;
  if (["preview", "enforced"].includes(env?.HOUSEHOLD_SHARING_MODE)) {
    householdMembership = await env.DB.prepare(
      `SELECT memberships.household_id, memberships.role
         FROM household_memberships AS memberships
         JOIN shared_households AS households
           ON households.id = memberships.household_id
        WHERE memberships.user_id = ?
          AND memberships.status = 'active'
          AND households.deleted_at IS NULL
        LIMIT 1`
    ).bind(user.id).first();
    if (householdMembership?.role === "owner") {
      throw new AuthError(
        409,
        "active_household_owner",
        "Delete the shared household before deleting the owner account."
      );
    }
  }

  const backupResult = await env.DB.prepare(
    "SELECT r2_object_key FROM cloud_backups WHERE user_id = ?"
  ).bind(user.id).all();
  const objectKeys = (backupResult.results || []).map((row) => row.r2_object_key).filter(Boolean);
  if (objectKeys.length > 0 && !env?.BACKUPS) {
    throw new AuthError(503, "backup_storage_unavailable", "Account deletion is temporarily unavailable.");
  }
  if (objectKeys.length > 0) await env.BACKUPS.delete(objectKeys);

  if (householdMembership?.role === "editor") {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE shared_households
            SET status = 'read_only',
                key_epoch = key_epoch + 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND deleted_at IS NULL`
      ).bind(householdMembership.household_id),
      env.DB.prepare(
        `UPDATE household_memberships
            SET status = 'left',
                revoked_at = CURRENT_TIMESTAMP
          WHERE household_id = ?
            AND user_id = ?
            AND role = 'editor'
            AND status = 'active'`
      ).bind(householdMembership.household_id, user.id),
      env.DB.prepare(
        `INSERT INTO household_audit_events
          (id, household_id, actor_user_id, event_type)
         VALUES (?, ?, ?, 'left')`
      ).bind(crypto.randomUUID(), householdMembership.household_id, user.id),
      env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id)
    ]);
  } else {
    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();
  }
  const response = jsonResponse({ ok: true, authenticated: false, user: null, accountDeleted: true });
  response.headers.append("Set-Cookie", clearCookie(request, cookieName(request, SESSION_COOKIE)));
  return response;
};

export const cleanupSessions = async (env) => {
  if (!env?.DB) return;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `DELETE FROM sessions
      WHERE expires_at <= ?
         OR revoked_at IS NOT NULL`
  ).bind(now).run();
};

export const publicUser = (user) => user ? {
  id: user.id,
  email: user.email,
  emailVerified: user.emailVerified
} : null;

export const isAuthConfigured = authConfigured;
