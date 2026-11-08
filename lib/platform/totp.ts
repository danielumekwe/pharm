// Time-based one-time passwords (RFC 6238: HMAC-SHA1, 30-second steps, 6 digits), the codes shown by
// authenticator apps, and single-use recovery codes.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { AUTH_SECRET } from "@/lib/auth-secret";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;

export function base32Encode(bytes: Buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text: string) {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of clean) {
    const index = ALPHABET.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 secret.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A new 160-bit secret, base32 (what authenticator apps take). */
export const newTotpSecret = () => base32Encode(randomBytes(20));

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

export function totpCode(secret: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(number).padStart(6, "0");
}

/**
 * Checks a 6-digit code, allowing one step of clock drift either way. Returns the matched step, or null.
 * A step at or before `lastStep` is refused, so a code that was already used cannot be replayed.
 */
export function verifyTotp(secret: string, code: string, lastStep: number | null, now = Date.now()) {
  const typed = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(typed)) return null;
  const step = currentStep(now);
  for (const candidate of [step - 1, step, step + 1]) {
    if (lastStep !== null && candidate <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(totpCode(secret, candidate)), Buffer.from(typed))) return candidate;
  }
  return null;
}

/** otpauth:// address for the QR code. */
export function otpauthUri(secret: string, account: string, issuer = "Web365 Platform") {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

// Recovery codes: 10 codes of 10 base32 characters (50 bits each), shown once, kept as keyed hashes.
const RECOVERY_KEY = `${AUTH_SECRET}:web365-recovery-codes`;
export const hashRecoveryCode = (code: string) => createHmac("sha256", RECOVERY_KEY).update(code.replace(/[\s-]/g, "").toUpperCase()).digest("hex");

export function newRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const raw = base32Encode(randomBytes(7)).slice(0, 10);
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}
