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
const utcDateAfter = (days) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

class FakeD1 {
  constructor() {
    this.usersBySub = new Map();
    this.usersById = new Map();
    this.sessionsByHash = new Map();
    this.sessionSequence = 0;
    this.cloudBackups = new Map();
    this.subscriptionsByProviderId = new Map();
    this.billingWebhookEvents = new Map();
    this.sharedHouseholds = new Map();
    this.householdMemberships = new Map();
    this.householdInvitations = new Map();
    this.householdAuditEvents = new Map();
    this.sharedPlanRevisions = new Map();
    this.failCloudBackupInsert = false;
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) {
      results.push(await statement.run());
    }
    return results;
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
            this.sessionsByHash.set(tokenHash, {
              id,
              user_id: userId,
              token_hash: tokenHash,
              expires_at: expiresAt,
              created_at: Math.floor(Date.now() / 1000),
              created_sequence: this.sessionSequence += 1,
              revoked_at: null
            });
            return { success: true };
          }
          if (normalized.startsWith("UPDATE sessions SET revoked_at")) {
            if (normalized.includes("id NOT IN")) {
              const [userId, preservedId, selectedUserId, excludedId, keepCount] = args;
              const keepIds = new Set(
                [...this.sessionsByHash.values()]
                  .filter((session) => (
                    session.user_id === selectedUserId
                    && session.id !== excludedId
                    && !session.revoked_at
                    && session.expires_at > Math.floor(Date.now() / 1000)
                  ))
                  .sort((left, right) => right.created_sequence - left.created_sequence)
                  .slice(0, keepCount)
                  .map((session) => session.id)
              );
              for (const session of this.sessionsByHash.values()) {
                if (
                  session.user_id === userId
                  && session.id !== preservedId
                  && !session.revoked_at
                  && session.expires_at > Math.floor(Date.now() / 1000)
                  && !keepIds.has(session.id)
                ) {
                  session.revoked_at = new Date().toISOString();
                }
              }
            } else if (normalized.includes("WHERE user_id")) {
              const [userId] = args;
              for (const session of this.sessionsByHash.values()) {
                if (session.user_id === userId && !session.revoked_at) session.revoked_at = new Date().toISOString();
              }
            } else {
              const [tokenHash] = args;
              const session = this.sessionsByHash.get(tokenHash);
              if (session) session.revoked_at = new Date().toISOString();
            }
            return { success: true };
          }
          if (normalized.startsWith("INSERT INTO cloud_backups")) {
            if (this.failCloudBackupInsert) throw new Error("simulated metadata failure");
            const [id, userId, objectKey, planVersion, encryptionVersion, sizeBytes, checksum] = args;
            const timestamp = new Date().toISOString();
            this.cloudBackups.set(id, {
              id,
              user_id: userId,
              r2_object_key: objectKey,
              plan_version: planVersion,
              encryption_version: encryptionVersion,
              size_bytes: sizeBytes,
              checksum_sha256: checksum,
              created_at: timestamp,
              updated_at: timestamp
            });
            return { success: true };
          }
          if (normalized.startsWith("INSERT INTO billing_webhook_events")) {
            const [id, provider, eventId, eventType, providerObjectId] = args;
            this.billingWebhookEvents.set(`${provider}:${eventId}`, {
              id,
              provider,
              event_id: eventId,
              event_type: eventType,
              provider_object_id: providerObjectId,
              status: "received"
            });
            return { success: true };
          }
          if (normalized.startsWith("UPDATE billing_webhook_events")) {
            const [status, provider, eventId] = args;
            const event = this.billingWebhookEvents.get(`${provider}:${eventId}`);
            if (event) Object.assign(event, { status, processed_at: new Date().toISOString() });
            return { success: true };
          }
          if (normalized.startsWith("INSERT INTO subscriptions")) {
            const [id, userId, provider, customerId, subscriptionId, planId, status, paymentStatus, currentPeriodEnd, cancelAtPeriodEnd] = args;
            this.subscriptionsByProviderId.set(`${provider}:${subscriptionId}`, {
              id,
              user_id: userId,
              billing_provider: provider,
              provider_customer_id: customerId,
              provider_subscription_id: subscriptionId,
              provider_plan_id: planId,
              tier: "pro",
              status,
              payment_status: paymentStatus,
              current_period_end: currentPeriodEnd,
              cancel_at_period_end: cancelAtPeriodEnd
            });
            return { success: true };
          }
          if (normalized.startsWith("UPDATE subscriptions")) {
            const [userId, customerId, planId, status, paymentStatus, currentPeriodEnd, cancelAtPeriodEnd, id] = args;
            const subscription = [...this.subscriptionsByProviderId.values()].find((item) => item.id === id);
            if (subscription) Object.assign(subscription, {
              user_id: userId,
              provider_customer_id: customerId,
              provider_plan_id: planId,
              tier: "pro",
              status,
              payment_status: paymentStatus,
              current_period_end: currentPeriodEnd,
              cancel_at_period_end: cancelAtPeriodEnd
            });
            return { success: true };
          }
          if (normalized.startsWith("INSERT INTO shared_households")) {
            const [id, ownerUserId] = args;
            if ([...this.sharedHouseholds.values()].some((item) => (
              item.owner_user_id === ownerUserId && !item.deleted_at
            ))) {
              throw new Error("unique active household owner");
            }
            const timestamp = new Date().toISOString();
            this.sharedHouseholds.set(id, {
              id,
              owner_user_id: ownerUserId,
              status: "active",
              key_epoch: 1,
              current_revision: 0,
              created_at: timestamp,
              updated_at: timestamp,
              deleted_at: null
            });
            return { success: true, meta: { changes: 1 } };
          }
          if (normalized.startsWith("INSERT INTO household_memberships") && normalized.includes("VALUES")) {
            const [id, householdId, userId] = args;
            if ([...this.householdMemberships.values()].some((item) => (
              item.user_id === userId && item.status === "active"
            ))) {
              throw new Error("unique active household membership");
            }
            this.householdMemberships.set(id, {
              id,
              household_id: householdId,
              user_id: userId,
              role: normalized.includes("'owner'") ? "owner" : "editor",
              status: "active",
              joined_at: new Date().toISOString(),
              revoked_at: null
            });
            return { success: true, meta: { changes: 1 } };
          }
          if (normalized.startsWith("INSERT INTO household_memberships") && normalized.includes("SELECT")) {
            const [id, userId, invitationId, tokenHash, inviteeEmailHmac] = args;
            const invitation = this.householdInvitations.get(invitationId);
            const household = invitation ? this.sharedHouseholds.get(invitation.household_id) : null;
            const activeMemberCount = invitation
              ? [...this.householdMemberships.values()].filter((item) => (
                item.household_id === invitation.household_id && item.status === "active"
              )).length
              : 0;
            const alreadyActive = [...this.householdMemberships.values()].some((item) => (
              item.user_id === userId && item.status === "active"
            ));
            const valid = Boolean(
              invitation
              && household?.status === "active"
              && !household.deleted_at
              && invitation.token_hash === tokenHash
              && invitation.invitee_email_hmac === inviteeEmailHmac
              && !invitation.accepted_at
              && !invitation.revoked_at
              && invitation.expires_at > Math.floor(Date.now() / 1000)
              && activeMemberCount < 2
              && !alreadyActive
            );
            if (!valid) return { success: true, meta: { changes: 0 } };
            this.householdMemberships.set(id, {
              id,
              household_id: invitation.household_id,
              user_id: userId,
              role: "editor",
              status: "active",
              joined_at: new Date().toISOString(),
              revoked_at: null
            });
            return { success: true, meta: { changes: 1 } };
          }
          if (normalized.startsWith("INSERT INTO household_invitations")) {
            const [id, householdId, createdBy, tokenHash, inviteeEmailHmac, expiresAt] = args;
            this.householdInvitations.set(id, {
              id,
              household_id: householdId,
              created_by: createdBy,
              token_hash: tokenHash,
              invitee_email_hmac: inviteeEmailHmac,
              role: "editor",
              expires_at: expiresAt,
              accepted_at: null,
              accepted_by: null,
              revoked_at: null,
              created_at: new Date().toISOString()
            });
            return { success: true, meta: { changes: 1 } };
          }
          if (normalized.startsWith("UPDATE household_invitations") && normalized.includes("SET revoked_at")) {
            let changes = 0;
            if (normalized.includes("WHERE id = ?")) {
              const [invitationId, householdId] = args;
              const invitation = this.householdInvitations.get(invitationId);
              if (
                invitation?.household_id === householdId
                && !invitation.accepted_at
                && !invitation.revoked_at
              ) {
                invitation.revoked_at = new Date().toISOString();
                changes = 1;
              }
            } else {
              const [householdId] = args;
              for (const invitation of this.householdInvitations.values()) {
                if (
                  invitation.household_id === householdId
                  && !invitation.accepted_at
                  && !invitation.revoked_at
                ) {
                  invitation.revoked_at = new Date().toISOString();
                  changes += 1;
                }
              }
            }
            return { success: true, meta: { changes } };
          }
          if (normalized.startsWith("UPDATE household_invitations") && normalized.includes("SET accepted_at")) {
            const [userId, invitationId] = args;
            const invitation = this.householdInvitations.get(invitationId);
            const membership = invitation
              ? [...this.householdMemberships.values()].find((item) => (
                item.household_id === invitation.household_id
                && item.user_id === userId
                && item.status === "active"
              ))
              : null;
            if (
              !invitation
              || invitation.accepted_at
              || invitation.revoked_at
              || invitation.expires_at <= Math.floor(Date.now() / 1000)
              || !membership
            ) {
              return { success: true, meta: { changes: 0 } };
            }
            invitation.accepted_at = new Date().toISOString();
            invitation.accepted_by = userId;
            return { success: true, meta: { changes: 1 } };
          }
          if (normalized.startsWith("INSERT INTO household_audit_events")) {
            const eventType = normalized.match(
              /'(created|invited|invitation_revoked|joined|removed|left|saved)'/u
            )?.[1] || "unknown";
            let id = args[0];
            let householdId = args[1];
            let actorUserId = args[2];
            if (eventType === "joined") {
              const invitation = this.householdInvitations.get(args[2]);
              if (!invitation?.accepted_at) return { success: true, meta: { changes: 0 } };
              householdId = invitation.household_id;
              actorUserId = args[1];
            }
            if (eventType === "invitation_revoked") {
              const invitation = this.householdInvitations.get(args[3]);
              if (!invitation?.revoked_at) return { success: true, meta: { changes: 0 } };
            }
            this.householdAuditEvents.set(id, {
              id,
              household_id: householdId,
              actor_user_id: actorUserId,
              event_type: eventType,
              revision: eventType === "saved" ? args[3] : null,
              created_at: new Date().toISOString()
            });
            return { success: true, meta: { changes: 1 } };
          }
          if (normalized.startsWith("UPDATE household_memberships")) {
            const [householdId, userId] = args;
            const membership = [...this.householdMemberships.values()].find((item) => (
              item.household_id === householdId
              && item.user_id === userId
              && item.role === "editor"
              && item.status === "active"
            ));
            if (!membership) return { success: true, meta: { changes: 0 } };
            membership.status = normalized.includes("'revoked'") ? "revoked" : "left";
            membership.revoked_at = new Date().toISOString();
            return { success: true, meta: { changes: 1 } };
          }
          if (normalized.startsWith("INSERT INTO shared_plan_revisions")) {
            const [
              householdId,
              revision,
              keyEpoch,
              objectKey,
              envelopeVersion,
              planVersion,
              sizeBytes,
              checksum,
              createdBy,
              expectedHouseholdId,
              expectedKeyEpoch,
              expectedRevision,
              membershipUserId
            ] = args;
            const household = this.sharedHouseholds.get(expectedHouseholdId);
            const membership = [...this.householdMemberships.values()].find((item) => (
              item.household_id === expectedHouseholdId
              && item.user_id === membershipUserId
              && item.status === "active"
            ));
            const key = `${householdId}:${revision}`;
            if (this.sharedPlanRevisions.has(key)) throw new Error("unique shared revision");
            if (
              !household
              || household.id !== householdId
              || household.status !== "active"
              || household.deleted_at
              || household.key_epoch !== expectedKeyEpoch
              || household.current_revision !== expectedRevision
              || !membership
            ) {
              return { success: true, meta: { changes: 0 } };
            }
            const row = {
              household_id: householdId,
              revision,
              key_epoch: keyEpoch,
              r2_object_key: objectKey,
              envelope_version: envelopeVersion,
              plan_version: planVersion,
              size_bytes: sizeBytes,
              checksum_sha256: checksum,
              created_by: createdBy,
              created_at: new Date().toISOString()
            };
            this.sharedPlanRevisions.set(key, row);
            return { success: true, meta: { changes: 1 } };
          }
          if (normalized.startsWith("UPDATE shared_households")) {
            if (normalized.includes("SET current_revision")) {
              const [revision, householdId, keyEpoch, expectedRevision, userId] = args;
              const household = this.sharedHouseholds.get(householdId);
              const membership = [...this.householdMemberships.values()].find((item) => (
                item.household_id === householdId
                && item.user_id === userId
                && item.status === "active"
              ));
              if (
                !household
                || household.status !== "active"
                || household.deleted_at
                || household.key_epoch !== keyEpoch
                || household.current_revision !== expectedRevision
                || !membership
              ) {
                return { success: true, meta: { changes: 0 } };
              }
              household.current_revision = revision;
              household.updated_at = new Date().toISOString();
              return { success: true, meta: { changes: 1 } };
            }
            const [householdId] = args;
            const household = this.sharedHouseholds.get(householdId);
            if (!household || household.deleted_at) return { success: true, meta: { changes: 0 } };
            household.status = "read_only";
            household.key_epoch += 1;
            household.updated_at = new Date().toISOString();
            return { success: true, meta: { changes: 1 } };
          }
          if (normalized.startsWith("DELETE FROM shared_households")) {
            const [householdId, ownerUserId] = args;
            const household = this.sharedHouseholds.get(householdId);
            if (!household || household.owner_user_id !== ownerUserId) {
              return { success: true, meta: { changes: 0 } };
            }
            this.sharedHouseholds.delete(householdId);
            for (const [id, membership] of this.householdMemberships) {
              if (membership.household_id === householdId) this.householdMemberships.delete(id);
            }
            for (const [id, invitation] of this.householdInvitations) {
              if (invitation.household_id === householdId) this.householdInvitations.delete(id);
            }
            return { success: true, meta: { changes: 1 } };
          }
          if (normalized.startsWith("DELETE FROM shared_plan_revisions")) {
            const [householdId, revision] = args;
            const deleted = this.sharedPlanRevisions.delete(`${householdId}:${revision}`);
            return { success: true, meta: { changes: deleted ? 1 : 0 } };
          }
          if (normalized.startsWith("DELETE FROM cloud_backups")) {
            const [id, userId] = args;
            const backup = this.cloudBackups.get(id);
            if (backup?.user_id === userId) this.cloudBackups.delete(id);
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
            for (const [id, backup] of this.cloudBackups) {
              if (backup.user_id === userId) this.cloudBackups.delete(id);
            }
            for (const [id, membership] of this.householdMemberships) {
              if (membership.user_id === userId) this.householdMemberships.delete(id);
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
            const user = this.usersById.get(session.user_id);
            return user ? { ...user, session_created_at: session.created_at } : null;
          }
          if (normalized.includes("FROM users") && normalized.includes("lower(email) = lower(?)")) {
            const email = String(args[0] || "").toLowerCase();
            return [...this.usersById.values()].find((user) => (
              user.email_verified === 1
              && !user.deleted_at
              && String(user.email || "").toLowerCase() === email
            )) || null;
          }
          if (normalized.startsWith("SELECT COUNT(*) AS count FROM cloud_backups")) {
            return { count: [...this.cloudBackups.values()].filter((backup) => backup.user_id === args[0]).length };
          }
          if (normalized.includes("FROM cloud_backups WHERE id = ? AND user_id = ?")) {
            const backup = this.cloudBackups.get(args[0]);
            return backup?.user_id === args[1] ? backup : null;
          }
          if (normalized.includes("FROM billing_webhook_events")) {
            return this.billingWebhookEvents.get(`${args[0]}:${args[1]}`) || null;
          }
          if (normalized.includes("FROM subscriptions") && normalized.includes("provider_subscription_id = ?")) {
            return this.subscriptionsByProviderId.get(`${args[0]}:${args[1]}`) || null;
          }
          if (normalized.includes("FROM subscriptions") && normalized.includes("WHERE user_id = ?")) {
            const subscriptions = [...this.subscriptionsByProviderId.values()]
              .filter((subscription) => subscription.user_id === args[0]);
            if (normalized.includes("payment_status = 'paid'")) {
              const today = new Date().toISOString().slice(0, 10);
              return subscriptions.find((subscription) => (
                subscription.tier === "pro"
                && ["active", "trialing"].includes(subscription.status)
                && subscription.payment_status === "paid"
                && typeof subscription.current_period_end === "string"
                && subscription.current_period_end >= today
              )) || null;
            }
            if (normalized.includes("'past_due'") && normalized.includes("'unpaid'")) {
              return subscriptions.find((subscription) => (
                ["active", "trialing", "past_due", "unpaid"].includes(subscription.status)
              )) || null;
            }
            return subscriptions[0] || null;
          }
          if (normalized.includes("FROM subscriptions")) return null;
          if (normalized.includes("FROM household_memberships AS memberships")) {
            const membership = [...this.householdMemberships.values()].find((item) => (
              item.user_id === args[0] && item.status === "active"
            ));
            const household = membership ? this.sharedHouseholds.get(membership.household_id) : null;
            const owner = household ? this.usersById.get(household.owner_user_id) : null;
            if (
              !membership
              || !household
              || household.deleted_at
              || !["active", "read_only"].includes(household.status)
              || !owner
              || owner.deleted_at
            ) {
              return null;
            }
            return {
              household_id: household.id,
              role: membership.role,
              owner_user_id: household.owner_user_id,
              household_status: household.status,
              key_epoch: household.key_epoch,
              current_revision: household.current_revision,
              created_at: household.created_at,
              updated_at: household.updated_at,
              owner_google_sub: owner.google_sub,
              owner_email_verified: owner.email_verified
            };
          }
          if (normalized.startsWith("SELECT COUNT(*) AS count FROM household_memberships")) {
            return {
              count: [...this.householdMemberships.values()].filter((item) => (
                item.household_id === args[0] && item.status === "active"
              )).length
            };
          }
          if (normalized.includes("FROM household_invitations AS invitations")) {
            const invitation = [...this.householdInvitations.values()].find((item) => (
              item.token_hash === args[0]
              && !item.accepted_at
              && !item.revoked_at
              && item.expires_at > Math.floor(Date.now() / 1000)
            ));
            const household = invitation ? this.sharedHouseholds.get(invitation.household_id) : null;
            return invitation && household?.status === "active" && !household.deleted_at
              ? { ...invitation }
              : null;
          }
          if (
            normalized.includes("FROM household_memberships")
            && normalized.includes("WHERE household_id = ?")
            && normalized.includes("user_id = ?")
          ) {
            return [...this.householdMemberships.values()].find((item) => (
              item.household_id === args[0]
              && item.user_id === args[1]
              && item.status === "active"
            )) || null;
          }
          if (normalized.startsWith("SELECT COUNT(*) AS count FROM shared_plan_revisions")) {
            return {
              count: [...this.sharedPlanRevisions.values()].filter((item) => (
                item.household_id === args[0]
              )).length
            };
          }
          if (
            normalized.includes("FROM shared_plan_revisions")
            && normalized.includes("revision = ?")
            && normalized.includes("r2_object_key")
          ) {
            return this.sharedPlanRevisions.get(`${args[0]}:${args[1]}`) || null;
          }
          if (normalized.includes("FROM shared_households") && normalized.includes("owner_user_id = ?")) {
            return [...this.sharedHouseholds.values()].find((item) => (
              item.owner_user_id === args[0] && !item.deleted_at
            )) || null;
          }
          throw new Error(`Unexpected D1 first query: ${normalized}`);
        },
        all: async () => {
          if (normalized.includes("FROM cloud_backups") && normalized.includes("WHERE user_id = ?")) {
            return { results: [...this.cloudBackups.values()].filter((backup) => backup.user_id === args[0]) };
          }
          if (normalized.includes("FROM shared_plan_revisions") && normalized.includes("WHERE household_id = ?")) {
            const rows = [...this.sharedPlanRevisions.values()]
              .filter((revision) => revision.household_id === args[0])
              .sort((left, right) => right.revision - left.revision);
            const limit = normalized.includes("LIMIT ?") ? Number(args[1]) : rows.length;
            return { results: rows.slice(0, limit) };
          }
          throw new Error(`Unexpected D1 all query: ${normalized}`);
        }
      })
    };
  }
}

