import { getDb } from "@/lib/db/database";
import { outlets } from "@/lib/data";
import { DomainError, outletName, saleTenders } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import type { SaleInvoice, SaleReturn } from "@/lib/erp/types";
import type { Actor } from "@/lib/erp/types";
import { can, isOutletScoped } from "@/lib/rbac";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;
export type TrendGranularity = "daily" | "weekly" | "monthly" | "yearly";
type Scope = { mode: "consolidated" | "outlet" | "own"; outletIds: string[]; cashierId?: string; cashierName?: string; label: string };
type SalesRow = { transactions: number; gross: number; discounts: number; vat: number; invoiced: number; cash: number; transfer: number; pos: number; onAccount: number };
type ReturnRow = { returns: number; returnsNet: number; returnsVat: number; returnsTotal: number; refunded: number; credited: number; refundCash: number; refundTransfer: number; refundPos: number };
type VoidRow = { voided: number; voidedValue: number };

const EMPTY_SALES: SalesRow = { transactions: 0, gross: 0, discounts: 0, vat: 0, invoiced: 0, cash: 0, transfer: 0, pos: 0, onAccount: 0 };
const EMPTY_RETURNS: ReturnRow = { returns: 0, returnsNet: 0, returnsVat: 0, returnsTotal: 0, refunded: 0, credited: 0, refundCash: 0, refundTransfer: 0, refundPos: 0 };
const EMPTY_VOIDS: VoidRow = { voided: 0, voidedValue: 0 };
const round2 = (value: number) => Math.round(value * 100) / 100;
const amount = (value: number | undefined) => Number(value ?? 0);

/** Business dates use West Africa Time (UTC+1, no daylight saving). */
export function localToday(now = Date.now()) {
  return new Date(now + 60 * 60_000).toISOString().slice(0, 10);
}

function localDate(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp + 60 * 60_000).toISOString().slice(0, 10) : value.slice(0, 10);
}

function inRange(date: string, from: string, to: string) {
  const day = localDate(date);
  return day >= from && day <= to;
}

/** Which outlets (and cashier, for staff) the actor may see. Requests outside that scope are refused, not silently narrowed. */
export function salesScope(actor: Actor, requestedOutlet: string | null | undefined): Scope {
  const retail = outlets.filter((outlet) => outlet.type !== "WAREHOUSE").map((outlet) => outlet.id);
  const consolidated = can(actor, "reports.consolidated") && can(actor, "reports.sales") && !isOutletScoped(actor.role);
  if (consolidated) {
    if (requestedOutlet && requestedOutlet !== "all") {
      if (!retail.includes(requestedOutlet)) throw new DomainError("Unknown outlet.", 404);
      return { mode: "outlet", outletIds: [requestedOutlet], label: outletName(requestedOutlet) };
    }
    return { mode: "consolidated", outletIds: retail, label: "All outlets" };
  }
  const mine = actor.outletIds.filter((id) => retail.includes(id));
  if (can(actor, "reports.sales")) {
    const outlet = requestedOutlet && requestedOutlet !== "all" ? requestedOutlet : (actor.outletId ?? mine[0]);
    if (!outlet || !mine.includes(outlet)) throw new DomainError("You can only view sales for your assigned outlet(s).", 403);
    return { mode: "outlet", outletIds: [outlet], label: outletName(outlet) };
  }
  if (can(actor, "sales.view")) {
    if (requestedOutlet && requestedOutlet !== "all" && !mine.includes(requestedOutlet)) throw new DomainError("You can only view your own sales at your assigned outlet(s).", 403);
    const ids = requestedOutlet && requestedOutlet !== "all" ? [requestedOutlet] : mine;
    return { mode: "own", outletIds: ids, cashierId: actor.id, cashierName: actor.name, label: `My sales · ${ids.map(outletName).join(", ")}` };
  }
  throw new DomainError("Your role cannot view sales reports.", 403);
}

function belongsToScope(row: { outletId: string; cashierId?: string; cashier?: string }, scope: Scope) {
  return scope.outletIds.includes(row.outletId) &&
    (scope.mode !== "own" || row.cashierId === scope.cashierId || (!row.cashierId && row.cashier === scope.cashierName));
}

