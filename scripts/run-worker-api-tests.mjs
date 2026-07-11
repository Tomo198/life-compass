import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import worker, { createWorker } from "../worker/index.js";

const env = {
  ASSETS: {
    fetch: async () => new Response("asset fallback", { status: 418 })
  }
};

const request = (path, init) => worker.fetch(new Request(`https://life.example${path}`, init), env, {});
const json = async (response) => JSON.parse(await response.text());

class FakeD1 {
  constructor() {
    this.usersBySub = new Map();
    this.usersById = new Map();
    this.sessionsByHash = new Map();
  }

  prepare(sql) {
    const normalized = sql.replace(/\s+/gu, " ").trim();
    return {
      bind: (...args) => ({
        run: async () => {
          if (normalized.startsWith("INSERT INTO users")) {
            const [newId, sub, email, emailVerified] = args;
            const existing = this.usersBySub.get(sub);
            const user = existing || { id: newId, google_sub: sub };
            Object.assign(user, { email, email_verified: emailVerified, deleted_at: null });
            this.usersBySub.set(sub, user);
            this.usersById.set(user.id, user);
            return { success: true };
          }
          if (normalized.startsWith("INSERT INTO sessions")) {
            const [id, userId, tokenHash, expiresAt] = args;
            this.sessionsByHash.set(tokenHash, { id, user_id: userId, token_hash: tokenHash, expires_at: expiresAt, revoked_at: null });
            return { success: true };
          }
          if (normalized.startsWith("UPDATE sessions SET revoked_at")) {
            const [tokenHash] = args;
            const session = this.sessionsByHash.get(tokenHash);
            if (session) session.revoked_at = new Date().toISOString();
            return { success: true };
          }
          if (normalized.startsWith("DELETE FROM users")) {
            const [userId] = args;
            const user = this.usersById.get(userId);
            if (user) this.usersBySub.delete(user.google_sub);
            this.usersById.delete(userId);
            for (const [tokenHash, session] of this.sessionsByHash) {
              if (session.user_id === userId) this.sessionsByHash.delete(tokenHash);
            }
            return { success: true };
          }
          if (normalized.startsWith("DELETE FROM sessions")) {
            const now = Math.floor(Date.now() / 1000);
            for (const [tokenHash, session] of this.sessionsByHash) {
              if (session.expires_at <= now || session.revoked_at) this.sessionsByHash.delete(tokenHash);
            }
            return { success: true };
          }
          throw new Error(`Unexpected D1 run query: ${normalized}`);
        },
        first: async () => {
          if (normalized.includes("FROM users WHERE google_sub")) {
            return this.usersBySub.get(args[0]) || null;
          }
          if (normalized.includes("FROM sessions") && normalized.includes("JOIN users")) {
            const session = this.sessionsByHash.get(args[0]);
            if (!session || session.revoked_at || session.expires_at <= Math.floor(Date.now() / 1000)) return null;
            return this.usersById.get(session.user_id) || null;
          }
          if (normalized.includes("FROM subscriptions")) return null;
          throw new Error(`Unexpected D1 first query: ${normalized}`);
        }
      })
    };
  }
}

const cookieValue = (response, name) => {
  const header = response.headers.get("Set-Cookie") || "";
  return header.match(new RegExp(`${name}=([^;,]+)`))?.[1] || "";
};

test("health endpoint returns scaffold status without caching", async () => {
  const response = await request("/api/health");
  const body = await json(response);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(body.ok, true);
  assert.equal(body.mode, "scaffold");
  assert.equal(body.privacy.planDataStoredOnServer, false);
});

test("me endpoint does not pretend the user is logged in", async () => {
  const response = await request("/api/me");
  const body = await json(response);

  assert.equal(response.status, 200);
  assert.equal(body.authenticated, false);
  assert.equal(body.user, null);
  assert.equal(body.loginConfigured, false);
});

test("entitlement endpoint keeps Pro in preview mode before billing", async () => {
  const response = await request("/api/entitlement");
  const body = await json(response);

  assert.equal(response.status, 200);
  assert.equal(body.access.tier, "free");
  assert.equal(body.access.mode, "preview");
  assert.equal(body.access.billingConfigured, false);
  assert.equal(body.access.effectiveTier, "pro");
});