class FakeR2 {
  constructor() {
    this.objects = new Map();
  }

  async put(key, value) {
    this.objects.set(key, String(value));
    return { key };
  }

  async get(key) {
    const value = this.objects.get(key);
    return value === undefined
      ? null
      : { size: new TextEncoder().encode(value).byteLength, text: async () => value };
  }

  async delete(keyOrKeys) {
    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
    keys.forEach((key) => this.objects.delete(key));
  }
}

const cookieValue = (response, name) => {
  const header = response.headers.get("Set-Cookie") || "";
  return header.match(new RegExp(`${name}=([^;,]+)`))?.[1] || "";
};

const createSquareSignature = async (notificationUrl, body, signatureKey) => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signatureKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${notificationUrl}${body}`));
  return Buffer.from(signature).toString("base64");
};

test("health endpoint returns scaffold status without caching", async () => {
  const response = await request("/api/health");
  const body = await json(response);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(body.ok, true);
  assert.equal(body.mode, "scaffold");
  assert.equal(body.privacy.plainPlanDataStoredOnServer, false);
  assert.equal(body.privacy.encryptedBackupOnly, true);
  assert.equal(body.privacy.automaticCloudSync, false);
});

test("me endpoint does not pretend the user is logged in", async () => {
  const response = await request("/api/me");
  const body = await json(response);

  assert.equal(response.status, 200);
  assert.equal(body.authenticated, false);
  assert.equal(body.user, null);
  assert.equal(body.loginConfigured, false);
});

test("entitlement endpoint enables Pro preview only when explicitly configured", async () => {
  const response = await worker.fetch(
    new Request("https://life.example/api/entitlement"),
    { ...env, ACCESS_MODE: "preview" },
    {}
  );
  const body = await json(response);

  assert.equal(response.status, 200);
  assert.equal(body.access.tier, "free");
  assert.equal(body.access.mode, "preview");
  assert.equal(body.access.billingConfigured, false);
  assert.equal(body.access.effectiveTier, "pro");
});

test("enforced access grants test Pro only to the configured Google owner", async () => {
  const DB = new FakeD1();
  const secureWorker = createWorker({
    verifyGoogleToken: async ({ credential }) => ({
      sub: credential,
      email: `${credential}@example.com`,
      emailVerified: credential !== "unverified"
    })
  });
  const authEnv = {
    ...env,
    DB,
    GOOGLE_CLIENT_ID: "google-client-id",
    ACCESS_MODE: "enforced",
    OWNER_GOOGLE_SUB: "owner"
  };
  const authRequest = (path, init) => secureWorker.fetch(new Request(`https://life.example${path}`, init), authEnv, {});
  const loginAs = async (identity) => {
    const nonceResponse = await authRequest("/api/auth/nonce");
    const nonce = await json(nonceResponse);
    const loginResponse = await authRequest("/api/auth/google", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://life.example",
        Cookie: `__Host-lc_oauth_nonce=${nonce.nonce}`
      },
      body: JSON.stringify({ credential: identity, nonce: nonce.nonce })
    });
    return cookieValue(loginResponse, "__Host-lc_session");
  };

  const ownerCookie = await loginAs("owner");
  const owner = await json(await authRequest("/api/entitlement", {
    headers: { Cookie: `__Host-lc_session=${ownerCookie}` }
  }));
  assert.equal(owner.access.mode, "enforced");
  assert.equal(owner.access.tier, "pro");
  assert.equal(owner.access.source, "operator");
  assert.equal(owner.access.effectiveTier, "pro");

  const otherCookie = await loginAs("other");
  const other = await json(await authRequest("/api/entitlement", {
    headers: { Cookie: `__Host-lc_session=${otherCookie}` }
  }));
  assert.equal(other.access.tier, "free");
  assert.equal(other.access.source, "anonymous");

  const unverifiedCookie = await loginAs("unverified");
  const unverified = await json(await authRequest("/api/entitlement", {
    headers: { Cookie: `__Host-lc_session=${unverifiedCookie}` }
  }));
  assert.equal(unverified.access.tier, "free");
  assert.equal(unverified.access.source, "anonymous");
});

