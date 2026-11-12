// Device credentials and the offline PIN, with WebCrypto only (browser and Node 22+).
// - Device key: ECDSA P-256, private key NON-extractable. It is stored as a CryptoKey object in IndexedDB,
//   where scripts can use it to sign but can never read it out.
// - PIN: never stored. A PBKDF2-SHA256 verifier (salt + 310,000 iterations) is kept instead.

const subtle = () => globalThis.crypto.subtle;
const toBase64 = (bytes: ArrayBuffer | Uint8Array) => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = "";
  for (const byte of view) text += String.fromCharCode(byte);
  return btoa(text);
};
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

export async function createDeviceKey() {
  const pair = (await subtle().generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"])) as CryptoKeyPair;
  const spki = await subtle().exportKey("spki", pair.publicKey);
  return { privateKey: pair.privateKey, publicKey: toBase64(spki) };
}

/** Same text the server verifies (lib/erp/offline-devices.ts signedText). */
export async function deviceHeaders(privateKey: CryptoKey, deviceId: string, method: string, path: string) {
  const time = new Date().toISOString();
  const signature = await subtle().sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(`${deviceId}.${time}.${method.toUpperCase()}.${path}`));
  return { "X-Device-Id": deviceId, "X-Device-Time": time, "X-Device-Signature": toBase64(signature) };
}

export const PIN_PATTERN = /^\d{6,8}$/;
const PIN_ITERATIONS = 310_000;

export type PinVerifier = { salt: string; hash: string; iterations: number };

async function derive(pin: string, salt: Uint8Array, iterations: number) {
  const material = await subtle().importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  return toBase64(await subtle().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, material, 256));
}

export async function createPinVerifier(pin: string): Promise<PinVerifier> {
  if (!PIN_PATTERN.test(pin)) throw new Error("Use a PIN of 6 to 8 digits.");
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return { salt: toBase64(salt), hash: await derive(pin, salt, PIN_ITERATIONS), iterations: PIN_ITERATIONS };
}

export async function checkPin(pin: string, verifier: PinVerifier) {
  if (!PIN_PATTERN.test(pin)) return false;
  const candidate = await derive(pin, fromBase64(verifier.salt), verifier.iterations);
  // Constant-time comparison.
  let difference = candidate.length ^ verifier.hash.length;
  for (let index = 0; index < Math.min(candidate.length, verifier.hash.length); index += 1) difference |= candidate.charCodeAt(index) ^ verifier.hash.charCodeAt(index);
  return difference === 0;
}
