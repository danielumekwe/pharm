// WhatsApp notification types and the template variables each one can fill.
// A Zoho template's merge keys must all come from its type's list (checked when the template is saved, and
// again before every send), so a message is never sent with an empty placeholder.

export const NOTIFICATION_TYPES = {
  daily_report: {
    label: "Daily pharmacy report",
    audience: "pharmacy",
    variables: ["pharmacy", "date", "total_sales", "transactions", "outlet_count", "top_product", "low_stock_count", "expiry_count", "expenses", "gross_profit", "report_link", "unsubscribe_link", "recipient_name"],
  },
  outlet_sales: {
    label: "Daily outlet sales summary",
    audience: "pharmacy",
    variables: ["pharmacy", "outlet", "date", "total_sales", "transactions", "cash", "pos", "transfer", "report_link", "unsubscribe_link", "recipient_name"],
  },
  low_stock: {
    label: "Low-stock alerts",
    audience: "pharmacy",
    variables: ["pharmacy", "outlet", "product", "available", "minimum", "link", "unsubscribe_link", "recipient_name"],
  },
  out_of_stock: {
    label: "Out-of-stock alerts",
    audience: "pharmacy",
    variables: ["pharmacy", "outlet", "product", "minimum", "link", "unsubscribe_link", "recipient_name"],
  },
  expiry: {
    label: "Expiry alerts",
    audience: "pharmacy",
    variables: ["pharmacy", "outlet", "product", "batch", "expiry_date", "quantity", "link", "unsubscribe_link", "recipient_name"],
  },
  payment_confirmation: {
    label: "Subscription payment confirmation",
    audience: "billing",
    variables: ["pharmacy", "plan", "amount", "period_end", "link", "unsubscribe_link", "recipient_name"],
  },
  payment_failure: {
    label: "Failed payment notification",
    audience: "billing",
    variables: ["pharmacy", "amount", "reason", "link", "unsubscribe_link", "recipient_name"],
  },
  renewal_reminder: {
    label: "Subscription renewal reminder",
    audience: "billing",
    variables: ["pharmacy", "plan", "renewal_date", "days_left", "link", "unsubscribe_link", "recipient_name"],
  },
  account_suspended: {
    label: "Account suspension",
    audience: "account",
    variables: ["pharmacy", "reason", "support_contact", "unsubscribe_link", "recipient_name"],
  },
  account_reactivated: {
    label: "Account reactivation",
    audience: "account",
    variables: ["pharmacy", "link", "unsubscribe_link", "recipient_name"],
  },
  announcement: {
    label: "Important platform announcements",
    audience: "account",
    variables: ["pharmacy", "title", "message", "link", "unsubscribe_link", "recipient_name"],
  },
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;
export const TYPE_KEYS = Object.keys(NOTIFICATION_TYPES) as NotificationType[];
export const isNotificationType = (value: unknown): value is NotificationType => typeof value === "string" && value in NOTIFICATION_TYPES;

/** Every type is on unless switched off (platform-wide or by the pharmacy). */
export const allTypesOn = () => Object.fromEntries(TYPE_KEYS.map((key) => [key, true])) as Record<NotificationType, boolean>;

/** Variables the test-message tool fills in (clearly test values, never real pharmacy data). */
export function sampleValues(type: NotificationType): Record<string, string> {
  const base: Record<string, string> = {
    pharmacy: "Test Pharmacy", recipient_name: "Test recipient", date: new Date().toISOString().slice(0, 10), outlet: "Main outlet", outlet_count: "1",
    total_sales: "NGN 0", transactions: "0", cash: "NGN 0", pos: "NGN 0", transfer: "NGN 0", top_product: "Test product", low_stock_count: "0",
    expiry_count: "0", expenses: "NGN 0", gross_profit: "NGN 0", product: "Test product", available: "0", minimum: "0", batch: "TEST-1",
    expiry_date: new Date().toISOString().slice(0, 10), quantity: "0", plan: "Test plan", amount: "NGN 0", period_end: new Date().toISOString().slice(0, 10),
    renewal_date: new Date().toISOString().slice(0, 10), days_left: "0", reason: "This is a test message", support_contact: "support",
    title: "Test message", message: "This is a test message from the Web365 Control Centre.",
  };
  const link = process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "https://example.invalid";
  return Object.fromEntries(NOTIFICATION_TYPES[type].variables.map((name) => [name, name.endsWith("link") ? link : base[name] ?? "test"]));
}