test("authentication rejects oversized streamed JSON and limits active sessions per account", async () => {
  const DB = new FakeD1();
  const secureWorker = createWorker({
    verifyGoogleToken: async ({ credential }) => ({
      sub: credential,
      email: `${credential}@example.com`,
      emailVerified: true
    })
  });
  const authEnv = {
    ...env,
    DB,
    GOOGLE_CLIENT_ID: "google-client-id",
    ACCESS_MODE: "enforced"
  };
  const authRequest = (path, init) => secureWorker.fetch(
    new Request(`https://life.example${path}`, init),
    authEnv,
    {}
  );
  const loginAs = async (identity) => {
    const nonceResponse = await authRequest("/api/auth/nonce");
    const nonce = await json(nonceResponse);
    return authRequest("/api/auth/google", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://life.example",
        Cookie: `__Host-lc_oauth_nonce=${nonce.nonce}`
      },
      body: JSON.stringify({ credential: identity, nonce: nonce.nonce })
    });
  };

  const nonceResponse = await authRequest("/api/auth/nonce");
  const nonce = await json(nonceResponse);
  const oversized = await authRequest("/api/auth/google", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://life.example",
      Cookie: `__Host-lc_oauth_nonce=${nonce.nonce}`
    },
    body: JSON.stringify({ credential: "x".repeat(25 * 1024), nonce: nonce.nonce })
  });
  assert.equal(oversized.status, 413);
  assert.equal((await json(oversized)).error.code, "request_too_large");

  const cookies = [];
  for (let index = 0; index < 7; index += 1) {
    const loginResponse = await loginAs("session-user");
    assert.equal(loginResponse.status, 200);
    cookies.push(cookieValue(loginResponse, "__Host-lc_session"));
  }

  const activeSessions = [...DB.sessionsByHash.values()].filter((session) => !session.revoked_at);
  assert.equal(activeSessions.length, 5);
  const oldestSession = await json(await authRequest("/api/me", {
    headers: { Cookie: `__Host-lc_session=${cookies[0]}` }
  }));
  const newestSession = await json(await authRequest("/api/me", {
    headers: { Cookie: `__Host-lc_session=${cookies.at(-1)}` }
  }));
  assert.equal(oldestSession.authenticated, false);
  assert.equal(newestSession.authenticated, true);
});

