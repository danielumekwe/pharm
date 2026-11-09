// Dashboard data for the selected period, in one shape whatever the role.
// Super Admins get the full analytics from /api/dashboard (same as the web dashboard); other roles get what
// their permissions allow from /api/sales-overview and /api/alerts. The server enforces every permission.
import { useAuth } from '@/lib/auth';
import { todayWAT } from '@/lib/format';
import { useData } from '@/lib/use-data';

export type Period = 'today' | '7d' | '30d' | 'month';
export const PERIODS: [Period, string][] = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['month', 'This month']];

export function periodRange(period: Period, now = Date.now()) {
  const to = todayWAT(now);
  const back = (days: number) => todayWAT(now - days * 86_400_000);
  const from = period === 'today' ? to : period === '7d' ? back(6) : period === '30d' ? back(29) : `${to.slice(0, 8)}01`;
  return { from, to };
}

type Totals = { net: number; transactions: number; avgBasket: number; returns: number; discounts: number; payments: { netCash: number; netPos: number; netTransfer: number; onAccount: number } };
type BatchRow = { id: string; product: string; batchNumber: string; outlet: string; expiryDate: string; days: number; quantity: number; value: number };
type AdminData = {
  totals: Totals;
  trend: { label: string; value: number; period?: string }[];
  byOutlet: { name: string; value: number; transactions: number }[];
  byCashier: { name: string; value: number; transactions: number; note?: string }[];
  topProducts: { name: string; units: number; revenue: number }[];
  paymentMix: { name: string; value: number }[];
  position: { valueAtCost: number; valueAtRetail: number; lowCount: number; low: { id: string; name: string; outlet: string; stock: number; minStock: number; unit?: string }[]; expiringCount: number; expiring: BatchRow[]; expiredCount: number; expiredValue: number; nearExpiryDays: number };
  transfers: { count: number; rows: { id: string; reference: string; from: string; to: string; status: string; items: number }[] };
  staff: { name: string; role: string; actions: number }[];
};
type Overview = { totals: Totals; trend: { label: string; net: number; period: string }[]; byOutlet: { name: string; net: number; transactions: number }[]; byCashier: { cashier: string; net: number; transactions: number; outlets: string }[] };
type AlertsFeed = { summary: { lowStock: number; outOfStock: number; expiredBatches: number; expiredValue: number; nearExpiryProducts: number; showExpiry: boolean; unacknowledged: number; recent: { id: string; type: 'LOW_STOCK' | 'EXPIRED' | 'NEAR_EXPIRY'; severity: string; productName: string; outletId: string; updatedAt: string; snapshot: { available: number } }[] } };

/** One bar per day of the period (₦0 on days without sales); the server sends the last 30 days. */
function dailySeries(from: string, to: string, points: { value: number; period?: string }[]) {
  const byDay = new Map(points.filter((point) => point.period).map((point) => [point.period as string, point.value]));
  const days: { label: string; value: number }[] = [];
  for (let day = Date.parse(`${from}T12:00:00Z`); day <= Date.parse(`${to}T12:00:00Z`); day += 86_400_000) {
    const key = new Date(day).toISOString().slice(0, 10);
    days.push({ label: new Date(day).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }), value: byDay.get(key) ?? 0 });
  }
  return days;
}

export function useDashboard(period: Period) {
  const { session, can } = useAuth();
  const { from, to } = periodRange(period);
  const full = session?.user.role === 'SUPER_ADMIN';
  const seesSales = can('reports.sales') || can('sales.view');
  const admin = useData<{ kind: string; data: AdminData }>(full ? `/api/dashboard?from=${from}&to=${to}&trend=daily` : null);
  const overview = useData<Overview>(!full && seesSales ? `/api/sales-overview?from=${from}&to=${to}&trend=daily` : null);
  const alerts = useData<AlertsFeed>(can('alerts.view') ? '/api/alerts' : null);

  const data = admin.data?.kind === 'admin' ? admin.data.data : null;
  const totals = data?.totals ?? overview.data?.totals ?? null;
  return {
    from,
    to,
    full,
    loading: admin.loading || overview.loading || alerts.loading,
    refreshing: admin.refreshing || overview.refreshing || alerts.refreshing,
    error: admin.error ?? overview.error ?? alerts.error,
    refresh: () => Promise.all([admin.refresh(), overview.refresh(), alerts.refresh()]),
    totals,
    trend: dailySeries(from, to, data?.trend ?? overview.data?.trend.map((row) => ({ label: row.label, value: row.net, period: row.period })) ?? []),
    byOutlet: (data?.byOutlet ?? overview.data?.byOutlet.map((row) => ({ name: row.name, value: row.net, transactions: row.transactions })) ?? []).map((row) => ({ name: row.name, value: row.value, note: `${row.transactions} sale(s)` })),
    byCashier: (data?.byCashier ?? overview.data?.byCashier.map((row) => ({ name: row.cashier, value: row.net, transactions: row.transactions, note: row.outlets })) ?? []).map((row) => ({ name: row.name, value: row.value, note: `${row.transactions} sale(s)${row.note ? ` · ${row.note}` : ''}` })),
    topProducts: data?.topProducts.map((row) => ({ name: row.name, value: row.revenue, note: `${row.units} sold` })) ?? null,
    paymentMix: data?.paymentMix ?? (totals ? [
      { name: 'Cash', value: totals.payments.netCash },
      { name: 'POS terminal', value: totals.payments.netPos },
      { name: 'Transfer', value: totals.payments.netTransfer },
      { name: 'On account', value: totals.payments.onAccount },
    ].filter((row) => row.value > 0) : []),
    stock: data?.position ?? null,
    transfers: data?.transfers ?? null,
    staff: data?.staff ?? null,
    alerts: alerts.data?.summary ?? null,
  };
}
