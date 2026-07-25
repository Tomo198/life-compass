import { AuthError, getCurrentUser } from "./auth.js";

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;
const SQUARE_API_VERSION = "2026-05-20";
const SQUARE_PROVIDER = "square";
const terminalEventStatuses = new Set(["processed", "ignored", "unmatched", "ownership_mismatch"]);

const sameOrigin = (request) => request.headers.get("Origin") === new URL(request.url).origin;
const normalizedEmail = (value) => typeof value === "string" ? value.trim().toLowerCase() : "";
const squareEnvironment = (env) => env?.SQUARE_ENVIRONMENT === "sandbox" ? "sandbox" : "production";
const squareApiOrigin = (env) => squareEnvironment(env) === "sandbox"
  ? "https://connect.squareupsandbox.com"
  : "https://connect.squareup.com";

const requiredSquareSettings = (env) => [
  env?.DB,
  env?.SQUARE_ACCESS_TOKEN,
  env?.SQUARE_WEBHOOK_SIGNATURE_KEY,
  env?.SQUARE_WEBHOOK_NOTIFICATION_URL,
  env?.SQUARE_PLAN_VARIATION_ID,
  env?.SQUARE_MERCHANT_ID
];

export const isSquareBillingConfigured = (env) => requiredSquareSettings(env).every(Boolean);

const validSquarePaymentLink = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["square.link", "checkout.square.site", "squareup.com"].includes(url.hostname);
  } catch {
    return false;
  }
};

export const getBillingConfig = (env) => ({
  provider: SQUARE_PROVIDER,
  configured: isSquareBillingConfigured(env),
  checkoutAvailable: isSquareBillingConfigured(env) && validSquarePaymentLink(env?.SQUARE_PAYMENT_LINK_URL),
  environment: squareEnvironment(env)
});

const constantTimeEqual = (left, right) => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

const signSquareWebhook = async (notificationUrl, body, signatureKey) => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signatureKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${notificationUrl}${body}`)));
  let binary = "";
  signature.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
};

export const verifySquareWebhookSignature = async ({ notificationUrl, body, signatureKey, signatureHeader }) => {
  if (!notificationUrl || !body || !signatureKey || !signatureHeader) return false;
  const expected = await signSquareWebhook(notificationUrl, body, signatureKey);
  return constantTimeEqual(expected, signatureHeader);
};

const readWebhookBody = async (request) => {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    throw new AuthError(413, "webhook_too_large", "Webhook payload is too large.");
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_WEBHOOK_BODY_BYTES) {
    throw new AuthError(413, "webhook_too_large", "Webhook payload is too large.");
  }
  return body;
};

const squareRequest = async (env, path, squareFetch) => {
  const response = await squareFetch(`${squareApiOrigin(env)}${path}`, {
    headers: {
      Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      "Square-Version": env.SQUARE_API_VERSION || SQUARE_API_VERSION
    }
  });
  if (!response.ok) throw new Error(`Square API request failed with status ${response.status}.`);
  return response.json();
};

const retrieveSquareCustomer = async (env, customerId, squareFetch) => {
  const body = await squareRequest(env, `/v2/customers/${encodeURIComponent(customerId)}`, squareFetch);
  return body.customer || null;
};

const retrieveSquareSubscription = async (env, subscriptionId, squareFetch) => {
  const body = await squareRequest(env, `/v2/subscriptions/${encodeURIComponent(subscriptionId)}`, squareFetch);
  return body.subscription || null;
};

const mapSquareSubscriptionStatus = (status) => ({
  ACTIVE: "active",
  PENDING: "pending",
  PAUSED: "paused",
  CANCELED: "canceled",
  DEACTIVATED: "deactivated",
  COMPLETED: "completed"
}[status] || "unknown");

const findVerifiedUserByEmail = async (env, email) => {
  if (!email) return null;
  return env.DB.prepare(
    `SELECT id, email, email_verified
       FROM users
      WHERE email_verified = 1
        AND lower(email) = lower(?)
        AND deleted_at IS NULL
      LIMIT 1`
  ).bind(email).first();
};

const findSubscription = async (env, subscriptionId) => env.DB.prepare(
  `SELECT id, user_id, provider_customer_id, payment_status
     FROM subscriptions
    WHERE billing_provider = ?
      AND provider_subscription_id = ?
    LIMIT 1`
).bind(SQUARE_PROVIDER, subscriptionId).first();

const saveSquareSubscription = async (env, user, subscription, paymentStatus) => {
  const existing = await findSubscription(env, subscription.id);
  const status = mapSquareSubscriptionStatus(subscription.status);
  const currentPeriodEnd = subscription.charged_through_date || null;
  const cancelAtPeriodEnd = status === "active" && Boolean(subscription.canceled_date) ? 1 : 0;
  const nextPaymentStatus = paymentStatus || existing?.payment_status || "unknown";

  if (existing) {
    if (
      existing.user_id !== user.id
      || (
        existing.provider_customer_id
        && existing.provider_customer_id !== subscription.customer_id
      )
    ) {
      return { status: "ownership_mismatch", subscriptionId: existing.id };
    }
    await env.DB.prepare(
      `UPDATE subscriptions
          SET user_id = ?, provider_customer_id = ?, provider_plan_id = ?, tier = 'pro',
              status = ?, payment_status = ?, current_period_end = ?, cancel_at_period_end = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`
    ).bind(
      user.id,
      subscription.customer_id,
      subscription.plan_variation_id,
      status,
      nextPaymentStatus,
      currentPeriodEnd,
      cancelAtPeriodEnd,
      existing.id
    ).run();
    return { status: "processed", subscriptionId: existing.id };
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO subscriptions
      (id, user_id, billing_provider, provider_customer_id, provider_subscription_id,
       provider_plan_id, tier, status, payment_status, current_period_end, cancel_at_period_end)
     VALUES (?, ?, ?, ?, ?, ?, 'pro', ?, ?, ?, ?)`
  ).bind(
    id,
    user.id,
    SQUARE_PROVIDER,
    subscription.customer_id,
    subscription.id,
    subscription.plan_variation_id,
    status,
    nextPaymentStatus,
    currentPeriodEnd,
    cancelAtPeriodEnd
  ).run();
  return { status: "processed", subscriptionId: id };
};

