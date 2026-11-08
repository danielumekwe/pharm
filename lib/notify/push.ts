// Android push notifications via Firebase Cloud Messaging (HTTP v1 API).
// Configure FCM_PROJECT_ID, FCM_CLIENT_EMAIL and FCM_PRIVATE_KEY (service-account key; "\n" escapes allowed).

import { createSign } from "node:crypto";

import type { DeliveryResult } from "@/lib/notify/email";

export function pushConfigured() {
  return Boolean(process.env.FCM_PROJECT_ID && process.env.FCM_CLIENT_EMAIL && process.env.FCM_PRIVATE_KEY);
}

let cachedToken: { value: string; expiresAt: number } | null = null;

function base64url(input: string | Buffer) {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** OAuth access token from a signed service-account JWT (RS256). */
async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: process.env.FCM_CLIENT_EMAIL,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = base64url(signer.sign(process.env.FCM_PRIVATE_KEY!.replace(/\\n/g, "\n")));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${signature}` }),
  });
  if (!response.ok) throw new Error(`OAuth token request failed (${response.status})`);
  const payload = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: payload.access_token, expiresAt: Date.now() + payload.expires_in * 1000 };
  return cachedToken.value;
}

export async function sendPush(deviceToken: string, message: { title: string; body: string; data?: Record<string, string> }): Promise<DeliveryResult> {
  if (!pushConfigured()) return { status: "SKIPPED", detail: "Push not configured (set FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY)" };
  const { readPlatformSetting } = await import("@/lib/platform/settings");
  const switches = await readPlatformSetting("notifications.global").catch(() => null);
  if (switches && !switches.value.pushNotifications) return { status: "SKIPPED", detail: "Push notifications are switched off by Web365." };
  try {
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${process.env.FCM_PROJECT_ID}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token: deviceToken,
          notification: { title: message.title, body: message.body },
          data: message.data ?? {},
          android: { priority: "high", notification: { channel_id: "inventory_alerts" } },
        },
      }),
    });
    if (!response.ok) return { status: "FAILED", detail: `FCM ${response.status}: ${(await response.text()).slice(0, 200)}` };
    const payload = (await response.json()) as { name: string };
    return { status: "SENT", detail: payload.name };
  } catch (error) {
    return { status: "FAILED", detail: error instanceof Error ? error.message : "FCM error" };
  }
}
