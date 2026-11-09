// Google reCAPTCHA v3 check for the public forms (sign-in, registration, password reset, Control Centre sign-in).
// On only when RECAPTCHA_SECRET_KEY is set; RECAPTCHA=off turns it off (the test server does this).

// RECAPTCHA_VERIFY_URL lets tests point this at a fake Google.
const VERIFY_URL = process.env.RECAPTCHA_VERIFY_URL || "https://www.google.com/recaptcha/api/siteverify";

export class CaptchaError extends Error {
  status = 400;
  constructor(message = "We could not confirm you are not a robot. Refresh the page and try again.") {
    super(message);
    this.name = "CaptchaError";
  }
}

/** instanceof can miss when Next bundles this module twice, so the name is checked too. */
export function isCaptchaError(error: unknown): error is CaptchaError {
  return error instanceof CaptchaError || (error instanceof Error && error.name === "CaptchaError");
}

export function recaptchaEnabled() {
  return Boolean(process.env.RECAPTCHA_SECRET_KEY) && process.env.RECAPTCHA !== "off";
}

function minimumScore() {
  const value = Number(process.env.RECAPTCHA_MIN_SCORE ?? "0.5");
  return Number.isFinite(value) ? value : 0.5;
}

/**
 * Throws CaptchaError unless `token` is a valid reCAPTCHA token for `action` with a good enough score.
 * If Google itself cannot be reached, the request is let through (and logged) so a Google outage does not
 * lock every pharmacy out; the sign-in rate limits still apply.
 */
export async function verifyRecaptcha(token: unknown, action: string, remoteIp?: string) {
  if (!recaptchaEnabled()) return;
  if (typeof token !== "string" || !token || token.length > 4000) throw new CaptchaError();

  const form = new URLSearchParams({ secret: process.env.RECAPTCHA_SECRET_KEY!, response: token });
  if (remoteIp && remoteIp !== "unknown") form.set("remoteip", remoteIp);

  let result: { success?: boolean; score?: number; action?: string; "error-codes"?: string[] };
  try {
    const response = await fetch(VERIFY_URL, { method: "POST", body: form, signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!response.ok) throw new Error(`siteverify answered ${response.status}`);
    result = await response.json();
  } catch (error) {
    console.error("[recaptcha] verification unavailable, letting the request through:", error);
    return;
  }

  if (!result.success) {
    console.warn("[recaptcha] rejected:", result["error-codes"]?.join(", ") ?? "unknown");
    throw new CaptchaError();
  }
  if (result.action && result.action !== action) throw new CaptchaError();
  if (typeof result.score === "number" && result.score < minimumScore()) {
    console.warn(`[recaptcha] low score ${result.score} for ${action}`);
    throw new CaptchaError("Your request looked automated. Wait a moment and try again.");
  }
}
