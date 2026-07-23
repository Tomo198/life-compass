export class AuthError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

export const bytesToBase64Url = (bytes) => {
  let binary = "";
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

export const randomToken = (length = 32) => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
};

export const sha256Base64Url = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
};

export const secureEqualText = async (left, right) => {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(typeof left === "string" ? left : "")),
    crypto.subtle.digest("SHA-256", encoder.encode(typeof right === "string" ? right : ""))
  ]);

  if (typeof crypto.subtle.timingSafeEqual === "function") {
    return crypto.subtle.timingSafeEqual(leftHash, rightHash);
  }

  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
};

export const sameOrigin = (request) =>
  request.headers.get("Origin") === new URL(request.url).origin;

const readBodyWithLimit = async (request, maxBytes, tooLargeError) => {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw tooLargeError();
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

export const parseBoundedJsonBody = async (
  request,
  {
    maxBytes,
    tooLargeCode = "request_too_large",
    tooLargeMessage = "Request is too large.",
    invalidCode = "invalid_json",
    invalidMessage = "Request body is invalid."
  }
) => {
  const contentType = (request.headers.get("Content-Type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new AuthError(415, "unsupported_media_type", "JSON request body required.");
  }

  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength && Number(declaredLength) > maxBytes) {
    throw new AuthError(413, tooLargeCode, tooLargeMessage);
  }

  const text = await readBodyWithLimit(
    request,
    maxBytes,
    () => new AuthError(413, tooLargeCode, tooLargeMessage)
  );
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid");
    return body;
  } catch {
    throw new AuthError(400, invalidCode, invalidMessage);
  }
};