test("cloud backups are listed as unavailable until encryption storage is implemented", async () => {
  const response = await request("/api/backups");
  const body = await json(response);

  assert.equal(response.status, 200);
  assert.equal(body.available, false);
  assert.deepEqual(body.backups, []);
  assert.equal(body.privacy.planDataStoredOnServer, false);
});

test("cloud backup writes are rejected while not configured", async () => {
  const response = await request("/api/backups", { method: "POST", body: "{}" });
  const body = await json(response);

  assert.equal(response.status, 501);
  assert.equal(body.ok, false);
  assert.equal(body.error.feature, "encrypted_cloud_backup");
});

test("non-api requests fall through to static assets", async () => {
  const response = await request("/");

  assert.equal(response.status, 418);
  assert.equal(await response.text(), "asset fallback");
  assert.match(response.headers.get("Content-Security-Policy") || "", /script-src 'self' https:\/\/accounts\.google\.com\/gsi\/client/u);
  assert.equal(response.headers.get("Cross-Origin-Opener-Policy"), "same-origin-allow-popups");
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
  assert.match(response.headers.get("Strict-Transport-Security") || "", /max-age=31536000/u);
});

test("service worker never caches authentication or billing API responses", async () => {
  const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(source, /requestUrl\.pathname\.startsWith\("\/api\/"\)/u);
  assert.match(source, /return;/u);
});

test("static asset CSP permits only the Google Identity endpoints required for login", async () => {
  const headers = await readFile(new URL("../public/_headers", import.meta.url), "utf8");
  assert.match(headers, /script-src 'self' https:\/\/accounts\.google\.com\/gsi\/client/u);
  assert.match(headers, /style-src 'self' https:\/\/accounts\.google\.com\/gsi\/style/u);
  assert.match(headers, /connect-src 'self' https:\/\/accounts\.google\.com\/gsi\//u);
  assert.match(headers, /frame-src https:\/\/accounts\.google\.com\/gsi\//u);
  assert.doesNotMatch(headers, /'unsafe-inline'/u);
});

test("Cloudflare serves the SPA as assets and runs the Worker first only for APIs", async () => {
  const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(config.assets.binding, "ASSETS");
  assert.equal(config.assets.html_handling, "none");
  assert.equal(config.assets.not_found_handling, "single-page-application");
  assert.deepEqual(config.assets.run_worker_first, ["/api/*"]);
  assert.deepEqual(config.triggers.crons, ["17 3 * * *"]);
});

test("Google login creates a minimal D1 user and a hashed server session", async () => {
  const DB = new FakeD1();
  const secureWorker = createWorker({
    verifyGoogleToken: async ({ credential, clientId, nonce }) => {
      assert.equal(credential, "signed-google-id-token");
      assert.equal(clientId, "google-client-id");
      assert.ok(nonce.length >= 32);
      return { sub: "google-sub-123", email: "user@example.com", emailVerified: true };
    }
  });
  const authEnv = { ...env, DB, GOOGLE_CLIENT_ID: "google-client-id" };
  const authRequest = (path, init) => secureWorker.fetch(new Request(`https://life.example${path}`, init), authEnv, {});

  const configResponse = await authRequest("/api/auth/config");
  const config = await json(configResponse);
  assert.equal(config.configured, true);
  assert.equal(config.clientId, "google-client-id");

  const nonceResponse = await authRequest("/api/auth/nonce");
  const nonceBody = await json(nonceResponse);
  const nonceCookie = cookieValue(nonceResponse, "__Host-lc_oauth_nonce");
  assert.equal(nonceResponse.status, 200);
  assert.equal(nonceCookie, nonceBody.nonce);
  assert.match(nonceResponse.headers.get("Set-Cookie") || "", /__Host-lc_oauth_nonce=/u);
  assert.match(nonceResponse.headers.get("Set-Cookie") || "", /HttpOnly/u);
  assert.match(nonceResponse.headers.get("Set-Cookie") || "", /Secure/u);
  assert.match(nonceResponse.headers.get("Set-Cookie") || "", /SameSite=Strict/u);

  const loginResponse = await authRequest("/api/auth/google", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://life.example",
      Cookie: `__Host-lc_oauth_nonce=${nonceCookie}`
    },
    body: JSON.stringify({ credential: "signed-google-id-token", nonce: nonceBody.nonce })
  });
  const login = await json(loginResponse);
  const sessionCookie = cookieValue(loginResponse, "__Host-lc_session");
  assert.equal(loginResponse.status, 200);
  assert.equal(login.authenticated, true);
  assert.equal(login.user.email, "user@example.com");
  assert.ok(sessionCookie.length >= 48);
  assert.match(loginResponse.headers.get("Set-Cookie") || "", /__Host-lc_session=/u);
  assert.match(loginResponse.headers.get("Set-Cookie") || "", /HttpOnly/u);
  assert.match(loginResponse.headers.get("Set-Cookie") || "", /SameSite=Lax/u);
  assert.equal(DB.usersBySub.size, 1);
  assert.equal(DB.sessionsByHash.size, 1);
  assert.equal([...DB.sessionsByHash.keys()].includes(sessionCookie), false);

  const meResponse = await authRequest("/api/me", { headers: { Cookie: `__Host-lc_session=${sessionCookie}` } });
  const me = await json(meResponse);
  assert.equal(me.authenticated, true);
  assert.equal(me.user.email, "user@example.com");
  assert.equal(me.privacy.planDataStoredOnServer, false);

  const logoutResponse = await authRequest("/api/auth/logout", {
    method: "POST",
    headers: {
      Origin: "https://life.example",
      Cookie: `__Host-lc_session=${sessionCookie}`
    }
  });
  assert.equal(logoutResponse.status, 200);
  assert.match(logoutResponse.headers.get("Set-Cookie") || "", /Max-Age=0/u);

  const loggedOutResponse = await authRequest("/api/me", { headers: { Cookie: `__Host-lc_session=${sessionCookie}` } });
  const loggedOut = await json(loggedOutResponse);
  assert.equal(loggedOut.authenticated, false);
});

