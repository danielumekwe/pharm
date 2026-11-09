export const naira = (value: number | null | undefined) => `₦${Math.round(value ?? 0).toLocaleString('en-NG')}`;

/** Today's business date in West Africa Time (the server's reporting day). */
export function todayWAT(now = Date.now()) {
  return new Date(now + 60 * 60_000).toISOString().slice(0, 10);
}

export function greeting(now = new Date()) {
  const hour = (now.getUTCHours() + 1) % 24;
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}
