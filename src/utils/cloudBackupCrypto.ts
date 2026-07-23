import { MAX_CLOUD_BACKUP_PLAINTEXT_BYTES } from "../config";
import type { LifePlan } from "../types";
import {
  base64ToBytes,
  bytesToBase64,
  deriveAesGcmKey,
  toArrayBuffer,
  validatePasswordLength
} from "./passwordCrypto";

export const CLOUD_BACKUP_FORMAT = "life-compass-encrypted-backup";
export const CLOUD_BACKUP_VERSION = 1;
export const CLOUD_BACKUP_ITERATIONS = 600_000;
const CLOUD_BACKUP_AAD = "Life Compass encrypted backup v1";

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

const validatePassword = (password: string) => {
  validatePasswordLength(password, "復旧パスワード");
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

  const invalidMessage = "暗号化バックアップの形式が正しくありません。";
  const salt = base64ToBytes(envelope.keyDerivation.salt || "", invalidMessage);
  const iv = base64ToBytes(envelope.encryption.iv || "", invalidMessage);
  const ciphertext = base64ToBytes(envelope.ciphertext, invalidMessage);
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
  const key = await deriveAesGcmKey(password, salt, CLOUD_BACKUP_ITERATIONS, ["encrypt"]);
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
  const invalidMessage = "暗号化バックアップの形式が正しくありません。";
  const salt = base64ToBytes(envelope.keyDerivation.salt, invalidMessage);
  const iv = base64ToBytes(envelope.encryption.iv, invalidMessage);
  const ciphertext = base64ToBytes(envelope.ciphertext, invalidMessage);
  const key = await deriveAesGcmKey(password, salt, CLOUD_BACKUP_ITERATIONS, ["decrypt"]);

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
