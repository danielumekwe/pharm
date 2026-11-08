// Authenticator-app codes for tests (RFC 6238, as in lib/platform/totp.ts).
import { createHmac } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decode(secret) {
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const character of secret.replace(/=+$/, "").toUpperCase()) {
    value = (value << 5) | ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** The code for the 30-second step `offset` steps from now. */
export function totp(secret, offset = 0) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const digest = createHmac("sha1", decode(secret)).update(counter).digest();
  const index = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(index) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