const syncSquareSubscription = async (env, subscription, squareFetch, paymentStatus) => {
  if (!subscription?.id || !subscription.customer_id || !subscription.plan_variation_id) {
    throw new Error("Square subscription payload is incomplete.");
  }
  if (subscription.plan_variation_id !== env.SQUARE_PLAN_VARIATION_ID) return { status: "ignored" };

  const customer = await retrieveSquareCustomer(env, subscription.customer_id, squareFetch);
  const email = normalizedEmail(customer?.email_address);
  const user = await findVerifiedUserByEmail(env, email);
  if (!user) return { status: "unmatched" };

  return saveSquareSubscription(env, user, subscription, paymentStatus);
};

const getInvoiceSubscriptionId = (event) => event?.data?.object?.invoice?.subscription_id || "";
const getEventSubscriptionId = (event) => ["subscription.created", "subscription.updated"].includes(event?.type)
  ? event?.data?.object?.subscription?.id || ""
  : getInvoiceSubscriptionId(event);

const processSquareEvent = async (env, event, squareFetch) => {
  if (["subscription.created", "subscription.updated"].includes(event.type)) {
    return syncSquareSubscription(env, event?.data?.object?.subscription, squareFetch);
  }
  if (["invoice.payment_made", "invoice.scheduled_charge_failed"].includes(event.type)) {
    const subscriptionId = getInvoiceSubscriptionId(event);
    if (!subscriptionId) throw new Error("Square invoice payload does not include a subscription ID.");
    const subscription = await retrieveSquareSubscription(env, subscriptionId, squareFetch);
    return syncSquareSubscription(
      env,
      subscription,
      squareFetch,
      event.type === "invoice.payment_made" ? "paid" : "failed"
    );
  }
  return { status: "ignored" };
};

const getStoredEvent = async (env, eventId) => env.DB.prepare(
  `SELECT id, status
     FROM billing_webhook_events
    WHERE provider = ? AND event_id = ?
    LIMIT 1`
).bind(SQUARE_PROVIDER, eventId).first();

const markEvent = async (env, eventId, status) => env.DB.prepare(
  `UPDATE billing_webhook_events
      SET status = ?, processed_at = CURRENT_TIMESTAMP
    WHERE provider = ? AND event_id = ?`
).bind(status, SQUARE_PROVIDER, eventId).run();

export const handleSquareWebhook = async (request, env, jsonResponse, { squareFetch = fetch } = {}) => {
  if (!isSquareBillingConfigured(env)) {
    throw new AuthError(501, "square_billing_not_configured", "Square billing is not configured.");
  }

  if (request.url !== env.SQUARE_WEBHOOK_NOTIFICATION_URL) {
    throw new AuthError(403, "invalid_webhook_url", "Webhook URL is invalid.");
  }
  const body = await readWebhookBody(request);
  const signature = request.headers.get("x-square-hmacsha256-signature") || "";
  const valid = await verifySquareWebhookSignature({
    notificationUrl: env.SQUARE_WEBHOOK_NOTIFICATION_URL,
    body,
    signatureKey: env.SQUARE_WEBHOOK_SIGNATURE_KEY,
    signatureHeader: signature
  });
  if (!valid) throw new AuthError(403, "invalid_webhook_signature", "Webhook signature is invalid.");

  let event;
  try {
    event = JSON.parse(body);
  } catch {
    throw new AuthError(400, "invalid_webhook_payload", "Webhook payload is invalid.");
  }
  if (!event?.event_id || !event?.type || event.merchant_id !== env.SQUARE_MERCHANT_ID) {
    throw new AuthError(403, "invalid_webhook_source", "Webhook source is invalid.");
  }

  const stored = await getStoredEvent(env, event.event_id);
  if (stored && terminalEventStatuses.has(stored.status)) {
    return jsonResponse({ ok: true, received: true, duplicate: true });
  }
  if (!stored) {
    await env.DB.prepare(
      `INSERT INTO billing_webhook_events
        (id, provider, event_id, event_type, provider_object_id, status)
       VALUES (?, ?, ?, ?, ?, 'received')`
    ).bind(
      crypto.randomUUID(),
      SQUARE_PROVIDER,
      event.event_id,
      event.type,
      getEventSubscriptionId(event) || null
    ).run();
  }

  const result = await processSquareEvent(env, event, squareFetch);
  await markEvent(env, event.event_id, result.status);
  return jsonResponse({ ok: true, received: true, processed: result.status === "processed" });
};

export const createSquareCheckoutResponse = async (request, env, jsonResponse) => {
  if (!sameOrigin(request)) {
    throw new AuthError(403, "invalid_origin", "Checkout request origin is invalid.");
  }
  const config = getBillingConfig(env);
  if (!config.checkoutAvailable) {
    throw new AuthError(501, "square_checkout_not_configured", "Square checkout is not configured.");
  }
  const user = await getCurrentUser(request, env);
  if (!user || !user.emailVerified || !user.email) {
    throw new AuthError(401, "verified_login_required", "Verified Google sign-in is required before checkout.");
  }
  return jsonResponse({
    ok: true,
    checkout: {
      provider: SQUARE_PROVIDER,
      url: env.SQUARE_PAYMENT_LINK_URL,
      accountEmail: user.email
    }
  });
};
