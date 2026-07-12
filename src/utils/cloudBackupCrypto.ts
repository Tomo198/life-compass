import { MAX_CLOUD_BACKUP_PLAINTEXT_BYTES } from "../config";
import type { LifePlan } from "../types";

export const CLOUD_BACKUP_FORMAT = "life-compass-encrypted-backup";
export const CLOUD_BACKUP_VERSION = 1;
export const CLOUD_BACKUP_ITERATIONS = 600_000;
const CLOUD_BACKUP_AAD = "Life Compass encrypted backup v1";
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 200;

export type EncryptedCloudBackupEnvelope = {
  format: typeof CLOUD_BACKUP_FORMAT;
  version: typeof CLOUD_BACKUP_VERSION;
  encryption: {
    name: "AES-GCM";
    keyLength: 256;
    iv: string;
  };
  keyDerivation: {
    name: "PBKDF2";
    hash: "SHA-256";
    iterations: typeof CLOUD_BACKUP_ITERATIONS;
    salt: string;
  };
  ciphertext: string;
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

const base64ToBytes = (value: string) => {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) throw new Error("暗号化バックアップの形式が正しくありません。");
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new Error("暗号化バックアップの形式が正しくありません。");
  }
};

const toArrayBuffer = (bytes: Uint8Array) => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

const validatePassword = (password: string) => {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error("復旧パスワードは12文字以上で入力してください。");
  if (password.length > MAX_PASSWORD_LENGTH) throw new Error("復旧パスワードは200文字以内で入力してください。");
};

const deriveKey = async (password: string, salt: Uint8Array, usage: KeyUsage[]) => {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: toArrayBuffer(salt), iterations: CLOUD_BACKUP_ITERATIONS },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    usage
  );
};

export const validateEncryptedCloudBackupEnvelope = (value: unknown): EncryptedCloudBackupEnvelope => {
  const envelope = value as Partial<EncryptedCloudBackupEnvelope>;
  if (
    !envelope ||
    typeof envelope !== "object" ||
    envelope.format !== CLOUD_BACKUP_FORMAT ||
    envelope.version !== CLOUD_BACKUP_VERSION ||
    envelope.encryption?.name !== "AES-GCM" ||
    envelope.encryption.keyLength !== 256 ||
    envelope.keyDerivation?.name !== "PBKDF2" ||
    envelope.keyDerivation.hash !== "SHA-256" ||
    envelope.keyDerivation.iterations !== CLOUD_BACKUP_ITERATIONS ||
    typeof envelope.ciphertext !== "string"
  ) {
    throw new Error("暗号化バックアップの形式が正しくありません。");
  }

  const salt = base64ToBytes(envelope.keyDerivation.salt || "");
  const iv = base64ToBytes(envelope.encryption.iv || "");
  const ciphertext = base64ToBytes(envelope.ciphertext);
  if (salt.byteLength !== 16 || iv.byteLength !== 12 || ciphertext.byteLength < 17) {
    throw new Error("暗号化バックアップの形式が正しくありません。");
  }
  if (ciphertext.byteLength > MAX_CLOUD_BACKUP_PLAINTEXT_BYTES + 16) {
    throw new Error("暗号化バックアップが大きすぎます。");
  }
  return envelope as EncryptedCloudBackupEnvelope;
};

export const encryptCloudBackup = async (plan: LifePlan, password: string): Promise<EncryptedCloudBackupEnvelope> => {
  validatePassword(password);
  const plaintext = new TextEncoder().encode(JSON.stringify({
    format: "life-compass-plan",
    version: 1,
    createdAt: new Date().toISOString(),
    plan
  }));
  if (plaintext.byteLength > MAX_CLOUD_BACKUP_PLAINTEXT_BYTES) {
    throw new Error("クラウドバックアップに保存できるサイズを超えています。JSONエクスポートを利用してください。");
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: new TextEncoder().encode(CLOUD_BACKUP_AAD), tagLength: 128 },
    key,
    plaintext
  );

  return {
    format: CLOUD_BACKUP_FORMAT,
    version: CLOUD_BACKUP_VERSION,
    encryption: { name: "AES-GCM", keyLength: 256, iv: bytesToBase64(iv) },
    keyDerivation: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: CLOUD_BACKUP_ITERATIONS,
      salt: bytesToBase64(salt)
    },
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
};

export const decryptCloudBackup = async (value: unknown, password: string): Promise<LifePlan> => {
  validatePassword(password);
  const envelope = validateEncryptedCloudBackupEnvelope(value);
  const salt = base64ToBytes(envelope.keyDerivation.salt);
  const iv = base64ToBytes(envelope.encryption.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);
  const key = await deriveKey(password, salt, ["decrypt"]);

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: new TextEncoder().encode(CLOUD_BACKUP_AAD), tagLength: 128 },
      key,
      toArrayBuffer(ciphertext)
    );
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as { format?: string; version?: number; plan?: LifePlan };
    if (parsed.format !== "life-compass-plan" || parsed.version !== 1 || !parsed.plan) {
      throw new Error("invalid plaintext");
    }
    return parsed.plan;
  } catch {
    throw new Error("復旧パスワードが違うか、バックアップが破損しています。");
  }
};