test("household sharing remains unavailable until explicitly enabled", async () => {
  const response = await worker.fetch(
    new Request("https://life.example/api/shared-household"),
    { ...env, DB: new FakeD1(), GOOGLE_CLIENT_ID: "google-client-id" },
    {}
  );
  const body = await json(response);
  assert.equal(response.status, 501);
  assert.equal(body.error.code, "household_sharing_disabled");

  const entitlement = await json(await worker.fetch(
    new Request("https://life.example/api/entitlement"),
    { ...env, DB: new FakeD1(), GOOGLE_CLIENT_ID: "google-client-id" },
    {}
  ));
  assert.deepEqual(entitlement.access.household, {
    mode: "disabled",
    available: false,
    householdId: null,
    role: null,
    status: null,
    source: "none",
    effectiveTier: "free",
    readAllowed: false,
    writeAllowed: false
  });
});

test("one paid owner can securely share household Pro access with one verified editor", async () => {
  const DB = new FakeD1();
  const secureWorker = createWorker({
    verifyGoogleToken: async ({ credential }) => ({
      sub: credential,
      email: `${credential}@example.com`,
      emailVerified: true
    })
  });
  const authEnv = {
    ...env,
    DB,
    GOOGLE_CLIENT_ID: "google-client-id",
    ACCESS_MODE: "enforced",
    HOUSEHOLD_SHARING_MODE: "enforced",
    HOUSEHOLD_INVITE_PEPPER: "test-only-household-invite-pepper-with-more-than-32-characters"
  };
  const authRequest = (path, init) => secureWorker.fetch(
    new Request(`https://life.example${path}`, init),
    authEnv,
    {}
  );
  const loginAs = async (identity) => {
    const nonceResponse = await authRequest("/api/auth/nonce");
    const nonce = await json(nonceResponse);
    const loginResponse = await authRequest("/api/auth/google", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://life.example",
        Cookie: `__Host-lc_oauth_nonce=${nonce.nonce}`
      },
      body: JSON.stringify({ credential: identity, nonce: nonce.nonce })
    });
    return cookieValue(loginResponse, "__Host-lc_session");
  };

  const ownerCookie = await loginAs("owner");
  const partnerCookie = await loginAs("partner");
  const attackerCookie = await loginAs("attacker");
  const owner = DB.usersBySub.get("owner");
  const partner = DB.usersBySub.get("partner");
  const ownerSubscription = {
    id: "owner-subscription",
    user_id: owner.id,
    billing_provider: "square",
    provider_subscription_id: "owner-subscription",
    tier: "pro",
    status: "active",
    payment_status: "paid",
    current_period_end: utcDateAfter(30),
    cancel_at_period_end: 0
  };
  DB.subscriptionsByProviderId.set("square:owner-subscription", ownerSubscription);

  const crossOriginCreate = await authRequest("/api/shared-household", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://attacker.example",
      Cookie: `__Host-lc_session=${ownerCookie}`
    },
    body: JSON.stringify({ confirmation: "CREATE_SHARED_HOUSEHOLD" })
  });
  assert.equal(crossOriginCreate.status, 403);

  const createResponse = await authRequest("/api/shared-household", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://life.example",
      Cookie: `__Host-lc_session=${ownerCookie}`
    },
    body: JSON.stringify({ confirmation: "CREATE_SHARED_HOUSEHOLD" })
  });
  const created = await json(createResponse);
  assert.equal(createResponse.status, 201);
  assert.equal(created.household.role, "owner");
  assert.equal(created.household.memberCount, 1);
  assert.equal(created.household.writeAllowed, true);

  ownerSubscription.status = "canceled";
  const ownerAccountDelete = await authRequest("/api/account", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://life.example",
      Cookie: `__Host-lc_session=${ownerCookie}`
    },
    body: JSON.stringify({ confirmation: "DELETE_ACCOUNT" })
  });
  const ownerAccountDeleteBody = await json(ownerAccountDelete);
  assert.equal(ownerAccountDelete.status, 409);
  assert.equal(ownerAccountDeleteBody.error.code, "active_household_owner");
  ownerSubscription.status = "active";

  const invitationResponse = await authRequest("/api/shared-household/invitations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://life.example",
      Cookie: `__Host-lc_session=${ownerCookie}`
    },
    body: JSON.stringify({ email: "partner@example.com" })
  });
  const invitationBody = await json(invitationResponse);
  assert.equal(invitationResponse.status, 201);
  const invitationUrl = new URL(invitationBody.invitation.inviteUrl);
  const inviteToken = invitationUrl.hash.split("/").at(-1);
  assert.match(inviteToken, /^[A-Za-z0-9_-]{43}$/u);
  const storedInvitation = DB.householdInvitations.get(invitationBody.invitation.id);
  assert.notEqual(storedInvitation.token_hash, inviteToken);
  assert.notEqual(storedInvitation.invitee_email_hmac, "partner@example.com");
  assert.equal(JSON.stringify([...DB.householdInvitations.values()]).includes("partner@example.com"), false);

  const attackerRevoke = await authRequest(
    `/api/shared-household/invitations/${invitationBody.invitation.id}`,
    {
      method: "DELETE",
      headers: {
        Origin: "https://life.example",
        Cookie: `__Host-lc_session=${attackerCookie}`
      }
    }
  );
  assert.equal(attackerRevoke.status, 403);

  storedInvitation.expires_at = Math.floor(Date.now() / 1000) - 1;
  const expiredAccept = await authRequest("/api/shared-household/invitations/accept", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://life.example",
      Cookie: `__Host-lc_session=${partnerCookie}`
    },
    body: JSON.stringify({ token: inviteToken })
  });
  assert.equal(expiredAccept.status, 400);
  storedInvitation.expires_at = Math.floor(Date.now() / 1000) + 3600;

  const attackerAccept = await authRequest("/api/shared-household/invitations/accept", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://life.example",
      Cookie: `__Host-lc_session=${attackerCookie}`
    },
    body: JSON.stringify({ token: inviteToken })
  });
  const attackerBody = await json(attackerAccept);
  assert.equal(attackerAccept.status, 400);
  assert.equal(attackerBody.error.code, "invalid_invitation");

  const partnerAccept = await authRequest("/api/shared-household/invitations/accept", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://life.example",
      Cookie: `__Host-lc_session=${partnerCookie}`
    },
    body: JSON.stringify({ token: inviteToken })
  });
  const partnerHousehold = await json(partnerAccept);
  assert.equal(partnerAccept.status, 200);
  assert.equal(partnerHousehold.household.role, "editor");
  assert.equal(partnerHousehold.household.memberCount, 2);

  const overLimitInvite = await authRequest("/api/shared-household/invitations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://life.example",
      Cookie: `__Host-lc_session=${ownerCookie}`
    },
    body: JSON.stringify({ email: "another@example.com" })
  });
  assert.equal(overLimitInvite.status, 409);

  const partnerEntitlement = await json(await authRequest("/api/entitlement", {
    headers: { Cookie: `__Host-lc_session=${partnerCookie}` }
  }));
  assert.equal(partnerEntitlement.access.tier, "free");
  assert.equal(partnerEntitlement.access.source, "anonymous");
  assert.equal(partnerEntitlement.access.household.effectiveTier, "pro");
  assert.equal(partnerEntitlement.access.household.source, "household-subscription");
  assert.equal(partnerEntitlement.access.household.writeAllowed, true);

  ownerSubscription.current_period_end = utcDateAfter(-1);
  const expiredEntitlement = await json(await authRequest("/api/entitlement", {
    headers: { Cookie: `__Host-lc_session=${partnerCookie}` }
  }));
  assert.equal(expiredEntitlement.access.household.effectiveTier, "free");
  assert.equal(expiredEntitlement.access.household.readAllowed, true);
  assert.equal(expiredEntitlement.access.household.writeAllowed, false);
  ownerSubscription.current_period_end = utcDateAfter(30);

  const removeResponse = await authRequest(`/api/shared-household/members/${partner.id}`, {
    method: "DELETE",
    headers: {
      Origin: "https://life.example",
      Cookie: `__Host-lc_session=${ownerCookie}`
    }
  });
  const removed = await json(removeResponse);
  assert.equal(removeResponse.status, 200);
  assert.equal(removed.requiresKeyRotation, true);

  const removedPartnerEntitlement = await json(await authRequest("/api/entitlement", {
    headers: { Cookie: `__Host-lc_session=${partnerCookie}` }
  }));
  assert.equal(removedPartnerEntitlement.access.household.available, false);

  const replayResponse = await authRequest("/api/shared-household/invitations/accept", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://life.example",
      Cookie: `__Host-lc_session=${partnerCookie}`
    },
    body: JSON.stringify({ token: inviteToken })
  });
  assert.equal(replayResponse.status, 400);

  const ownerHousehold = await json(await authRequest("/api/shared-household", {
    headers: { Cookie: `__Host-lc_session=${ownerCookie}` }
  }));
  assert.equal(ownerHousehold.household.status, "read_only");
  assert.equal(ownerHousehold.household.keyEpoch, 2);
  assert.equal(ownerHousehold.household.writeAllowed, false);

  const deleteResponse = await authRequest("/api/shared-household", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://life.example",
      Cookie: `__Host-lc_session=${ownerCookie}`
    },
    body: JSON.stringify({ confirmation: "DELETE_SHARED_HOUSEHOLD" })
  });
  assert.equal(deleteResponse.status, 200);
  assert.equal(DB.sharedHouseholds.size, 0);
  assert.equal(DB.householdMemberships.size, 0);
});

