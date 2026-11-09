// Zoho CPaaS WhatsApp API client (server only). Only documented calls are used:
//   POST {base}/v1.1/whatsapp                 send an approved template   (help/api/send-a-whatsapp-message.html)
//   GET  {base}/v1.1/whatsapp/logs            message logs (read only)    (help/api/get-whatsapp-logs.html)
//   GET  {base}/v1.1/whatsapp/logs/{id}       one message's details       (help/api/get-whatsapp-message-details.html)
// Authorization: "Zoho-enczapikey <agent API key>". Webhooks are signed with HMAC-SHA256 (help/webhooks.html).
// The API key never appears in errors, logs or responses: every provider text passes through redact().
import { createHmac, timingSafeEqual } from "node:crypto";

export type ZohoConfig = { baseUrl: string; apiKey: string; agentId?: string };

export type SendInput = {
  from: string;
  to: string;
  templateKey?: string | null;
  templateAlias?: string | null;
  mergeInfo: Record<string, string>;
  clientReference: string;
};

/** permanent: do not retry (bad request, credentials, template refused). */
export type SendResult =
  | { ok: true; messageId: string; requestId: string | null }
  | { ok: false; permanent: boolean; code: string | null; reason: string; templateRejected: boolean; authFailed: boolean };

type ZohoError = { error?: { code?: string; message?: string; details?: Array<{ code?: string; message?: string; target?: string }>; request_id?: string } };

/** ZOHO_CPAAS_BASE_URL overrides the configured address (tests point it at a local fake). */
export function apiBase(config: Pick<ZohoConfig, "baseUrl">) {
  return (process.env.ZOHO_CPAAS_BASE_URL || config.baseUrl).replace(/\/+$/, "");
}

function authorization(apiKey: string) {
  const key = apiKey.trim();
  return key.startsWith("Zoho-enczapikey") ? key : `Zoho-enczapikey ${key}`;
}

export function redact(text: string, secrets: Array<string | undefined>) {
  let clean = text;
  for (const secret of secrets) if (secret && secret.length >= 6) clean = clean.split(secret).join("•••");
  return clean.replace(/Zoho-enczapikey\s+\S+/g, "Zoho-enczapikey •••").slice(0, 500);
}

function describeError(status: number, body: ZohoError | null) {
  const detail = body?.error?.details?.[0];
  const code = detail?.code ?? body?.error?.code ?? null;
  const text = [body?.error?.message, detail?.message, detail?.target ? `(${detail.target})` : null].filter(Boolean).join(": ");
  return { code, text: `Zoho CPaaS ${status}${code ? ` ${code}` : ""}${text ? `: ${text}` : ""}` };
}

