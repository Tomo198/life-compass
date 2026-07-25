import {
  AuthError,
  cleanupSessions,
  deleteAccount,
  getAuthConfig,
  getCurrentUser,
  isAuthConfigured,
  issueGoogleNonce,
  loginWithGoogle,
  logout,
  logoutAll,
  publicUser,
  verifyGoogleIdToken
} from "./auth.js";
import { handleBackupsRequest } from "./backups.js";
import {
  createSquareCheckoutResponse,
  getBillingConfig,
  handleSquareWebhook
} from "./billing.js";
import {
  getHouseholdSharingMode,
  resolveHouseholdAccess,
  resolvePersonalAccess
} from "./access.js";
import { cleanupExpiredHouseholds, handleHouseholdRequest } from "./households.js";
import { cleanupPendingSharedPlanObjects, handleSharedPlanRequest } from "./sharedPlans.js";

const securityHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Frame-Options": "DENY"
};

const browserContentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com/gsi/client",
  "style-src 'self' https://accounts.google.com/gsi/style",
  "connect-src 'self' https://accounts.google.com/gsi/",
  "frame-src https://accounts.google.com/gsi/",
  "img-src 'self' data:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

const secureStaticResponse = (request, response) => {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", browserContentSecurityPolicy);
  headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  if (new URL(request.url).protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};

const methodNotAllowed = (allow) =>
  jsonResponse(
    {
      ok: false,
      error: {
        code: "method_not_allowed",
        message: "This API endpoint does not support the requested method."
      }
    },
    405,
    { Allow: allow }
  );

const privacyBaseline = {
  plainPlanDataStoredOnServer: false,
  encryptedBackupOnly: true,
  automaticCloudSync: false
};

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...securityHeaders,
      ...headers
    }
  });
}

const reportWorkerError = (request, scope, error) => {
  console.error(JSON.stringify({
    event: "worker_error",
    scope,
    method: request.method,
    ray: request.headers.get("CF-Ray") || null,
    errorName: error instanceof Error ? error.name : "UnknownError"
  }));
};

const internalErrorResponse = (request, scope, error, message) => {
  reportWorkerError(request, scope, error);
  return jsonResponse({ ok: false, error: { code: "internal_error", message } }, 500);
};

function healthResponse() {
  return jsonResponse({
    ok: true,
    service: "life-compass-api",
    mode: "scaffold",
    privacy: privacyBaseline
  });
}

async function meResponse(request, env) {
  const user = await getCurrentUser(request, env);
  return jsonResponse({
    ok: true,
    authenticated: Boolean(user),
    user: publicUser(user),
    loginConfigured: isAuthConfigured(env),
    privacy: privacyBaseline
  });
}

async function entitlementResponse(request, env) {
  const user = await getCurrentUser(request, env);
  const personalAccess = await resolvePersonalAccess(user, env);
  const householdAccess = getHouseholdSharingMode(env) === "disabled"
    ? await resolveHouseholdAccess(null, env)
    : await resolveHouseholdAccess(user, env);
  const tier = personalAccess.tier;
  const mode = env?.ACCESS_MODE === "preview" ? "preview" : "enforced";
  const effectiveTier = mode === "preview" ? "pro" : tier;
  const billingConfigured = getBillingConfig(env).configured;

  return jsonResponse({
    ok: true,
    access: {
      tier,
      mode,
      source: personalAccess.source === "anonymous" && mode === "preview"
        ? "local-preview"
        : personalAccess.source,
      effectiveTier,
      billingConfigured,
      currentPeriodEnd: personalAccess.currentPeriodEnd,
      cancelAtPeriodEnd: personalAccess.cancelAtPeriodEnd,
      household: householdAccess
    },
    limits: {
      planLimit: effectiveTier === "pro" ? 20 : 1,
      scenarioLimit: effectiveTier === "pro" ? 20 : 0
    },
    privacy: privacyBaseline
  });
}

function notFoundResponse() {
  return jsonResponse(
    {
      ok: false,
      error: {
        code: "not_found",
        message: "API endpoint not found."
      }
    },
    404
  );
}

const authErrorResponse = (error) => jsonResponse(
  {
    ok: false,
    error: {
      code: error.code,
      message: error.message
    }
  },
  error.status
);

const rateLimitResponse = () => jsonResponse(
  { ok: false, error: { code: "rate_limited", message: "Too many requests. Try again later." } },
  429,
  { "Retry-After": "60" }
);

const authRateLimited = async (request, env, action) => {
  if (!env?.AUTH_RATE_LIMITER) return false;
  const actor = request.headers.get("CF-Connecting-IP") || "local";
  const result = await env.AUTH_RATE_LIMITER.limit({ key: `${action}:${actor}` });
  return !result.success;
};