test("account deletion requires same-origin confirmation and removes the D1 identity", async () => {
  const DB = new FakeD1();
  const secureWorker = createWorker({
    verifyGoogleToken: async () => ({ sub: "delete-sub", email: "delete@example.com", emailVerified: true })
  });
  const authEnv = { ...env, DB, GOOGLE_CLIENT_ID: "google-client-id" };
  const authRequest = (path, init) => secureWorker.fetch(new Request(`https://life.example${path}`, init), authEnv, {});

  const nonceResponse = await authRequest("/api/auth/nonce");
  const nonceBody = await json(nonceResponse);
  const loginResponse = await authRequest("/api/auth/google", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://life.example",
      Cookie: `__Host-lc_oauth_nonce=${nonceBody.nonce}`
    },
    body: JSON.stringify({ credential: "valid-token", nonce: nonceBody.nonce })
  });
  const sessionCookie = cookieValue(loginResponse, "__Host-lc_session");
  const sessionHeaders = {
    "Content-Type": "application/json",
    Cookie: `__Host-lc_session=${sessionCookie}`
  };

  const crossOrigin = await authRequest("/api/account", {
    method: "DELETE",
    headers: { ...sessionHeaders, Origin: "https://attacker.example" },
    body: JSON.stringify({ confirmation: "DELETE_ACCOUNT" })
  });
  assert.equal(crossOrigin.status, 403);

  const unconfirmed = await authRequest("/api/account", {
    method: "DELETE",
    headers: { ...sessionHeaders, Origin: "https://life.example" },
    body: JSON.stringify({ confirmation: "" })
  });
  assert.equal(unconfirmed.status, 400);
  assert.equal(DB.usersBySub.size, 1);

  const deletedResponse = await authRequest("/api/account", {
    method: "DELETE",
    headers: { ...sessionHeaders, Origin: "https://life.example" },
    body: JSON.stringify({ confirmation: "DELETE_ACCOUNT" })
  });
  const deleted = await json(deletedResponse);
  assert.equal(deletedResponse.status, 200);
  assert.equal(deleted.accountDeleted, true);
  assert.match(deletedResponse.headers.get("Set-Cookie") || "", /Max-Age=0/u);
  assert.equal(DB.usersBySub.size, 0);
  assert.equal(DB.sessionsByHash.size, 0);

  const meResponse = await authRequest("/api/me", { headers: { Cookie: `__Host-lc_session=${sessionCookie}` } });
  assert.equal((await json(meResponse)).authenticated, false);
});