test("encrypted shared plans enforce membership, integrity, concurrency, and revision retention", async () => {
  const DB = new FakeD1();
  const SHARED_PLANS = new FakeR2();
  const secureWorker = createWorker({
    verifyGoogleToken: async ({ credential }) => ({
      sub: credential,
      email: `${credential}@example.com`,
      emailVerified: true
    })
  });
  const authEnv = {
    ...env,
    DB,
    SHARED_PLANS,
    GOOGLE_CLIENT_ID: "google-client-id",
    ACCESS_MODE: "enforced",
    HOUSEHOLD_SHARING_MODE: "preview",
    OWNER_GOOGLE_SUB: "shared-owner"
  };
  const authRequest = (path, init, overrideEnv = authEnv) => secureWorker.fetch(
    new Request(`https://life.example${path}`, init),
    overrideEnv,
    {}
  );
  const loginAs = async (identity) => {
    const nonceResponse = await authRequest("/api/auth/nonce");
    const nonce = await json(nonceResponse);
    const loginResponse = await authRequest("/api/auth/google", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://life.example",
        Cookie: `__Host-lc_oauth_nonce=${nonce.nonce}`
      },
      body: JSON.stringify({ credential: identity, nonce: nonce.nonce })
    });
    return cookieValue(loginResponse, "__Host-lc_session");
  };
  const ownerCookie = await loginAs("shared-owner");
  const otherCookie = await loginAs("shared-other");
  const createResponse = await authRequest("/api/shared-household", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://life.example",
      Cookie: `__Host-lc_session=${ownerCookie}`
    },
    body: JSON.stringify({ confirmation: "CREATE_SHARED_HOUSEHOLD" })
  });
  assert.equal(createResponse.status, 201);
  const householdId = (await json(createResponse)).household.id;
  const makeEnvelope = (revision, household = householdId) => ({
    format: "life-compass-shared-plan",
    version: 1,
    householdId: household,
    revision,
    keyEpoch: 1,
    encryption: {
      name: "AES-GCM",
      keyLength: 256,
      iv: Buffer.alloc(12, revision).toString("base64")
    },
    keyDerivation: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: 600_000,
      salt: Buffer.alloc(16, revision).toString("base64")
    },
    ciphertext: Buffer.alloc(32, revision).toString("base64"),
    leakedPlaintext: "must not be stored"
  });
  const saveRevision = (expectedRevision, envelope = makeEnvelope(expectedRevision + 1)) => authRequest(
    "/api/shared-household/plan",
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://life.example",
        Cookie: `__Host-lc_session=${ownerCookie}`
      },
      body: JSON.stringify({
        expectedRevision,
        planVersion: 9,
        envelope
      })
    }
  );

  const unavailable = await authRequest(
    "/api/shared-household/plan",
    { headers: { Cookie: `__Host-lc_session=${ownerCookie}` } },
    { ...authEnv, SHARED_PLANS: undefined }
  );
  assert.equal(unavailable.status, 503);

  const crossOrigin = await authRequest("/api/shared-household/plan", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://attacker.example",
      Cookie: `__Host-lc_session=${ownerCookie}`
    },
    body: JSON.stringify({ expectedRevision: 0, planVersion: 9, envelope: makeEnvelope(1) })
  });
  assert.equal(crossOrigin.status, 403);

  const firstSave = await saveRevision(0);
  assert.equal(firstSave.status, 201);
  assert.equal((await json(firstSave)).currentRevision, 1);
  assert.equal(SHARED_PLANS.objects.size, 1);
  assert.equal(JSON.stringify([...SHARED_PLANS.objects.values()]).includes("must not be stored"), false);

  const conflict = await saveRevision(0);
  assert.equal(conflict.status, 409);
  assert.equal((await json(conflict)).error.code, "shared_plan_conflict");
  assert.equal(SHARED_PLANS.objects.size, 1);

  const wrongHousehold = await saveRevision(
    1,
    makeEnvelope(2, "f6cf35ef-f8d4-452e-b827-88475350b89d")
  );
  assert.equal(wrongHousehold.status, 400);
  assert.equal((await json(wrongHousehold)).error.code, "invalid_shared_plan_envelope");

  for (let expectedRevision = 1; expectedRevision < 11; expectedRevision += 1) {
    const response = await saveRevision(expectedRevision);
    assert.equal(response.status, 201);
  }
  assert.equal(DB.sharedHouseholds.get(householdId).current_revision, 11);
  assert.equal(DB.sharedPlanRevisions.size, 10);
  assert.equal(DB.sharedPlanRevisions.has(`${householdId}:1`), false);
  assert.equal(SHARED_PLANS.objects.size, 10);

  const currentResponse = await authRequest("/api/shared-household/plan", {
    headers: { Cookie: `__Host-lc_session=${ownerCookie}` }
  });
  const current = await json(currentResponse);
  assert.equal(currentResponse.status, 200);
  assert.equal(current.currentRevision, 11);
  assert.equal(current.envelope.revision, 11);

  const currentRow = DB.sharedPlanRevisions.get(`${householdId}:11`);
  const currentObject = SHARED_PLANS.objects.get(currentRow.r2_object_key);
  SHARED_PLANS.objects.set(currentRow.r2_object_key, `${currentObject} `);
  const tamperedResponse = await authRequest("/api/shared-household/plan", {
    headers: { Cookie: `__Host-lc_session=${ownerCookie}` }
  });
  assert.equal(tamperedResponse.status, 409);
  assert.equal((await json(tamperedResponse)).error.code, "shared_plan_integrity_failed");
  SHARED_PLANS.objects.set(currentRow.r2_object_key, currentObject);

  const revisionsResponse = await authRequest("/api/shared-household/revisions", {
    headers: { Cookie: `__Host-lc_session=${ownerCookie}` }
  });
  const revisions = await json(revisionsResponse);
  assert.equal(revisionsResponse.status, 200);
  assert.equal(revisions.revisions.length, 10);
  assert.equal(revisions.revisions[0].revision, 11);
  assert.equal(revisions.revisions.at(-1).revision, 2);
  assert.equal(JSON.stringify(revisions).includes("r2_object_key"), false);
  assert.equal(JSON.stringify(revisions).includes("checksum_sha256"), false);

  const deniedResponse = await authRequest("/api/shared-household/plan", {
    headers: { Cookie: `__Host-lc_session=${otherCookie}` }
  });
  assert.equal(deniedResponse.status, 403);
  assert.equal((await json(deniedResponse)).error.code, "household_access_denied");
});

test("editor account deletion revokes membership and locks the household for key rotation", async () => {
  const DB = new FakeD1();
  const secureWorker = createWorker({
    verifyGoogleToken: async ({ credential }) => ({
      sub: credential,
      email: `${credential}@example.com`,
      emailVerified: true
    })
  });
  const authEnv = {
    ...env,
    DB,
    GOOGLE_CLIENT_ID: "google-client-id",
    HOUSEHOLD_SHARING_MODE: "enforced"
  };
  const authRequest = (path, init) => secureWorker.fetch(
    new Request(`https://life.example${path}`, init),
    authEnv,
    {}
  );
  const loginAs = async (identity) => {
    const nonceResponse = await authRequest("/api/auth/nonce");
    const nonce = await json(nonceResponse);
    const loginResponse = await authRequest("/api/auth/google", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://life.example",
        Cookie: `__Host-lc_oauth_nonce=${nonce.nonce}`
      },
      body: JSON.stringify({ credential: identity, nonce: nonce.nonce })
    });
    return cookieValue(loginResponse, "__Host-lc_session");
  };

  await loginAs("owner-delete-test");
  const editorCookie = await loginAs("editor-delete-test");
  const owner = DB.usersBySub.get("owner-delete-test");
  const editor = DB.usersBySub.get("editor-delete-test");
  const householdId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  DB.sharedHouseholds.set(householdId, {
    id: householdId,
    owner_user_id: owner.id,
    status: "active",
    key_epoch: 1,
    current_revision: 0,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null
  });
  DB.householdMemberships.set("owner-membership", {
    id: "owner-membership",
    household_id: householdId,
    user_id: owner.id,
    role: "owner",
    status: "active"
  });
  DB.householdMemberships.set("editor-membership", {
    id: "editor-membership",
    household_id: householdId,
    user_id: editor.id,
    role: "editor",
    status: "active"
  });

  const deleteResponse = await authRequest("/api/account", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://life.example",
      Cookie: `__Host-lc_session=${editorCookie}`
    },
    body: JSON.stringify({ confirmation: "DELETE_ACCOUNT" })
  });
  assert.equal(deleteResponse.status, 200);
  assert.equal(DB.usersBySub.has("editor-delete-test"), false);
  assert.equal(DB.usersBySub.has("owner-delete-test"), true);
  assert.equal(DB.sharedHouseholds.get(householdId).status, "read_only");
  assert.equal(DB.sharedHouseholds.get(householdId).key_epoch, 2);
  assert.equal([...DB.householdMemberships.values()].some((item) => item.user_id === editor.id), false);
});

