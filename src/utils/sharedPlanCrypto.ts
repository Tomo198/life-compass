import { MAX_SHARED_PLAN_PLAINTEXT_BYTES } from "../config";
import type { LifePlan } from "../types";
import {
  base64ToBytes,
  bytesToBase64,
  deriveAesGcmKey,
  toArrayBuffer,
  validatePasswordLength
} from "./passwordCrypto";
import { validateImportedPlan } from "./storage";

export const SHARED_PLAN_FORMAT = "life-compass-shared-plan";
export const SHARED_PLAN_VERSION = 1;
export const SHARED_PLAN_ITERATIONS = 600_000;

const householdIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const invalidFormatMessage = "共有プランの暗号化形式が正しくありません。";

export type SharedPlanCryptoContext = {
  householdId: string;
  revision: number;
  keyEpoch: number;
};

export type EncryptedSharedPlanEnvelope = {
  format: typeof SHARED_PLAN_FORMAT;
  version: typeof SHARED_PLAN_VERSION;
  householdId: string;
  revision: number;
  keyEpoch: number;
  encryption: {
    name: "AES-GCM";
    keyLength: 256;
    iv: string;
  };
  keyDerivation: {
    name: "PBKDF2";
    hash: "SHA-256";
    iterations: typeof SHARED_PLAN_ITERATIONS;
    salt: string;
  };
  ciphertext: string;
};

const validateContext = (context: SharedPlanCryptoContext) => {
  if (
    !householdIdPattern.test(context.householdId)
    || !Number.isInteger(context.revision)
    || context.revision < 1
    || !Number.isInteger(context.keyEpoch)
    || context.keyEpoch < 1
  ) {
    throw new Error(invalidFormatMessage);
  }
};

const contextAad = ({ householdId, revision, keyEpoch }: SharedPlanCryptoContext) =>
  new TextEncoder().encode(`Life Compass shared plan v1|${householdId}|${revision}|${keyEpoch}`);

export const validateEncryptedSharedPlanEnvelope = (
  value: unknown,
  expectedContext?: SharedPlanCryptoContext
): EncryptedSharedPlanEnvelope => {
  const envelope = value as Partial<EncryptedSharedPlanEnvelope>;
  if (
    !envelope
    || typeof envelope !== "object"
    || envelope.format !== SHARED_PLAN_FORMAT
    || envelope.version !== SHARED_PLAN_VERSION
    || typeof envelope.householdId !== "string"
    || !Number.isInteger(envelope.revision)
    || !Number.isInteger(envelope.keyEpoch)
    || envelope.encryption?.name !== "AES-GCM"
    || envelope.encryption.keyLength !== 256
    || envelope.keyDerivation?.name !== "PBKDF2"
    || envelope.keyDerivation.hash !== "SHA-256"
    || envelope.keyDerivation.iterations !== SHARED_PLAN_ITERATIONS
    || typeof envelope.ciphertext !== "string"
  ) {
    throw new Error(invalidFormatMessage);
  }

  const context = {
    householdId: envelope.householdId,
    revision: envelope.revision as number,
    keyEpoch: envelope.keyEpoch as number
  };
  validateContext(context);
  if (
    expectedContext
    && (
      context.householdId !== expectedContext.householdId
      || context.revision !== expectedContext.revision
      || context.keyEpoch !== expectedContext.keyEpoch
    )
  ) {
    throw new Error("共有プランの保存先または版情報が一致しません。");
  }

  const salt = base64ToBytes(envelope.keyDerivation.salt || "", invalidFormatMessage);
  const iv = base64ToBytes(envelope.encryption.iv || "", invalidFormatMessage);
  const ciphertext = base64ToBytes(envelope.ciphertext, invalidFormatMessage);
  if (salt.byteLength !== 16 || iv.byteLength !== 12 || ciphertext.byteLength < 17) {
    throw new Error(invalidFormatMessage);
  }
  if (ciphertext.byteLength > MAX_SHARED_PLAN_PLAINTEXT_BYTES + 16) {
    throw new Error("共有プランが大きすぎます。");
  }
  return envelope as EncryptedSharedPlanEnvelope;
};

export const encryptSharedPlan = async (
  plan: LifePlan,
  password: string,
  context: SharedPlanCryptoContext
): Promise<EncryptedSharedPlanEnvelope> => {
  validatePasswordLength(password, "共有パスワード");
  validateContext(context);
  const plaintext = new TextEncoder().encode(JSON.stringify({
    format: "life-compass-plan",
    version: 1,
    plan
  }));
  if (plaintext.byteLength > MAX_SHARED_PLAN_PLAINTEXT_BYTES) {
    throw new Error("共有プランに保存できるサイズを超えています。");
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesGcmKey(password, salt, SHARED_PLAN_ITERATIONS, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: contextAad(context),
      tagLength: 128
    },
    key,
    plaintext
  );

  return {
    format: SHARED_PLAN_FORMAT,
    version: SHARED_PLAN_VERSION,
    ...context,
    encryption: { name: "AES-GCM", keyLength: 256, iv: bytesToBase64(iv) },
    keyDerivation: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: SHARED_PLAN_ITERATIONS,
      salt: bytesToBase64(salt)
    },
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
};

export const decryptSharedPlan = async (
  value: unknown,
  password: string,
  expectedContext: SharedPlanCryptoContext
): Promise<LifePlan> => {
  validatePasswordLength(password, "共有パスワード");
  validateContext(expectedContext);
  const envelope = validateEncryptedSharedPlanEnvelope(value, expectedContext);
  const salt = base64ToBytes(envelope.keyDerivation.salt, invalidFormatMessage);
  const iv = base64ToBytes(envelope.encryption.iv, invalidFormatMessage);
  const ciphertext = base64ToBytes(envelope.ciphertext, invalidFormatMessage);
  const key = await deriveAesGcmKey(password, salt, SHARED_PLAN_ITERATIONS, ["decrypt"]);

  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(iv),
        additionalData: contextAad(expectedContext),
        tagLength: 128
      },
      key,
      toArrayBuffer(ciphertext)
    );
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as {
      format?: string;
      version?: number;
      plan?: LifePlan;
    };
    if (parsed.format !== "life-compass-plan" || parsed.version !== 1 || !parsed.plan) {
      throw new Error("invalid plaintext");
    }
    return validateImportedPlan(parsed.plan);
  } catch {
    throw new Error("共有パスワードが違うか、共有プランが改ざんまたは破損しています。");
  }
};
