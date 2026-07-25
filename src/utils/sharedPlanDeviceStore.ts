import { validatePasswordLength } from "./passwordCrypto";

const DATABASE_NAME = "life-compass-secure-device";
const DATABASE_VERSION = 1;
const STORE_NAME = "shared-plan-credentials";
const TRUSTED_DEVICE_MARKER_KEY = "life-compass-shared-sync-device";

export type SharedPlanSyncMetadata = {
  lastRevision: number;
  lastPlanDigest: string;
  lastSyncedAt: string | null;
};

type TrustedDeviceRecord = Omit<SharedPlanSyncMetadata, "lastPlanDigest"> & {
  householdId: string;
  keyEpoch: number;
  deviceKey: CryptoKey;
  iv: ArrayBuffer;
  encryptedCredential: ArrayBuffer;
  createdAt: string;
};

export type TrustedSharedPlanCredential = SharedPlanSyncMetadata & {
  householdId: string;
  keyEpoch: number;
  password: string;
};

const additionalData = (householdId: string, keyEpoch: number) =>
  new TextEncoder().encode(`Life Compass trusted shared plan device v1|${householdId}|${keyEpoch}`);

const encryptCredentialPayload = (
  deviceKey: CryptoKey,
  householdId: string,
  keyEpoch: number,
  password: string,
  lastPlanDigest: string
) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return Promise.all([
    Promise.resolve(iv),
    crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: additionalData(householdId, keyEpoch),
        tagLength: 128
      },
      deviceKey,
      new TextEncoder().encode(JSON.stringify({
        format: "life-compass-trusted-shared-plan",
        version: 1,
        password,
        lastPlanDigest
      }))
    )
  ]);
};

const requestResult = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.addEventListener("success", () => resolve(request.result), { once: true });
  request.addEventListener("error", () => reject(request.error || new Error("端末内の安全な保存領域を利用できません。")), { once: true });
});

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  if (!("indexedDB" in window)) {
    reject(new Error("このブラウザは端末内の安全な保存領域に対応していません。"));
    return;
  }
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.addEventListener("upgradeneeded", () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      database.createObjectStore(STORE_NAME, { keyPath: "householdId" });
    }
  }, { once: true });
  request.addEventListener("success", () => resolve(request.result), { once: true });
  request.addEventListener("error", () => reject(request.error || new Error("端末内の安全な保存領域を開けません。")), { once: true });
});

const withStore = async <T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => Promise<T>
) => {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, mode);
    const completion = new Promise<void>((resolve, reject) => {
      transaction.addEventListener("complete", () => resolve(), { once: true });
      transaction.addEventListener("abort", () => reject(transaction.error || new Error("端末内の保存処理を完了できません。")), { once: true });
      transaction.addEventListener("error", () => reject(transaction.error || new Error("端末内の保存処理に失敗しました。")), { once: true });
    });
    const result = await action(transaction.objectStore(STORE_NAME));
    await completion;
    return result;
  } finally {
    database.close();
  }
};

const getRecord = (householdId: string) =>
  withStore("readonly", (store) => requestResult(store.get(householdId))) as Promise<TrustedDeviceRecord | undefined>;

export const storeTrustedSharedPlanPassword = async (
  householdId: string,
  keyEpoch: number,
  password: string,
  metadata: SharedPlanSyncMetadata
) => {
  validatePasswordLength(password, "共有パスワード");
  const deviceKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  const [iv, encryptedCredential] = await encryptCredentialPayload(
    deviceKey,
    householdId,
    keyEpoch,
    password,
    metadata.lastPlanDigest
  );
  const record: TrustedDeviceRecord = {
    householdId,
    keyEpoch,
    deviceKey,
    iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength),
    encryptedCredential,
    createdAt: new Date().toISOString(),
    lastRevision: metadata.lastRevision,
    lastSyncedAt: metadata.lastSyncedAt
  };
  await withStore("readwrite", async (store) => {
    await requestResult(store.put(record));
  });
  localStorage.setItem(TRUSTED_DEVICE_MARKER_KEY, householdId);
};

export const hasTrustedSharedPlanDevice = (householdId: string) =>
  localStorage.getItem(TRUSTED_DEVICE_MARKER_KEY) === householdId;

export const loadTrustedSharedPlanCredential = async (
  householdId: string,
  keyEpoch: number
): Promise<TrustedSharedPlanCredential | null> => {
  const record = await getRecord(householdId);
  if (!record || record.keyEpoch !== keyEpoch) return null;
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: record.iv,
        additionalData: additionalData(householdId, keyEpoch),
        tagLength: 128
      },
      record.deviceKey,
      record.encryptedCredential
    );
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as {
      format?: string;
      version?: number;
      password?: string;
      lastPlanDigest?: string;
    };
    if (
      payload.format !== "life-compass-trusted-shared-plan"
      || payload.version !== 1
      || typeof payload.password !== "string"
      || typeof payload.lastPlanDigest !== "string"
    ) {
      throw new Error("invalid trusted device payload");
    }
    validatePasswordLength(payload.password, "共有パスワード");
    return {
      householdId,
      keyEpoch,
      password: payload.password,
      lastRevision: record.lastRevision,
      lastPlanDigest: payload.lastPlanDigest,
      lastSyncedAt: record.lastSyncedAt
    };
  } catch {
    await forgetTrustedSharedPlanDevice(householdId);
    return null;
  }
};

export const updateTrustedSharedPlanMetadata = async (
  credential: TrustedSharedPlanCredential,
  metadata: SharedPlanSyncMetadata
) => {
  const record = await getRecord(credential.householdId);
  if (!record || record.keyEpoch !== credential.keyEpoch) {
    throw new Error("この端末の共有設定を確認できません。");
  }
  const [iv, encryptedCredential] = await encryptCredentialPayload(
    record.deviceKey,
    record.householdId,
    record.keyEpoch,
    credential.password,
    metadata.lastPlanDigest
  );
  await withStore("readwrite", async (store) => {
    await requestResult(store.put({
      ...record,
      iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength),
      encryptedCredential,
      lastRevision: metadata.lastRevision,
      lastSyncedAt: metadata.lastSyncedAt
    }));
  });
};

export const forgetTrustedSharedPlanDevice = async (householdId: string) => {
  await withStore("readwrite", async (store) => {
    await requestResult(store.delete(householdId));
  });
  if (localStorage.getItem(TRUSTED_DEVICE_MARKER_KEY) === householdId) {
    localStorage.removeItem(TRUSTED_DEVICE_MARKER_KEY);
  }
};
