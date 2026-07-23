const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 200;

export const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

export const base64ToBytes = (value: string, invalidMessage: string) => {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) throw new Error(invalidMessage);
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new Error(invalidMessage);
  }
};

export const toArrayBuffer = (bytes: Uint8Array) => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

export const validatePasswordLength = (password: string, label: string) => {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`${label}は12文字以上で入力してください。`);
  if (password.length > MAX_PASSWORD_LENGTH) throw new Error(`${label}は200文字以内で入力してください。`);
};

export const deriveAesGcmKey = async (
  password: string,
  salt: Uint8Array,
  iterations: number,
  usage: KeyUsage[]
) => {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: toArrayBuffer(salt), iterations },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    usage
  );
};