function aggregateSales(rows: SaleInvoice[]): SalesRow {
  return rows.reduce<SalesRow>((total, sale) => {
    total.transactions += 1;
    total.gross += amount(sale.subtotal);
    total.discounts += amount(sale.discount);
    total.vat += amount(sale.vat);
    total.invoiced += amount(sale.total);
    for (const tender of saleTenders(sale)) {
      if (tender.method === "Cash") total.cash += amount(tender.amount);
      else if (tender.method === "Transfer") total.transfer += amount(tender.amount);
      else if (tender.method === "Card") total.pos += amount(tender.amount);
      else total.onAccount += amount(tender.amount);
    }
    return total;
  }, { ...EMPTY_SALES });
}

function aggregateReturns(rows: SaleReturn[]): ReturnRow {
  return rows.reduce<ReturnRow>((total, row) => {
    total.returns += 1;
    total.returnsNet += amount(row.net);
    total.returnsVat += amount(row.vat);
    total.returnsTotal += amount(row.total);
    total.refunded += amount(row.refundedAmount);
    total.credited += amount(row.creditedAmount);
    if (row.refundMethod === "Cash") total.refundCash += amount(row.refundedAmount);
    else if (row.refundMethod === "Transfer") total.refundTransfer += amount(row.refundedAmount);
    else if (row.refundMethod === "Card") total.refundPos += amount(row.refundedAmount);
    return total;
  }, { ...EMPTY_RETURNS });
}

function aggregateVoids(rows: SaleInvoice[]): VoidRow {
  return rows.reduce<VoidRow>((total, row) => {
    total.voided += 1;
    total.voidedValue += amount(row.total);
    return total;
  }, { ...EMPTY_VOIDS });
}

function combine(sales: SalesRow, returns: ReturnRow, voided: VoidRow) {
  return {
    transactions: sales.transactions,
    gross: round2(sales.gross),
    discounts: round2(sales.discounts),
    returns: round2(returns.returnsNet),
    returnsCount: returns.returns,
    returnsInclVat: round2(returns.returnsTotal),
    refunded: round2(returns.refunded),
    creditedToAccounts: round2(returns.credited),
    net: round2(sales.gross - sales.discounts - returns.returnsNet),
    vat: round2(sales.vat - returns.returnsVat),
    invoiced: round2(sales.invoiced),
    avgBasket: sales.transactions ? round2(sales.invoiced / sales.transactions) : 0,
    payments: {
      cash: round2(sales.cash),
      transfer: round2(sales.transfer),
      pos: round2(sales.pos),
      onAccount: round2(sales.onAccount),
      refundCash: round2(returns.refundCash),
      refundTransfer: round2(returns.refundTransfer),
      refundPos: round2(returns.refundPos),
      netCash: round2(sales.cash - returns.refundCash),
      netTransfer: round2(sales.transfer - returns.refundTransfer),
      netPos: round2(sales.pos - returns.refundPos),
    },
    voided: voided.voided,
    voidedValue: round2(voided.voidedValue),
  };
}

export type SalesFigures = ReturnType<typeof combine>;

function bucketStart(granularity: TrendGranularity, to: string) {
  const end = new Date(`${to}T00:00:00Z`);
  if (granularity === "daily") return new Date(end.getTime() - 29 * DAY).toISOString().slice(0, 10);
  if (granularity === "weekly") return new Date(end.getTime() - 7 * 12 * DAY).toISOString().slice(0, 10);
  if (granularity === "monthly") return new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1)).toISOString().slice(0, 10);
  return new Date(Date.UTC(end.getUTCFullYear() - 4, 0, 1)).toISOString().slice(0, 10);
}

