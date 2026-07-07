const securityHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff"
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

const notConfigured = (feature) =>
  jsonResponse(
    {
      ok: false,
      error: {
        code: "not_configured",
        feature,
        message: "This server-side feature is not enabled yet."
      }
    },
    501
  );

const privacyBaseline = {
  planDataStoredOnServer: false,
  cloudBackupAvailable: false,
  cloudBackupEncryptedOnly: true
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

function healthResponse() {
  return jsonResponse({
    ok: true,
    service: "life-compass-api",
    mode: "scaffold",
    privacy: privacyBaseline
  });
}

function meResponse() {
  return jsonResponse({
    ok: true,
    authenticated: false,
    user: null,
    loginConfigured: false,
    privacy: privacyBaseline
  });
}

function entitlementResponse() {
  return jsonResponse({
    ok: true,
    access: {
      tier: "free",
      mode: "preview",
      source: "local-preview",
      effectiveTier: "pro",
      billingConfigured: false
    },
    limits: {
      planLimit: 1,
      scenarioLimit: 20
    },
    privacy: privacyBaseline
  });
}

function backupsResponse() {
  return jsonResponse({
    ok: true,
    available: false,
    backups: [],
    reason: "cloud_backup_not_configured",
    message: "Cloud backup is planned as an optional encrypted Pro feature. It is not enabled yet.",
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

async function handleApiRequest(request) {
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
    return request.method === "GET" ? meResponse() : methodNotAllowed("GET, OPTIONS");
  }

  if (pathname === "/api/entitlement") {
    return request.method === "GET" ? entitlementResponse() : methodNotAllowed("GET, OPTIONS");
  }

  if (pathname === "/api/backups") {
    if (request.method === "GET") return backupsResponse();
    if (request.method === "POST") return notConfigured("encrypted_cloud_backup");
    return methodNotAllowed("GET, POST, OPTIONS");
  }

  if (pathname === "/api/auth/google") {
    return request.method === "POST" ? notConfigured("google_login") : methodNotAllowed("POST, OPTIONS");
  }

  if (pathname === "/api/stripe/webhook") {
    return request.method === "POST" ? notConfigured("stripe_webhook") : methodNotAllowed("POST, OPTIONS");
  }

  return notFoundResponse();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApiRequest(request);
    }

    if (env?.ASSETS?.fetch) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Static assets binding is not available.", {
      status: 500,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff"
      }
    });
  }
};