test("Square billing stays disabled until all server-side settings are present", async () => {
  const configResponse = await request("/api/billing/config");
  const config = await json(configResponse);
  assert.equal(configResponse.status, 200);
  assert.deepEqual(config.billing, {
    provider: "square",
    configured: false,
    checkoutAvailable: false,
    environment: "production"
  });

  const webhookResponse = await request("/api/billing/square/webhook", { method: "POST", body: "{}" });
  const webhook = await json(webhookResponse);
  assert.equal(webhookResponse.status, 501);
  assert.equal(webhook.error.code, "square_billing_not_configured");
});

test("Square webhook verifies signatures, links verified email and waits for successful payment", async () => {
  const DB = new FakeD1();
  const notificationUrl = "https://life.example/api/billing/square/webhook";
  const futurePeriodEnd = utcDateAfter(45);
  const subscription = {
    id: "subscription-1",
    customer_id: "customer-1",
    location_id: "location-1",
    plan_variation_id: "plan-variation-1",
    status: "ACTIVE",
    charged_through_date: futurePeriodEnd
  };
  const squareFetch = async (url) => {
    if (url.endsWith("/v2/customers/customer-1")) {
      return Response.json({ customer: { id: "customer-1", email_address: "owner@example.com" } });
    }
    if (url.endsWith("/v2/customers/customer-unmatched")) {
      return Response.json({ customer: { id: "customer-unmatched", email_address: "unmatched@example.com" } });
    }
    if (url.endsWith("/v2/subscriptions/subscription-1")) {
      return Response.json({ subscription });
    }
    return new Response("not found", { status: 404 });
  };
  const secureWorker = createWorker({
    verifyGoogleToken: async () => ({ sub: "owner", email: "owner@example.com", emailVerified: true }),
    squareFetch
  });
  const billingEnv = {
    ...env,
    DB,
    GOOGLE_CLIENT_ID: "google-client-id",
    ACCESS_MODE: "enforced",
    SQUARE_ACCESS_TOKEN: "secret-access-token",
    SQUARE_WEBHOOK_SIGNATURE_KEY: "secret-signature-key",
    SQUARE_WEBHOOK_NOTIFICATION_URL: notificationUrl,
    SQUARE_PLAN_VARIATION_ID: "plan-variation-1",
    SQUARE_MERCHANT_ID: "merchant-1",
    SQUARE_PAYMENT_LINK_URL: "https://square.link/u/example"
  };
  const billingRequest = (path, init) => secureWorker.fetch(new Request(`https://life.example${path}`, init), billingEnv, {});
  const nonceResponse = await billingRequest("/api/auth/nonce");
  const nonce = await json(nonceResponse);
  const loginResponse = await billingRequest("/api/auth/google", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://life.example",
      Cookie: `__Host-lc_oauth_nonce=${nonce.nonce}`
    },
    body: JSON.stringify({ credential: "valid", nonce: nonce.nonce })
  });
  const sessionCookie = cookieValue(loginResponse, "__Host-lc_session");
  const authHeaders = { Cookie: `__Host-lc_session=${sessionCookie}` };

  const checkoutResponse = await billingRequest("/api/billing/checkout", {
    method: "POST",
    headers: { ...authHeaders, Origin: "https://life.example" }
  });
  const checkout = await json(checkoutResponse);
  assert.equal(checkoutResponse.status, 200);
  assert.equal(checkout.checkout.provider, "square");
  assert.equal(checkout.checkout.url, "https://square.link/u/example");
  assert.equal(checkout.checkout.accountEmail, "owner@example.com");

  const sendEvent = async (event) => {
    const body = JSON.stringify(event);
    const signature = await createSquareSignature(notificationUrl, body, billingEnv.SQUARE_WEBHOOK_SIGNATURE_KEY);
    return billingRequest("/api/billing/square/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-square-hmacsha256-signature": signature
      },
      body
    });
  };

  const invalidSignature = await billingRequest("/api/billing/square/webhook", {
    method: "POST",
    headers: { "x-square-hmacsha256-signature": "invalid" },
    body: "{}"
  });
  assert.equal(invalidSignature.status, 403);

  const wrongUrlBody = JSON.stringify({
    merchant_id: "merchant-1",
    type: "subscription.created",
    event_id: "event-wrong-url",
    data: { object: { subscription } }
  });
  const wrongUrlSignature = await createSquareSignature(
    notificationUrl,
    wrongUrlBody,
    billingEnv.SQUARE_WEBHOOK_SIGNATURE_KEY
  );
  const wrongUrlResponse = await secureWorker.fetch(new Request(
    "https://preview.example/api/billing/square/webhook",
    {
      method: "POST",
      headers: { "x-square-hmacsha256-signature": wrongUrlSignature },
      body: wrongUrlBody
    }
  ), billingEnv, {});
  assert.equal(wrongUrlResponse.status, 403);

  const createdEvent = {
    merchant_id: "merchant-1",
    type: "subscription.created",
    event_id: "event-created",
    data: { object: { subscription } }
  };
  const createdResponse = await sendEvent(createdEvent);
  assert.equal(createdResponse.status, 200);
  const storedSubscription = DB.subscriptionsByProviderId.get("square:subscription-1");
  assert.equal(storedSubscription.status, "active");
  assert.equal(storedSubscription.payment_status, "unknown");

  const beforePayment = await json(await billingRequest("/api/entitlement", { headers: authHeaders }));
  assert.equal(beforePayment.access.tier, "free");

  const paidEvent = {
    merchant_id: "merchant-1",
    type: "invoice.payment_made",
    event_id: "event-paid",
    data: { object: { invoice: { subscription_id: "subscription-1" } } }
  };
  const paidResponse = await sendEvent(paidEvent);
  assert.equal(paidResponse.status, 200);
  assert.equal(storedSubscription.payment_status, "paid");

  const afterPayment = await json(await billingRequest("/api/entitlement", { headers: authHeaders }));
  assert.equal(afterPayment.access.tier, "pro");
  assert.equal(afterPayment.access.source, "subscription");

  storedSubscription.current_period_end = utcDateAfter(-1);
  const afterExpiry = await json(await billingRequest("/api/entitlement", { headers: authHeaders }));
  assert.equal(afterExpiry.access.tier, "free");
  storedSubscription.current_period_end = futurePeriodEnd;

  const duplicate = await json(await sendEvent(paidEvent));
  assert.equal(duplicate.duplicate, true);

  const unmatchedSubscription = {
    ...subscription,
    id: "subscription-unmatched",
    customer_id: "customer-unmatched"
  };
  const unmatchedResponse = await sendEvent({
    merchant_id: "merchant-1",
    type: "subscription.created",
    event_id: "event-unmatched",
    data: { object: { subscription: unmatchedSubscription } }
  });
  assert.equal(unmatchedResponse.status, 200);
  assert.equal(DB.subscriptionsByProviderId.has("square:subscription-unmatched"), false);
  assert.equal(DB.billingWebhookEvents.get("square:event-unmatched").status, "unmatched");

  subscription.canceled_date = futurePeriodEnd;
  const updatedResponse = await sendEvent({
    merchant_id: "merchant-1",
    type: "subscription.updated",
    event_id: "event-cancel-scheduled",
    data: { object: { subscription } }
  });
  assert.equal(updatedResponse.status, 200);
  assert.equal(storedSubscription.cancel_at_period_end, 1);
  assert.equal(storedSubscription.payment_status, "paid");

  const failedResponse = await sendEvent({
    merchant_id: "merchant-1",
    type: "invoice.scheduled_charge_failed",
    event_id: "event-failed",
    data: { object: { invoice: { subscription_id: "subscription-1" } } }
  });
  assert.equal(failedResponse.status, 200);
  assert.equal(storedSubscription.payment_status, "failed");
  const afterFailure = await json(await billingRequest("/api/entitlement", { headers: authHeaders }));
  assert.equal(afterFailure.access.tier, "free");

  const invalidLinkResponse = await secureWorker.fetch(new Request("https://life.example/api/billing/checkout", {
    method: "POST",
    headers: { ...authHeaders, Origin: "https://life.example" }
  }), {
    ...billingEnv,
    SQUARE_PAYMENT_LINK_URL: "https://billing.example/checkout"
  }, {});
  const invalidLink = await json(invalidLinkResponse);
  assert.equal(invalidLinkResponse.status, 501);
  assert.equal(invalidLink.error.code, "square_checkout_not_configured");
});