function periodFor(date: string, granularity: TrendGranularity) {
  if (granularity === "daily") return date;
  const year = Number(date.slice(0, 4));
  if (granularity === "yearly") return String(year);
  if (granularity === "monthly") return date.slice(0, 7);
  const day = new Date(`${date}T00:00:00Z`);
  const start = new Date(Date.UTC(year, 0, 1));
  const firstMonday = (8 - start.getUTCDay()) % 7;
  const dayOfYear = Math.floor((day.getTime() - start.getTime()) / DAY);
  const week = dayOfYear < firstMonday ? 0 : Math.floor((dayOfYear - firstMonday) / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function periodLabel(period: string, granularity: TrendGranularity) {
  if (granularity === "daily") return new Date(`${period}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  if (granularity === "monthly") return new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  return period;
}

export function buildSalesOverview(actor: Actor, options: { from?: string; to?: string; outlet?: string | null; trend?: TrendGranularity }) {
  if (!getDb()) throw new DomainError("Database not available.", 503);
  const store = getStore();
  const today = localToday();
  const to = options.to && DATE.test(options.to) ? options.to : today;
  const from = options.from && DATE.test(options.from) ? options.from : to;
  if (from > to) throw new DomainError("The start date must be on or before the end date.");
  if ((Date.parse(to) - Date.parse(from)) / DAY > 3660) throw new DomainError("Choose a range of 10 years or less.");
  const scope = salesScope(actor, options.outlet);

  const scopedSales = store.sales.filter((row) => belongsToScope(row, scope) && inRange(row.date, from, to));
  const scopedReturns = store.saleReturns.filter((row) => belongsToScope(row, scope) && inRange(row.date, from, to));
  const completedSales = scopedSales.filter((row) => row.status !== "Voided");
  const voidedSales = scopedSales.filter((row) => row.status === "Voided");
  const totals = combine(aggregateSales(completedSales), aggregateReturns(scopedReturns), aggregateVoids(voidedSales));

  const byOutlet = scope.outletIds.map((id) => {
    const sales = completedSales.filter((row) => row.outletId === id);
    const returns = scopedReturns.filter((row) => row.outletId === id);
    const voids = voidedSales.filter((row) => row.outletId === id);
    return { id, name: outletName(id), ...combine(aggregateSales(sales), aggregateReturns(returns), aggregateVoids(voids)) };
  });

  const saleKey = (row: { cashierId?: string; cashier: string }) => row.cashierId ?? `name:${row.cashier}`;
  const salesByCashier = new Map<string, SaleInvoice[]>();
  const returnsByCashier = new Map<string, SaleReturn[]>();
  const voidsByCashier = new Map<string, SaleInvoice[]>();
  for (const sale of completedSales) {
    const key = saleKey(sale);
    salesByCashier.set(key, [...(salesByCashier.get(key) ?? []), sale]);
  }
  for (const row of scopedReturns) {
    const key = saleKey(row);
    returnsByCashier.set(key, [...(returnsByCashier.get(key) ?? []), row]);
  }
  for (const sale of voidedSales) {
    const key = saleKey(sale);
    voidsByCashier.set(key, [...(voidsByCashier.get(key) ?? []), sale]);
  }
  const byCashier = [...salesByCashier].map(([key, sales]) => {
    const cashier = sales[0]?.cashier ?? "";
    const cashierOutlets = [...new Set(sales.map((row) => row.outletId))];
    return {
      key,
      cashier,
      outlets: cashierOutlets.map(outletName).join(", "),
      ...combine(aggregateSales(sales), aggregateReturns(returnsByCashier.get(key) ?? []), aggregateVoids(voidsByCashier.get(key) ?? [])),
    };
  }).sort((a, b) => b.net - a.net);

  const granularity = options.trend ?? "daily";
  const start = bucketStart(granularity, to);
  const returnTrend = new Map<string, number>();
  for (const row of store.saleReturns.filter((item) => belongsToScope(item, scope) && inRange(item.date, start, to))) {
    const period = periodFor(localDate(row.date), granularity);
    returnTrend.set(period, (returnTrend.get(period) ?? 0) + amount(row.net));
  }
  const salesTrend = new Map<string, SaleInvoice[]>();
  for (const row of store.sales.filter((item) => item.status !== "Voided" && belongsToScope(item, scope) && inRange(item.date, start, to))) {
    const period = periodFor(localDate(row.date), granularity);
    salesTrend.set(period, [...(salesTrend.get(period) ?? []), row]);
  }
  const trend = [...salesTrend].sort(([a], [b]) => a.localeCompare(b)).map(([period, rows]) => {
    const sales = aggregateSales(rows);
    return {
      period,
      label: periodLabel(period, granularity),
      gross: round2(sales.gross),
      net: round2(sales.gross - sales.discounts - (returnTrend.get(period) ?? 0)),
      transactions: sales.transactions,
    };
  });

  return {
    meta: {
      from,
      to,
      today,
      scope: scope.mode,
      scopeLabel: scope.label,
      outletIds: scope.outletIds,
      trend: granularity,
      generatedAt: new Date().toISOString(),
      generatedBy: actor.impersonation ? `${actor.name} (via ${actor.impersonation.adminName})` : actor.name,
      businessName: store.settings.businessName,
      canPickOutlet: can(actor, "reports.consolidated") && !isOutletScoped(actor.role),
    },
    totals,
    byOutlet,
    byCashier,
    trend,
  };
}

export type SalesOverview = ReturnType<typeof buildSalesOverview>;
