export function money(input: number) {
  const value = Object.is(input, -0) || Math.abs(input) < 0.005 ? 0 : input;
  return `₦${Math.round(value).toLocaleString("en-NG")}`;
}

export function compactMoney(value: number) {
  if (Math.abs(value) >= 1_000_000) return `₦${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`;
  if (Math.abs(value) >= 1_000) return `₦${(value / 1_000).toFixed(1)}k`;
  return money(value);
}

export function shortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function dateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** ISO timestamp `days` from now (negative = past). */
export function isoDaysFromNow(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString();
}

/** Whole minutes from now until an ISO timestamp (never negative). */
export function minutesUntil(iso: string) {
  return Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 60_000));
}