test("cloud backups are listed as unavailable until encryption storage is implemented", async () => {
  const response = await request("/api/backups");
  const body = await json(response);

  assert.equal(response.status, 200);
  assert.equal(body.available, false);
  assert.deepEqual(body.backups, []);
  assert.equal(body.privacy.plainPlanDataStoredOnServer, false);
});

test("cloud backup writes are rejected while not configured", async () => {
  const response = await request("/api/backups", { method: "POST", body: "{}" });
  const body = await json(response);

  assert.equal(response.status, 501);
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "cloud_backup_disabled");
});

test("enforced cloud backup requires Pro for writes and keeps existing backups recoverable", async () => {
  const DB = new FakeD1();
  const BACKUPS = new FakeR2();
  const secureWorker = createWorker({
    verifyGoogleToken: async () => ({ sub: "owner", email: "owner@example.com", emailVerified: true })
  });
  const authEnv = {
    ...env,
    DB,
    BACKUPS,
    GOOGLE_CLIENT_ID: "google-client-id",
    CLOUD_BACKUP_MODE: "enforced"
  };
  const authRequest = (path, init) => secureWorker.fetch(new Request(`https://life.example${path}`, init), authEnv, {});
  const nonceResponse = await authRequest("/api/auth/nonce");
  const nonce = await json(nonceResponse);
  const loginResponse = await authRequest("/api/auth/google", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://life.example",
      Cookie: `__Host-lc_oauth_nonce=${nonce.nonce}`
    },
    body: JSON.stringify({ credential: "valid", nonce: nonce.nonce })
  });
  const headers = {
    "Content-Type": "application/json",
    Origin: "https://life.example",
    Cookie: `__Host-lc_session=${cookieValue(loginResponse, "__Host-lc_session")}`
  };
  const body = JSON.stringify({
    planVersion: 3,
    envelope: {
      format: "life-compass-encrypted-backup",
      version: 1,
      encryption: { name: "AES-GCM", keyLength: 256, iv: "AAAAAAAAAAAAAAAA" },
      keyDerivation: { name: "PBKDF2", hash: "SHA-256", iterations: 600000, salt: "AAAAAAAAAAAAAAAAAAAAAA==" },
      ciphertext: "AQIDBAUGBwgJCgsMDQ4PEBES"
    }
  });

  const freeList = await authRequest("/api/backups", { headers });
  assert.equal(freeList.status, 200);
  assert.deepEqual((await json(freeList)).backups, []);

  const withoutSubscription = await authRequest("/api/backups", { method: "POST", headers, body });
  assert.equal(withoutSubscription.status, 403);

  authEnv.OWNER_GOOGLE_SUB = "owner";
  const ownerTestWrite = await authRequest("/api/backups", { method: "POST", headers, body });
  assert.equal(ownerTestWrite.status, 201);
  const ownerTestBackup = await json(ownerTestWrite);
  const ownerTestDelete = await authRequest(`/api/backups/${ownerTestBackup.backup.id}`, {
    method: "DELETE",
    headers
  });
  assert.equal(ownerTestDelete.status, 200);
  delete authEnv.OWNER_GOOGLE_SUB;

  const subscription = {
    id: "local-subscription",
    user_id: DB.usersBySub.get("owner").id,
    tier: "pro",
    status: "active",
    payment_status: "unknown",
    current_period_end: utcDateAfter(30)
  };
  DB.subscriptionsByProviderId.set("square:subscription-1", subscription);
  const beforePayment = await authRequest("/api/backups", { method: "POST", headers, body });
  assert.equal(beforePayment.status, 403);

  subscription.payment_status = "paid";
  subscription.current_period_end = utcDateAfter(-1);
  const afterExpiry = await authRequest("/api/backups", { method: "POST", headers, body });
  assert.equal(afterExpiry.status, 403);

  subscription.current_period_end = utcDateAfter(30);
  const paidAndActive = await authRequest("/api/backups", { method: "POST", headers, body });
  assert.equal(paidAndActive.status, 201);
  const created = await json(paidAndActive);
  assert.equal(DB.cloudBackups.size, 1);
  assert.equal(BACKUPS.objects.size, 1);

  subscription.current_period_end = utcDateAfter(-1);
  const listAfterExpiry = await authRequest("/api/backups", { headers });
  assert.equal(listAfterExpiry.status, 200);
  assert.equal((await json(listAfterExpiry)).backups.length, 1);
  const downloadAfterExpiry = await authRequest(`/api/backups/${created.backup.id}`, { headers });
  assert.equal(downloadAfterExpiry.status, 200);
  const writeAfterExpiry = await authRequest("/api/backups", { method: "POST", headers, body });
  assert.equal(writeAfterExpiry.status, 403);
  const deleteAfterExpiry = await authRequest(`/api/backups/${created.backup.id}`, {
    method: "DELETE",
    headers
  });
  assert.equal(deleteAfterExpiry.status, 200);
  assert.equal(DB.cloudBackups.size, 0);
  assert.equal(BACKUPS.objects.size, 0);
});

test("encrypted cloud backups enforce login, owner preview, ownership, integrity and deletion", async () => {
  const DB = new FakeD1();
  const BACKUPS = new FakeR2();
  const secureWorker = createWorker({
    verifyGoogleToken: async ({ credential }) => ({
      sub: credential,
      email: `${credential}@example.com`,
      emailVerified: true
    })
  });
  const authEnv = {
    ...env,
    DB,
    BACKUPS,
    GOOGLE_CLIENT_ID: "google-client-id",
    CLOUD_BACKUP_MODE: "preview",
    OWNER_GOOGLE_SUB: "owner"
  };
  const authRequest = (path, init) => secureWorker.fetch(new Request(`https://life.example${path}`, init), authEnv, {});
  const loginAs = async (identity) => {
    const nonceResponse = await authRequest("/api/auth/nonce");
    const nonceBody = await json(nonceResponse);
    const loginResponse = await authRequest("/api/auth/google", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://life.example",
        Cookie: `__Host-lc_oauth_nonce=${nonceBody.nonce}`
      },
      body: JSON.stringify({ credential: identity, nonce: nonceBody.nonce })
    });
    return cookieValue(loginResponse, "__Host-lc_session");
  };
  const envelope = {
    format: "life-compass-encrypted-backup",
    version: 1,
    encryption: { name: "AES-GCM", keyLength: 256, iv: "AAAAAAAAAAAAAAAA" },
    keyDerivation: { name: "PBKDF2", hash: "SHA-256", iterations: 600000, salt: "AAAAAAAAAAAAAAAAAAAAAA==" },
    ciphertext: "AQIDBAUGBwgJCgsMDQ4PEBES"
  };

  const anonymousList = await authRequest("/api/backups");
  assert.equal(anonymousList.status, 401);

  const ownerCookie = await loginAs("owner");
  const ownerHeaders = { Cookie: `__Host-lc_session=${ownerCookie}` };
  const crossOrigin = await authRequest("/api/backups", {
    method: "POST",
    headers: { ...ownerHeaders, "Content-Type": "application/json", Origin: "https://attacker.example" },
    body: JSON.stringify({ planVersion: 3, envelope })
  });
  assert.equal(crossOrigin.status, 403);

  const createResponse = await authRequest("/api/backups", {
    method: "POST",
    headers: { ...ownerHeaders, "Content-Type": "application/json", Origin: "https://life.example" },
    body: JSON.stringify({ planVersion: 3, envelope })
  });
  const created = await json(createResponse);
  assert.equal(createResponse.status, 201);
  assert.equal(DB.cloudBackups.size, 1);
  assert.equal(BACKUPS.objects.size, 1);
  assert.equal(created.backup.planVersion, 3);

  const listResponse = await authRequest("/api/backups", { headers: ownerHeaders });
  const list = await json(listResponse);
  assert.equal(listResponse.status, 200);
  assert.equal(list.backups.length, 1);
  assert.equal(JSON.stringify(list).includes("r2_object_key"), false);

  const otherCookie = await loginAs("other");
  const otherRead = await authRequest(`/api/backups/${created.backup.id}`, {
    headers: { Cookie: `__Host-lc_session=${otherCookie}` }
  });
  assert.equal(otherRead.status, 403);

  const downloadResponse = await authRequest(`/api/backups/${created.backup.id}`, { headers: ownerHeaders });
  const download = await json(downloadResponse);
  assert.deepEqual(download.envelope, envelope);

  const objectKey = [...BACKUPS.objects.keys()][0];
  BACKUPS.objects.set(objectKey, `${BACKUPS.objects.get(objectKey)} `);
  const tampered = await authRequest(`/api/backups/${created.backup.id}`, { headers: ownerHeaders });
  assert.equal(tampered.status, 409);
  BACKUPS.objects.set(objectKey, JSON.stringify(envelope));

  const deleteResponse = await authRequest(`/api/backups/${created.backup.id}`, {
    method: "DELETE",
    headers: { ...ownerHeaders, Origin: "https://life.example" }
  });
  assert.equal(deleteResponse.status, 200);
  assert.equal(DB.cloudBackups.size, 0);
  assert.equal(BACKUPS.objects.size, 0);

  DB.failCloudBackupInsert = true;
  const originalConsoleError = console.error;
  console.error = () => {};
  let failedMetadata;
  try {
    failedMetadata = await authRequest("/api/backups", {
      method: "POST",
      headers: { ...ownerHeaders, "Content-Type": "application/json", Origin: "https://life.example" },
      body: JSON.stringify({ planVersion: 3, envelope })
    });
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(failedMetadata.status, 500);
  assert.equal(DB.cloudBackups.size, 0);
  assert.equal(BACKUPS.objects.size, 0);
});