/** Sends one template message. Network errors, 429 and 5xx are temporary; other refusals are permanent. */
export async function sendTemplate(config: ZohoConfig, input: SendInput): Promise<SendResult> {
  const body = {
    from: input.from,
    to: input.to,
    ...(input.templateKey ? { template_key: input.templateKey } : { template_alias: input.templateAlias }),
    merge_info: input.mergeInfo,
    client_reference: input.clientReference.slice(0, 100),
    ...(config.agentId ? { agent_id: config.agentId } : {}),
  };
  let response: Response;
  try {
    response = await fetch(`${apiBase(config)}/v1.1/whatsapp`, {
      method: "POST",
      headers: { Authorization: authorization(config.apiKey), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch (error) {
    return { ok: false, permanent: false, code: null, reason: redact(`Zoho CPaaS unreachable: ${error instanceof Error ? error.message : "network error"}`, [config.apiKey]), templateRejected: false, authFailed: false };
  }
  const json = (await response.json().catch(() => null)) as (ZohoError & { status?: string; data?: { message_id?: string; request_id?: string; code?: string } }) | null;
  if (response.ok && json?.data?.message_id) return { ok: true, messageId: json.data.message_id, requestId: json.data.request_id ?? null };
  if (response.ok) return { ok: false, permanent: false, code: null, reason: "Zoho CPaaS answered without a message ID; will check again.", templateRejected: false, authFailed: false };
  const { code, text } = describeError(response.status, json);
  const temporary = response.status === 429 || response.status >= 500;
  return {
    ok: false,
    permanent: !temporary,
    code,
    reason: redact(text, [config.apiKey]),
    templateRejected: code === "WA_103",
    authFailed: code === "SERR_157" || (response.status === 401 && code !== "WA_103"),
  };
}

export type LogEntry = { message_id: string; request_id?: string; client_reference?: string; agent_id?: string; waba_id?: string; from?: string; to?: string; status?: string; channel_name?: string };

/** Read-only call used to check credentials and to reconcile messages: it never sends anything. */
export async function getLogs(config: ZohoConfig, params: Record<string, string | number> = {}): Promise<{ ok: true; entries: LogEntry[] } | { ok: false; status: number; reason: string }> {
  const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));
  try {
    const response = await fetch(`${apiBase(config)}/v1.1/whatsapp/logs${query.size ? `?${query}` : ""}`, {
      headers: { Authorization: authorization(config.apiKey), Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const json = (await response.json().catch(() => null)) as (ZohoError & { data?: LogEntry[] }) | null;
    if (!response.ok) return { ok: false, status: response.status, reason: redact(describeError(response.status, json).text, [config.apiKey]) };
    return { ok: true, entries: Array.isArray(json?.data) ? json.data : [] };
  } catch (error) {
    return { ok: false, status: 0, reason: redact(`Zoho CPaaS unreachable: ${error instanceof Error ? error.message : "network error"}`, [config.apiKey]) };
  }
}

// ------------------------------------------------------------------ webhooks

/** Java URLDecoder semantics (what Zoho's sample uses): "+" is a space, then %XX decoding. */
function formDecode(value: string) {
  return decodeURIComponent(value.replace(/\+/g, " "));
}

/**
 * Verifies Zoho CPaaS's producer-signature header ("ts=<ms>;s=<base64, url-encoded>;s-algorithm=HmacSHA256").
 * The signed data is the request body's single form value, URL-decoded (Zoho's documented sample).
 * Returns the decoded payload when valid, otherwise null.
 */
export function verifyWebhook(rawBody: string, header: string | null, key: string, now = Date.now(), maxSkewMs = 5 * 60_000): string | null {
  if (!header || !key) return null;
  const parts = new Map<string, string>();
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index > 0) parts.set(part.slice(0, index).trim(), part.slice(index + 1));
  }
  const ts = parts.get("ts");
  const signature = parts.get("s");
  if (!ts || !signature || parts.get("s-algorithm") !== "HmacSHA256") return null;
  const timestamp = Number(ts);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > maxSkewMs) return null;
  // The sample reads the body line by line, so line breaks are not part of the signed text.
  const body = rawBody.replace(/\r\n|\r|\n/g, "");
  const separator = body.indexOf("=");
  if (separator < 0) return null;
  let payload: string;
  let received: Buffer;
  try {
    payload = formDecode(body.slice(separator + 1));
    received = Buffer.from(formDecode(signature), "base64");
  } catch {
    return null;
  }
  const expected = createHmac("sha256", Buffer.from(key, "utf8")).update(payload, "utf8").digest();
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  return payload;
}

/** Test helper and documentation of the format: signs a payload the way Zoho does. */
export function signWebhook(payload: string, key: string, ts = Date.now()) {
  const signature = createHmac("sha256", Buffer.from(key, "utf8")).update(payload, "utf8").digest("base64");
  return { header: `ts=${ts};s=${encodeURIComponent(signature)};s-algorithm=HmacSHA256`, body: `data=${encodeURIComponent(payload)}` };
}

export type WebhookEvent = { kind: "delivered" | "read" | "undelivered"; messageReference: string | null; clientReference: string | null; time: string | null; reason: string | null; requestId: string | null; eventKey: string };

/** Pulls the WhatsApp delivery events out of a verified payload (Zoho may batch several). */
export function parseWebhookEvents(payload: string): WebhookEvent[] {
  const json = JSON.parse(payload) as Record<string, unknown>;
  const names = ([] as unknown[]).concat(json.event_name ?? []);
  const messages = ([] as unknown[]).concat(json.event_message ?? []);
  const webhookId = typeof json.webhook_request_id === "string" ? json.webhook_request_id : null;
  const events: WebhookEvent[] = [];
  messages.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const message = entry as Record<string, unknown>;
    const info = (message.whatsapp_info ?? {}) as Record<string, unknown>;
    const data = (message.event_data ?? {}) as Record<string, unknown>;
    const detailsList = ([] as unknown[]).concat(data.details ?? []);
    const details = (detailsList[0] ?? {}) as Record<string, unknown>;
    const name = String((typeof data.object === "string" ? data.object : names[index] ?? names[0]) ?? "");
    const kind = name === "whatsapp_delivered" ? "delivered" : name === "whatsapp_read" ? "read" : name === "whatsapp_undelivered" ? "undelivered" : null;
    if (!kind) return;
    const str = (value: unknown) => (typeof value === "string" && value ? value : null);
    const messageReference = str(info.message_reference);
    const clientReference = str(info.client_reference);
    events.push({
      kind,
      messageReference,
      clientReference,
      time: str(details.time),
      reason: [str(details.reason), str(details.error_code)].filter(Boolean).join(" · ") || null,
      requestId: str(message.request_id),
      eventKey: `${webhookId ?? "nowebhookid"}:${messageReference ?? clientReference ?? index}:${kind}`,
    });
  });
  return events;
}