async function handleApiRequest(request, env, services) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  }

  if (pathname === "/api/health") {
    return request.method === "GET" ? healthResponse() : methodNotAllowed("GET, OPTIONS");
  }

  if (pathname === "/api/me") {
    return request.method === "GET" ? meResponse(request, env) : methodNotAllowed("GET, OPTIONS");
  }

  if (pathname === "/api/entitlement") {
    return request.method === "GET" ? entitlementResponse(request, env) : methodNotAllowed("GET, OPTIONS");
  }

  if (pathname === "/api/billing/config") {
    return request.method === "GET"
      ? jsonResponse({ ok: true, billing: getBillingConfig(env) })
      : methodNotAllowed("GET, OPTIONS");
  }

  if (pathname === "/api/billing/checkout") {
    if (request.method !== "POST") return methodNotAllowed("POST, OPTIONS");
    try {
      return await createSquareCheckoutResponse(request, env, jsonResponse);
    } catch (error) {
      return error instanceof AuthError
        ? authErrorResponse(error)
        : internalErrorResponse(request, "billing_checkout", error, "Checkout is temporarily unavailable.");
    }
  }

  if (pathname === "/api/billing/square/webhook") {
    if (request.method !== "POST") return methodNotAllowed("POST, OPTIONS");
    try {
      return await handleSquareWebhook(request, env, jsonResponse, { squareFetch: services.squareFetch });
    } catch (error) {
      return error instanceof AuthError
        ? authErrorResponse(error)
        : internalErrorResponse(request, "billing_square_webhook", error, "Billing synchronization is temporarily unavailable.");
    }
  }

  if (pathname === "/api/backups" || pathname.startsWith("/api/backups/")) {
    try {
      return await handleBackupsRequest(request, env, jsonResponse, privacyBaseline);
    } catch (error) {
      return error instanceof AuthError
        ? authErrorResponse(error)
        : internalErrorResponse(request, "backups", error, "Encrypted backup is temporarily unavailable.");
    }
  }

  if (pathname === "/api/shared-household" || pathname.startsWith("/api/shared-household/")) {
    try {
      const sharedPlanPath = pathname === "/api/shared-household/plan"
        || pathname === "/api/shared-household/plan/rotate-key"
        || pathname === "/api/shared-household/revisions"
        || pathname.startsWith("/api/shared-household/revisions/");
      return sharedPlanPath
        ? await handleSharedPlanRequest(request, env, jsonResponse)
        : await handleHouseholdRequest(request, env, jsonResponse);
    } catch (error) {
      return error instanceof AuthError
        ? authErrorResponse(error)
        : internalErrorResponse(request, "shared_household", error, "Household sharing is temporarily unavailable.");
    }
  }

  if (pathname === "/api/auth/config") {
    return request.method === "GET"
      ? jsonResponse({ ok: true, ...getAuthConfig(env), privacy: privacyBaseline })
      : methodNotAllowed("GET, OPTIONS");
  }

  if (pathname === "/api/auth/nonce") {
    if (request.method !== "GET") return methodNotAllowed("GET, OPTIONS");
    if (await authRateLimited(request, env, "nonce")) return rateLimitResponse();
    try {
      return issueGoogleNonce(request, env, jsonResponse);
    } catch (error) {
      return error instanceof AuthError
        ? authErrorResponse(error)
        : internalErrorResponse(request, "auth_nonce", error, "Authentication is temporarily unavailable.");
    }
  }

  if (pathname === "/api/auth/google") {
    if (request.method !== "POST") return methodNotAllowed("POST, OPTIONS");
    if (await authRateLimited(request, env, "google")) return rateLimitResponse();
    try {
      return await loginWithGoogle(request, env, services.verifyGoogleToken, jsonResponse);
    } catch (error) {
      return error instanceof AuthError
        ? authErrorResponse(error)
        : internalErrorResponse(request, "auth_google", error, "Authentication is temporarily unavailable.");
    }
  }

  if (pathname === "/api/auth/logout") {
    if (request.method !== "POST") return methodNotAllowed("POST, OPTIONS");
    try {
      return await logout(request, env, jsonResponse);
    } catch (error) {
      return error instanceof AuthError
        ? authErrorResponse(error)
        : internalErrorResponse(request, "auth_logout", error, "Authentication is temporarily unavailable.");
    }
  }

  if (pathname === "/api/auth/logout-all") {
    if (request.method !== "POST") return methodNotAllowed("POST, OPTIONS");
    if (await authRateLimited(request, env, "logout-all")) return rateLimitResponse();
    try {
      return await logoutAll(request, env, jsonResponse);
    } catch (error) {
      return error instanceof AuthError
        ? authErrorResponse(error)
        : internalErrorResponse(request, "auth_logout_all", error, "Session revocation is temporarily unavailable.");
    }
  }

  if (pathname === "/api/account") {
    if (request.method !== "DELETE") return methodNotAllowed("DELETE, OPTIONS");
    if (await authRateLimited(request, env, "account-delete")) return rateLimitResponse();
    try {
      return await deleteAccount(request, env, jsonResponse);
    } catch (error) {
      return error instanceof AuthError
        ? authErrorResponse(error)
        : internalErrorResponse(request, "account_delete", error, "Account deletion is temporarily unavailable.");
    }
  }

  return notFoundResponse();
}

export const createWorker = ({ verifyGoogleToken = verifyGoogleIdToken, squareFetch = fetch } = {}) => ({
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApiRequest(request, env, { verifyGoogleToken, squareFetch });
      } catch (error) {
        return internalErrorResponse(request, "api_request", error, "The service is temporarily unavailable.");
      }
    }

    if (env?.ASSETS?.fetch) {
      return secureStaticResponse(request, await env.ASSETS.fetch(request));
    }

    return new Response("Static assets binding is not available.", {
      status: 500,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff"
      }
    });
  },
  async scheduled(_controller, env) {
    await cleanupSessions(env);
    await cleanupPendingSharedPlanObjects(env);
    await cleanupExpiredHouseholds(env);
  }
});

export default createWorker();
