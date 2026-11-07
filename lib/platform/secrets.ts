// Encryption for stored secrets (API keys, SMTP passwords). AES-256-GCM with a key derived from
// SETTINGS_ENCRYPTION_KEY, which lives only in the server environment (never in the database or the
// browser). Without that key, secrets cannot be saved or read; the rest of the app keeps working.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

export class SecretsUnavailableError extends Error {
  status = 503;
  constructor() {
    super("Secret storage is not set up: SETTINGS_ENCRYPTION_KEY (at least 32 characters) must be set on the server.");
    this.name = "SecretsUnavailableError";
  }
}

function key() {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY ?? "";
  if (raw.length < 32) throw new SecretsUnavailableError();
  return createHash("sha256").update(raw).digest(); // 32 bytes
}

export function secretsAvailable() {
  return (process.env.SETTINGS_ENCRYPTION_KEY ?? "").length >= 32;
}

export function encryptSecrets(values: Record<string, string>) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(values), "utf8"), cipher.final()]);
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
}

export function decryptSecrets(ciphertext: string | null): Record<string, string> {
  if (!ciphertext) return {};
  const [version, payload] = ciphertext.split(":");
  if (version !== VERSION || !payload) throw new Error("Unknown secret format.");
  const data = Buffer.from(payload, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8"));
}

/** What a screen may show about a secret: whether it is set, and its last four characters. */
export function maskSecret(value: string | undefined) {
  if (!value) return { set: false, hint: null as string | null };
  return { set: true, hint: `•••• ${value.slice(-4)}` };
}