test("cloud backup preview rejects users other than the configured owner", async () => {
  const DB = new FakeD1();
  const BACKUPS = new FakeR2();
  const secureWorker = createWorker({
    verifyGoogleToken: async () => ({ sub: "not-allowed", email: "not-allowed@example.com", emailVerified: true })
  });
  const authEnv = {
    ...env,
    DB,
    BACKUPS,
    GOOGLE_CLIENT_ID: "google-client-id",
    CLOUD_BACKUP_MODE: "preview",
    OWNER_GOOGLE_SUB: "owner"
  };
  const authRequest = (path, init) => secureWorker.fetch(new Request(`https://life.example${path}`, init), authEnv, {});
  const nonceResponse = await authRequest("/api/auth/nonce");
  const nonceBody = await json(nonceResponse);
  const loginResponse = await authRequest("/api/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://life.example", Cookie: `__Host-lc_oauth_nonce=${nonceBody.nonce}` },
    body: JSON.stringify({ credential: "valid", nonce: nonceBody.nonce })
  });
  const sessionCookie = cookieValue(loginResponse, "__Host-lc_session");
  const response = await authRequest("/api/backups", { headers: { Cookie: `__Host-lc_session=${sessionCookie}` } });
  assert.equal(response.status, 403);
});

test("cloud backup preview rejects an unverified owner identity", async () => {
  const DB = new FakeD1();
  const secureWorker = createWorker({
    verifyGoogleToken: async () => ({ sub: "unverified", email: "owner@example.com", emailVerified: false })
  });
  const authEnv = {
    ...env,
    DB,
    BACKUPS: new FakeR2(),
    GOOGLE_CLIENT_ID: "google-client-id",
    CLOUD_BACKUP_MODE: "preview",
    OWNER_GOOGLE_SUB: "unverified"
  };
  const authRequest = (path, init) => secureWorker.fetch(new Request(`https://life.example${path}`, init), authEnv, {});
  const nonceResponse = await authRequest("/api/auth/nonce");
  const nonceBody = await json(nonceResponse);
  const loginResponse = await authRequest("/api/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://life.example", Cookie: `__Host-lc_oauth_nonce=${nonceBody.nonce}` },
    body: JSON.stringify({ credential: "valid", nonce: nonceBody.nonce })
  });
  const sessionCookie = cookieValue(loginResponse, "__Host-lc_session");
  const response = await authRequest("/api/backups", { headers: { Cookie: `__Host-lc_session=${sessionCookie}` } });
  assert.equal(response.status, 403);
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
  assert.deepEqual(config.ratelimits.map((item) => item.name), ["AUTH_RATE_LIMITER", "BACKUP_RATE_LIMITER"]);
});

test("authentication rate limiting returns 429 without issuing a nonce", async () => {
  const response = await worker.fetch(new Request("https://life.example/api/auth/nonce", {
    headers: { "CF-Connecting-IP": "192.0.2.1" }
  }), {
    ...env,
    DB: new FakeD1(),
    GOOGLE_CLIENT_ID: "google-client-id",
    AUTH_RATE_LIMITER: { limit: async () => ({ success: false }) }
  }, {});
  const body = await json(response);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.equal(body.error.code, "rate_limited");
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
  assert.equal(me.privacy.plainPlanDataStoredOnServer, false);

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
  const BACKUPS = new FakeR2();
  const secureWorker = createWorker({
    verifyGoogleToken: async () => ({ sub: "delete-sub", email: "delete@example.com", emailVerified: true })
  });
  const authEnv = { ...env, DB, BACKUPS, GOOGLE_CLIENT_ID: "google-client-id" };
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

  const session = [...DB.sessionsByHash.values()][0];
  session.created_at = Math.floor(Date.now() / 1000) - 601;
  const staleSession = await authRequest("/api/account", {
    method: "DELETE",
    headers: { ...sessionHeaders, Origin: "https://life.example" },
    body: JSON.stringify({ confirmation: "DELETE_ACCOUNT" })
  });
  assert.equal(staleSession.status, 401);
  session.created_at = Math.floor(Date.now() / 1000);

  const unconfirmed = await authRequest("/api/account", {
    method: "DELETE",
    headers: { ...sessionHeaders, Origin: "https://life.example" },
    body: JSON.stringify({ confirmation: "" })
  });
  assert.equal(unconfirmed.status, 400);
  assert.equal(DB.usersBySub.size, 1);

  const userId = [...DB.usersById.keys()][0];
  DB.subscriptionsByProviderId.set("square:account-delete-subscription", {
    id: "account-delete-subscription",
    user_id: userId,
    tier: "pro",
    status: "active",
    payment_status: "paid",
    current_period_end: utcDateAfter(30)
  });
  const activeSubscription = await authRequest("/api/account", {
    method: "DELETE",
    headers: { ...sessionHeaders, Origin: "https://life.example" },
    body: JSON.stringify({ confirmation: "DELETE_ACCOUNT" })
  });
  const activeSubscriptionBody = await json(activeSubscription);
  assert.equal(activeSubscription.status, 409);
  assert.equal(activeSubscriptionBody.error.code, "active_subscription");
  DB.subscriptionsByProviderId.delete("square:account-delete-subscription");

  const objectKey = `users/${userId}/backups/account-delete-test.json`;
  BACKUPS.objects.set(objectKey, "encrypted");
  DB.cloudBackups.set("account-delete-test", {
    id: "account-delete-test",
    user_id: userId,
    r2_object_key: objectKey
  });

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
  assert.equal(DB.cloudBackups.size, 0);
  assert.equal(BACKUPS.objects.size, 0);

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

test("logout-all revokes every active session for the signed-in user", async () => {
  const DB = new FakeD1();
  const secureWorker = createWorker({
    verifyGoogleToken: async () => ({ sub: "same-user", email: "same@example.com", emailVerified: true })
  });
  const authEnv = { ...env, DB, GOOGLE_CLIENT_ID: "google-client-id" };
  const authRequest = (path, init) => secureWorker.fetch(new Request(`https://life.example${path}`, init), authEnv, {});
  const login = async () => {
    const nonceResponse = await authRequest("/api/auth/nonce");
    const nonceBody = await json(nonceResponse);
    const response = await authRequest("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://life.example", Cookie: `__Host-lc_oauth_nonce=${nonceBody.nonce}` },
      body: JSON.stringify({ credential: "valid", nonce: nonceBody.nonce })
    });
    return cookieValue(response, "__Host-lc_session");
  };

  const firstCookie = await login();
  const secondCookie = await login();
  assert.equal(DB.sessionsByHash.size, 2);

  const response = await authRequest("/api/auth/logout-all", {
    method: "POST",
    headers: { Origin: "https://life.example", Cookie: `__Host-lc_session=${firstCookie}` }
  });
  assert.equal(response.status, 200);
  assert.equal([...DB.sessionsByHash.values()].every((session) => Boolean(session.revoked_at)), true);

  const secondSession = await authRequest("/api/me", { headers: { Cookie: `__Host-lc_session=${secondCookie}` } });
  assert.equal((await json(secondSession)).authenticated, false);
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
  const errorLogs = [];
  const originalConsoleError = console.error;
  console.error = (message) => errorLogs.push(String(message));
  let response;
  try {
    response = await worker.fetch(new Request("https://life.example/api/me", {
      headers: { Cookie: "__Host-lc_session=untrusted-session-token", "CF-Ray": "safe-ray-id" }
    }), brokenEnv, {});
  } finally {
    console.error = originalConsoleError;
  }
  const body = await json(response);
  assert.equal(response.status, 500);
  assert.equal(body.error.code, "internal_error");
  assert.equal(JSON.stringify(body).includes("private database"), false);
  assert.equal(JSON.stringify(body).includes("untrusted-session-token"), false);
  assert.equal(errorLogs.length, 1);
  assert.deepEqual(JSON.parse(errorLogs[0]), {
    event: "worker_error",
    scope: "api_request",
    method: "GET",
    ray: "safe-ray-id",
    errorName: "Error"
  });
  assert.equal(errorLogs[0].includes("private database"), false);
  assert.equal(errorLogs[0].includes("untrusted-session-token"), false);
});
