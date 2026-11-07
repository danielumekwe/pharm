// Payment providers behind one interface, so others (Flutterwave, Stripe, …) can be added beside Paystack.
// Rule for every provider: a payment counts only after the server has verified it with the provider's API.

export type VerifiedPayment = {
  /** success: money received. failed/abandoned: no money. pending: not finished yet. */
  status: "success" | "failed" | "abandoned" | "pending";
  reference: string;
  /** In the currency's smallest unit (kobo for NGN). */
  amountMinor: number;
  currency: string;
  transactionId: string | null;
  channel: string | null;
  paidAt: string | null;
  failureReason: string | null;
  customerCode: string | null;
  /** A saved card that may be charged again for renewals (when the provider marks it reusable). */
  authorization: { code: string; label: string } | null;
};

export type CheckoutRequest = {
  email: string;
  amountMinor: number;
  currency: string;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, string>;
};

export type WebhookEvent = { type: string; key: string; reference: string | null; payload: unknown };

export interface PaymentProvider {
  readonly name: string;
  /** False when the provider's keys are not set: online payment is then unavailable. */
  configured(): boolean;
  initialize(request: CheckoutRequest): Promise<{ checkoutUrl: string }>;
  verify(reference: string): Promise<VerifiedPayment>;
  /** Checks the webhook signature over the exact raw body. */
  verifyWebhook(rawBody: string, headers: Headers): boolean;
  parseWebhook(rawBody: string): WebhookEvent;
}

export class PaymentProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentProviderError";
  }
}

/** Amounts are kept with 4 decimals; providers charge whole minor units (kobo, pesewas, cents). */
export function toMinorUnits(amount: number) {
  return Math.round(amount * 100);
}
