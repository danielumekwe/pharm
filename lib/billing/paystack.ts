// Paystack (https://paystack.com/docs/api). Configure PAYSTACK_SECRET_KEY (sk_test_… or sk_live_…).
// PAYSTACK_BASE_URL overrides the API address (tests use a local stand-in).
import { createHmac, timingSafeEqual } from "node:crypto";

import { PaymentProviderError, type CheckoutRequest, type PaymentProvider, type VerifiedPayment, type WebhookEvent } from "@/lib/billing/provider";

const baseUrl = () => (process.env.PAYSTACK_BASE_URL || "https://api.paystack.co").replace(/\/$/, "");
const secret = () => process.env.PAYSTACK_SECRET_KEY ?? "";

type Envelope<T> = { status: boolean; message?: string; data?: T };

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${secret()}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new PaymentProviderError(`Paystack could not be reached (${error instanceof Error ? error.message : "network error"}).`);
  }
  const body = (await response.json().catch(() => null)) as Envelope<T> | null;
  if (!response.ok || !body?.status || !body.data) throw new PaymentProviderError(`Paystack: ${body?.message ?? `HTTP ${response.status}`}`);
  return body.data;
}

type PaystackTransaction = {
  id: number;
  status: string;
  reference: string;
  amount: number;
  currency: string;
  channel?: string | null;
  paid_at?: string | null;
  gateway_response?: string | null;
  customer?: { customer_code?: string | null } | null;
  authorization?: { authorization_code?: string; card_type?: string; last4?: string; exp_month?: string; exp_year?: string; bank?: string; reusable?: boolean } | null;
};

function normaliseStatus(status: string): VerifiedPayment["status"] {
  if (status === "success") return "success";
  if (status === "failed" || status === "reversed") return "failed";
  if (status === "abandoned") return "abandoned";
  return "pending"; // ongoing, pending, processing, queued
}

export const paystack: PaymentProvider = {
  name: "paystack",
  configured: () => /^sk_(test|live)_/.test(secret()),

  async initialize(request: CheckoutRequest) {
    const data = await call<{ authorization_url: string; reference: string }>("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        email: request.email,
        amount: request.amountMinor,
        currency: request.currency,
        reference: request.reference,
        callback_url: request.callbackUrl,
        metadata: request.metadata,
      }),
    });
    if (data.reference !== request.reference) throw new PaymentProviderError("Paystack returned a different reference.");
    return { checkoutUrl: data.authorization_url };
  },

  async verify(reference: string): Promise<VerifiedPayment> {
    const data = await call<PaystackTransaction>(`/transaction/verify/${encodeURIComponent(reference)}`);
    const card = data.authorization;
    return {
      status: normaliseStatus(data.status),
      reference: data.reference,
      amountMinor: Number(data.amount),
      currency: data.currency,
      transactionId: data.id ? String(data.id) : null,
      channel: data.channel ?? null,
      paidAt: data.paid_at ?? null,
      failureReason: data.status === "success" ? null : data.gateway_response ?? data.status,
      customerCode: data.customer?.customer_code ?? null,
      authorization: card?.authorization_code && card.reusable
        ? { code: card.authorization_code, label: [card.card_type?.trim(), card.last4 ? `•••• ${card.last4}` : null, card.exp_month && card.exp_year ? `exp ${card.exp_month}/${card.exp_year}` : null].filter(Boolean).join(" ") }
        : null,
    };
  },

  verifyWebhook(rawBody: string, headers: Headers) {
    const signature = headers.get("x-paystack-signature") ?? "";
    if (!secret() || !/^[a-f0-9]{128}$/.test(signature)) return false;
    const expected = createHmac("sha512", secret()).update(rawBody).digest("hex");
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  },

  parseWebhook(rawBody: string): WebhookEvent {
    const payload = JSON.parse(rawBody) as { event?: string; data?: { id?: number | string; reference?: string } };
    const type = String(payload.event ?? "unknown");
    const reference = payload.data?.reference ?? null;
    return { type, key: `${type}:${payload.data?.id ?? reference ?? "none"}`, reference, payload };
  },
};

/** The provider used for subscription payments (BILLING_PROVIDER, default paystack). */
export function billingProvider(): PaymentProvider {
  return paystack;
}