test("scheduled cleanup removes expired and revoked sessions but keeps active sessions", async () => {
  const DB = new FakeD1();
  const now = Math.floor(Date.now() / 1000);
  DB.sessionsByHash.set("active", { id: "1", user_id: "u1", token_hash: "active", expires_at: now + 60, revoked_at: null });
  DB.sessionsByHash.set("expired", { id: "2", user_id: "u1", token_hash: "expired", expires_at: now - 1, revoked_at: null });
  DB.sessionsByHash.set("revoked", { id: "3", user_id: "u1", token_hash: "revoked", expires_at: now + 60, revoked_at: new Date().toISOString() });

  await createWorker().scheduled({}, { DB });

  assert.deepEqual([...DB.sessionsByHash.keys()], ["active"]);
});

test("Google login rejects cross-origin and mismatched nonce requests", async () => {
  const DB = new FakeD1();
  let verifierCalls = 0;
  const secureWorker = createWorker({
    verifyGoogleToken: async () => {
      verifierCalls += 1;
      return { sub: "should-not-run", email: null, emailVerified: false };
    }
  });
  const authEnv = { ...env, DB, GOOGLE_CLIENT_ID: "google-client-id" };
  const authRequest = (path, init) => secureWorker.fetch(new Request(`https://life.example${path}`, init), authEnv, {});

  const wrongOrigin = await authRequest("/api/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://attacker.example", Cookie: "__Host-lc_oauth_nonce=expected" },
    body: JSON.stringify({ credential: "token", nonce: "expected" })
  });
  assert.equal(wrongOrigin.status, 403);

  const wrongNonce = await authRequest("/api/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://life.example", Cookie: "__Host-lc_oauth_nonce=expected" },
    body: JSON.stringify({ credential: "token", nonce: "different" })
  });
  assert.equal(wrongNonce.status, 400);
  assert.equal(verifierCalls, 0);
  assert.equal(DB.usersBySub.size, 0);
  assert.equal(DB.sessionsByHash.size, 0);
});

test("invalid Google credentials never create a user or session", async () => {
  const DB = new FakeD1();
  const secureWorker = createWorker({
    verifyGoogleToken: async () => {
      throw new Error("signature rejected");
    }
  });
  const authEnv = { ...env, DB, GOOGLE_CLIENT_ID: "google-client-id" };
  const authRequest = (path, init) => secureWorker.fetch(new Request(`https://life.example${path}`, init), authEnv, {});
  const nonceResponse = await authRequest("/api/auth/nonce");
  const nonceBody = await json(nonceResponse);

  const response = await authRequest("/api/auth/google", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://life.example",
      Cookie: `__Host-lc_oauth_nonce=${nonceBody.nonce}`
    },
    body: JSON.stringify({ credential: "forged-token", nonce: nonceBody.nonce })
  });
  const body = await json(response);
  assert.equal(response.status, 401);
  assert.equal(body.error.code, "invalid_google_credential");
  assert.equal(JSON.stringify(body).includes("signature rejected"), false);
  assert.equal(DB.usersBySub.size, 0);
  assert.equal(DB.sessionsByHash.size, 0);
});

test("database failures return a generic error without internal details", async () => {
  const brokenEnv = {
    ...env,
    GOOGLE_CLIENT_ID: "google-client-id",
    DB: {
      prepare: () => {
        throw new Error("private database connection details");
      }
    }
  };
  const response = await worker.fetch(new Request("https://life.example/api/me", {
    headers: { Cookie: "__Host-lc_session=untrusted-session-token" }
  }), brokenEnv, {});
  const body = await json(response);
  assert.equal(response.status, 500);
  assert.equal(body.error.code, "internal_error");
  assert.equal(JSON.stringify(body).includes("private database"), false);
  assert.equal(JSON.stringify(body).includes("untrusted-session-token"), false);
});
