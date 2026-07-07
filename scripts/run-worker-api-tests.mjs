import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../worker/index.js";

const env = {
  ASSETS: {
    fetch: async () => new Response("asset fallback", { status: 418 })
  }
};

const request = (path, init) => worker.fetch(new Request(`https://life.example${path}`, init), env, {});
const json = async (response) => JSON.parse(await response.text());

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
});
