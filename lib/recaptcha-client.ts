"use client";

// Browser side of reCAPTCHA v3: loads Google's script once and returns a fresh token per form submit.
// Without NEXT_PUBLIC_RECAPTCHA_SITE_KEY it does nothing and returns undefined.

const SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? "";

type Grecaptcha = { ready(callback: () => void): void; execute(siteKey: string, options: { action: string }): Promise<string> };
declare global {
  interface Window {
    grecaptcha?: Grecaptcha;
  }
}

let loading: Promise<Grecaptcha> | null = null;

function loadScript(): Promise<Grecaptcha> {
  if (loading) return loading;
  loading = new Promise<Grecaptcha>((resolve, reject) => {
    const done = () => window.grecaptcha!.ready(() => resolve(window.grecaptcha!));
    if (window.grecaptcha) return done();
    const script = document.createElement("script");
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(SITE_KEY)}`;
    script.async = true;
    script.onload = done;
    script.onerror = () => {
      loading = null;
      reject(new Error("reCAPTCHA could not load"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** Starts loading the script early (call from a form's useEffect) so the first submit is not slowed down. */
export function preloadRecaptcha() {
  if (SITE_KEY && typeof window !== "undefined") loadScript().catch(() => undefined);
}

/** A one-time token for `action`, or undefined when reCAPTCHA is not configured or could not load. */
export async function recaptchaToken(action: string): Promise<string | undefined> {
  if (!SITE_KEY || typeof window === "undefined") return undefined;
  try {
    const grecaptcha = await loadScript();
    return await grecaptcha.execute(SITE_KEY, { action });
  } catch {
    return undefined;
  }
}
