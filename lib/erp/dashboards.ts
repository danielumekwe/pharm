// Role-based dashboard read models. Each role gets the figures behind its main daily job; every query is
// scoped by the same outlet/permission rules the APIs use (sales via salesScope, stock via scopeByOutlet).

import { batches, outlets, products, stockMovements } from "@/lib/data";
import { alertSummary } from "@/lib/erp/alerts";
import { LEDGER_LABELS } from "@/lib/erp/ledger";
import { heldSalesFor, salesHistory } from "@/lib/erp/pos";
import { expiryState } from "@/lib/erp/regulatory";
import { buildSalesOverview, localToday, type TrendGranularity } from "@/lib/erp/sales-overview";
import { daysToExpiry, isBatchBlocked, isExpired, outletName, saleTenders, scopeByOutlet, visibleSales } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import { transfersFor } from "@/lib/erp/transfers";
import type { Actor, SaleInvoice } from "@/lib/erp/types";
import { can, isOutletScoped } from "@/lib/rbac";

const DAY = 86_400_000;
const round2 = (value: number) => Math.round(value * 100) / 100;

export type DashboardKind = "admin" | "manager" | "sales" | "cashier" | "inventory" | "regulatory";

/** Which dashboard a user sees: their role's main job, falling back on what they are allowed to do. */
export function dashboardKind(actor: Actor): DashboardKind {
  switch (actor.role) {
    case "SUPER_ADMIN":
      return "admin";
    case "PHARMACY_MANAGER":
      return "manager";
    case "REGULATORY_OFFICER":
      return "regulatory";
    case "SALES_MANAGER":
      return "sales";
    case "CASHIER":
      return "cashier";
    case "STOCK_MANAGER":
      return "inventory";
    default:
      return can(actor, "sales.create") ? "cashier" : can(actor, "stock.view") ? "inventory" : "cashier";
  }
}

// ---------------------------------------------------------------- shared pieces

function topProducts(sales: SaleInvoice[], limit = 6) {
  const map = new Map<string, { name: string; units: number; revenue: number }>();
  for (const sale of sales) {
    if (sale.status === "Voided") continue;
    for (const line of sale.lines) {
      const row = map.get(line.productName) ?? { name: line.productName, units: 0, revenue: 0 };
      row.units += line.quantity;
      row.revenue += line.total;
      map.set(line.productName, row);
    }
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, limit).map((row) => ({ ...row, revenue: round2(row.revenue) }));
}

function paymentMix(sales: SaleInvoice[]) {
  const totals: Record<string, number> = { Cash: 0, "POS terminal": 0, Transfer: 0, "On account": 0 };
  for (const sale of sales) {
    if (sale.status === "Voided") continue;
    for (const tender of saleTenders(sale)) {
      const key = tender.method === "Card" ? "POS terminal" : tender.method === "Cash" || tender.method === "Transfer" ? tender.method : "On account";
      totals[key] += tender.amount;
    }
  }
  return Object.entries(totals).map(([name, value]) => ({ name, value: round2(value) })).filter((row) => row.value > 0);
}

function recentSales(sales: SaleInvoice[], limit = 8) {
  return [...sales].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit).map((sale) => ({
    id: sale.id,
    number: sale.number,
    date: sale.date,
    customer: sale.customerName,
    cashier: sale.cashier,
    outlet: outletName(sale.outletId),
    total: sale.total,
    status: sale.status,
    payment: sale.payments?.length ? sale.payments.map((row) => (row.method === "Card" ? "POS" : row.method)).join(" + ") : sale.paymentMethod === "Card" ? "POS" : sale.paymentMethod,
  }));
}

function stockPosition(actor: Actor, outletFilter?: string | null) {
  const now = Date.now();
  const nearDays = getStore().settings.nearExpiryDays;
  const inScope = <T>(rows: T[], get: (row: T) => string) => scopeByOutlet(actor, rows, get).filter((row) => !outletFilter || get(row) === outletFilter);
  const items = inScope(products, (row) => row.outletId);
  const held = inScope(batches, (row) => row.assignedOutletId).filter((batch) => batch.availableQuantity > 0);
  const expiring = held.filter((batch) => !isExpired(batch, now) && daysToExpiry(batch, now) <= nearDays).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  const expired = held.filter((batch) => isExpired(batch, now));
  const low = items.filter((product) => product.status === "LOW_STOCK" && (product.lifecycle ?? "ACTIVE") === "ACTIVE").sort((a, b) => a.stock / Math.max(1, a.minStock) - b.stock / Math.max(1, b.minStock));
  const batchRow = (batch: (typeof held)[number]) => ({ id: batch.id, productId: batch.productId, product: batch.productName, batchNumber: batch.batchNumber, outlet: outletName(batch.assignedOutletId), expiryDate: batch.expiryDate, days: daysToExpiry(batch, now), quantity: batch.availableQuantity, value: round2(batch.availableQuantity * batch.purchasePrice), blocked: isBatchBlocked(batch, now) });
  return {
    products: new Set(items.map((row) => row.name)).size,
    records: items.length,
    units: items.reduce((sum, row) => sum + row.stock, 0),
    valueAtCost: round2(held.reduce((sum, batch) => sum + batch.availableQuantity * batch.purchasePrice, 0)),
    valueAtRetail: round2(items.reduce((sum, row) => sum + row.stock * row.sellingPrice, 0)),
    lowCount: low.length,
    low: low.slice(0, 8).map((row) => ({ id: row.id, name: row.name, outlet: outletName(row.outletId), stock: row.stock, minStock: row.minStock, unit: row.baseUnit || row.uom })),
    expiringCount: expiring.length,
    expiring: expiring.slice(0, 8).map(batchRow),
    expiredCount: expired.length,
    expiredValue: round2(expired.reduce((sum, batch) => sum + batch.availableQuantity * batch.purchasePrice, 0)),
    expired: expired.slice(0, 6).map(batchRow),
    byOutlet: scopeByOutlet(actor, outlets, (row) => row.id)
      .filter((outlet) => !outletFilter || outlet.id === outletFilter)
      .map((outlet) => ({ name: outlet.name, value: round2(held.filter((batch) => batch.assignedOutletId === outlet.id).reduce((sum, batch) => sum + batch.availableQuantity * batch.purchasePrice, 0)) }))
      .filter((row) => row.value > 0),
    nearExpiryDays: nearDays,
  };
}

function transferSummary(actor: Actor) {
  const rows = transfersFor(actor).filter((row) => ["Pending approval", "Approved", "Dispatched", "Partially received", "Draft"].includes(row.status));
  return {
    count: rows.length,
    rows: rows.slice(0, 6).map((row) => ({ id: row.id, reference: row.reference, from: outletName(row.fromOutletId), to: outletName(row.toOutletId), status: row.status, items: row.lines.length, incoming: isOutletScoped(actor.role) ? actor.outletIds.includes(row.toOutletId) : false })),
  };
}

function safeOverview(actor: Actor, options: Parameters<typeof buildSalesOverview>[1]) {
  try {
    return buildSalesOverview(actor, options);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- role builders

/** Sales manager: the outlet's selling day, team and products. */
function salesDashboard(actor: Actor) {
  const store = getStore();
  const today = localToday();
  const overview = safeOverview(actor, { from: today, to: today, trend: "daily" });
  const outletId = actor.outletId ?? actor.outletIds[0] ?? null;
  const sales = visibleSales(actor);
  const last30 = sales.filter((sale) => Date.parse(sale.date) >= Date.now() - 30 * DAY);
  const todays = sales.filter((sale) => sale.date.slice(0, 10) === new Date().toISOString().slice(0, 10) && sale.status !== "Voided");
  const target = outletId ? store.settings.salesTargets[outletId] : undefined;
  return {
    outlet: outletId ? outletName(outletId) : "All outlets",
    today: overview?.totals ?? null,
    held: heldSalesFor(actor, outletId).length,
    target: target ? { amount: target, achieved: overview?.totals.net ?? 0, pct: Math.min(100, Math.round(((overview?.totals.net ?? 0) / target) * 100)) } : null,
    trend: (overview?.trend ?? []).slice(-14).map((row) => ({ label: row.label, value: row.net })),
    byCashier: (overview?.byCashier ?? []).map((row) => ({ name: row.cashier, value: row.net, transactions: row.transactions })),
    topProducts: topProducts(last30),
    paymentMix: paymentMix(todays.length ? todays : last30),
    paymentMixPeriod: todays.length ? "Today" : "Last 30 days",
    recent: recentSales(sales),
  };
}

/** Cashier: their own till today. */
function cashierDashboard(actor: Actor) {
  const outletId = actor.outletId ?? actor.outletIds[0] ?? null;
  const mine = visibleSales(actor).filter((sale) => sale.cashierId === actor.id || (!sale.cashierId && sale.cashier === actor.name));
  const today = new Date().toISOString().slice(0, 10);
  const todays = mine.filter((sale) => sale.date.slice(0, 10) === today);
  const completed = todays.filter((sale) => sale.status !== "Voided");
  const returns = getStore().saleReturns.filter((row) => row.processedById === actor.id && row.date.slice(0, 10) === today);
  return {
    outlet: outletId ? outletName(outletId) : "",
    todayCount: completed.length,
    todayTotal: round2(completed.reduce((sum, sale) => sum + sale.total, 0)),
    itemsSold: completed.reduce((sum, sale) => sum + sale.lines.length, 0),
    avgBasket: completed.length ? round2(completed.reduce((sum, sale) => sum + sale.total, 0) / completed.length) : 0,
    held: heldSalesFor(actor, outletId).filter((row) => row.cashierId === actor.id).map((row) => ({ id: row.id, reference: row.reference, kind: row.kind, label: row.label, lines: row.cart.lines.length, updatedAt: row.updatedAt })),
    voided: todays.length - completed.length,
    returns: returns.length,
    firstSale: completed.length ? completed[completed.length - 1].date : null,
    lastSale: completed[0]?.date ?? null,
    paymentMix: paymentMix(completed),
    recent: recentSales(mine, 10),
  };
}

/** Stock manager: receiving, stock health and pending stock work at their outlet. */
function inventoryDashboard(actor: Actor) {
  const store = getStore();
  const position = stockPosition(actor);
  const orders = scopeByOutlet(actor, store.purchaseOrders, (row) => row.outletId).filter((row) => row.status === "Approved" || row.status === "Partially received");
  const pendingMoves = scopeByOutlet(actor, stockMovements, (row) => row.outletId).filter((row) => row.status === "Pending");
  const ledger = scopeByOutlet(actor, store.stockLedger, (row) => row.outletId).slice(0, 10);
  return {
    position,
    transfers: transferSummary(actor),
    receiving: { count: orders.length, rows: orders.slice(0, 5).map((row) => ({ id: row.id, number: row.number, supplier: row.supplierName, expected: row.expectedDate, outstanding: row.lines.reduce((sum, line) => sum + line.quantity - line.receivedQuantity, 0) })) },
    adjustments: { count: pendingMoves.length, rows: pendingMoves.slice(0, 5).map((row) => ({ id: row.id, reference: row.reference, type: row.type, product: row.productName, quantity: row.quantity, requestedBy: row.requestedBy ?? "" })) },
    movements: ledger.map((row) => ({ id: row.id, at: row.at, reference: row.reference, type: LEDGER_LABELS[row.type], product: row.productName, quantity: row.baseQuantity, outlet: outletName(row.outletId) })),
  };
}

/** Pharmacy manager: operations across the outlets they may see. */
function managerDashboard(actor: Actor) {
  const store = getStore();
  const today = localToday();
  const todayOverview = safeOverview(actor, { from: today, to: today, trend: "daily" });
  const monthStart = new Date(Date.now() - 29 * DAY + 3_600_000).toISOString().slice(0, 10);
  const month = safeOverview(actor, { from: monthStart, to: today, trend: "daily" });
  const sales = visibleSales(actor);
  const expensesMonth = scopeByOutlet(actor, store.expenses, (row) => row.outletId).filter((row) => row.date >= monthStart && (row.status === "Approved" || row.status === "Paid"));
  return {
    today: todayOverview?.totals ?? null,
    byOutletToday: (todayOverview?.byOutlet ?? []).map((row) => ({ name: row.name, value: row.net, transactions: row.transactions })),
    outletPerformance: (month?.byOutlet ?? []).map((row) => ({ name: row.name, value: row.net, transactions: row.transactions, avgBasket: row.avgBasket })),
    trend: (month?.trend ?? []).map((row) => ({ label: row.label, value: row.net })),
    byCashier: (month?.byCashier ?? []).slice(0, 8).map((row) => ({ name: `${row.cashier}`, value: row.net, transactions: row.transactions, note: row.outlets })),
    position: stockPosition(actor),
    transfers: transferSummary(actor),
    alerts: can(actor, "alerts.view") ? alertSummary(actor) : null,
    recent: recentSales(sales),
    finance: {
      receivable: round2(store.customers.reduce((sum, row) => sum + Math.max(0, row.balance), 0)),
      payable: round2(store.suppliers.reduce((sum, row) => sum + Math.max(0, row.balance), 0)),
      expenses30: round2(expensesMonth.reduce((sum, row) => sum + row.amount, 0)),
      net30: month?.totals.net ?? 0,
      cashToday: todayOverview?.totals.payments.netCash ?? 0,
    },
  };
}

export type AdminFilters = { from?: string; to?: string; outlet?: string | null; trend?: TrendGranularity };

/** Super Admin: consolidated monitoring with date-range and outlet filters. */
function adminDashboard(actor: Actor, filters: AdminFilters) {
  const store = getStore();
  const today = localToday();
  const to = filters.to || today;
  const from = filters.from || to;
  const outlet = filters.outlet && filters.outlet !== "all" ? filters.outlet : null;
  const overview = buildSalesOverview(actor, { from, to, outlet, trend: filters.trend ?? "daily" });
  const inRange = visibleSales(actor).filter((sale) => sale.date.slice(0, 10) >= from && sale.date.slice(0, 10) <= to && (!outlet || sale.outletId === outlet));
  const since = Date.now() - DAY;
  const activity = new Map<string, { name: string; role: string; actions: number; last: string }>();
  for (const event of store.audit) {
    if (Date.parse(event.at) < since) break;
    if (outlet && event.outletId && event.outletId !== outlet) continue;
    const row = activity.get(event.actorId) ?? { name: event.actorName, role: event.actorRole, actions: 0, last: event.at };
    row.actions += 1;
    activity.set(event.actorId, row);
  }
  return {
    filters: { from, to, outlet: outlet ?? "all", trend: overview.meta.trend },
    totals: overview.totals,
    byOutlet: overview.byOutlet.map((row) => ({ name: row.name, value: row.net, gross: row.gross, discounts: row.discounts, returns: row.returns, transactions: row.transactions })),
    byCashier: overview.byCashier.slice(0, 10).map((row) => ({ name: row.cashier, value: row.net, transactions: row.transactions, note: row.outlets })),
    trend: overview.trend.map((row) => ({ label: row.label, value: row.net })),
    topProducts: topProducts(inRange, 8),
    paymentMix: paymentMix(inRange),
    position: stockPosition(actor, outlet),
    transfers: transferSummary(actor),
    staff: [...activity.values()].sort((a, b) => b.actions - a.actions).slice(0, 8),
    outlets: outlets.filter((row) => row.type !== "WAREHOUSE").map((row) => ({ id: row.id, name: row.name })),
    history: salesHistory(actor, { from, to, outletId: outlet ?? undefined }).totals,
  };
}

/** Regulatory officer: registrations, renewals and documents. */
function regulatoryDashboard() {
  const store = getStore();
  const rows = store.registrations.map((row) => ({ ...row, ...expiryState(row.nafdacNumber, row.expiryDate) }));
  const status = (row: (typeof rows)[number]) => row.status ?? (row.nafdacNumber === "Pending" ? "Pending" : "Registered");
  const months = new Map<string, { month: string; items: { id: string; name: string; date: string; kind: string }[] }>();
  const horizon = Date.now() + 365 * DAY;
  for (const row of rows) {
    for (const [kind, date] of [["Expiry", row.expiryDate], ["Renewal", row.renewalDate]] as const) {
      if (!date || Date.parse(date) < Date.now() - 31 * DAY || Date.parse(date) > horizon) continue;
      const key = date.slice(0, 7);
      const bucket = months.get(key) ?? { month: key, items: [] };
      bucket.items.push({ id: row.id, name: row.productName, date, kind });
      months.set(key, bucket);
    }
  }
  const documents = store.documents;
  return {
    total: rows.length,
    registered: rows.filter((row) => ["Registered", "Renewal in progress"].includes(status(row))).length,
    pending: rows.filter((row) => status(row) === "Pending").length,
    underReview: rows.filter((row) => status(row) === "Under review").length,
    rejected: rows.filter((row) => status(row) === "Rejected" || status(row) === "Suspended").length,
    renewalsDue: rows.filter((row) => row.state === "Renewal due").length,
    expired: rows.filter((row) => row.state === "Expired" || status(row) === "Expired").length,
    attention: rows
      .filter((row) => row.state !== "Valid" || ["Pending", "Under review"].includes(status(row)))
      .sort((a, b) => (a.days ?? -9999) - (b.days ?? -9999))
      .slice(0, 10)
      .map((row) => ({ id: row.id, name: row.productName, nafdac: row.nafdacNumber, status: status(row), state: row.state, days: row.days, expiryDate: row.expiryDate })),
    documents: { total: documents.length, expiringSoon: documents.filter((doc) => doc.expiresOn && Date.parse(doc.expiresOn) < Date.now() + 90 * DAY).length, recent: documents.slice(0, 5).map((doc) => ({ id: doc.id, title: doc.title, category: doc.category, uploadedAt: doc.uploadedAt })) },
    calendar: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(0, 12),
  };
}

export function buildDashboard(actor: Actor, filters: AdminFilters = {}) {
  const kind = dashboardKind(actor);
  switch (kind) {
    case "admin":
      return { kind, data: adminDashboard(actor, filters) } as const;
    case "manager":
      return { kind, data: managerDashboard(actor) } as const;
    case "sales":
      return { kind, data: salesDashboard(actor) } as const;
    case "cashier":
      return { kind, data: cashierDashboard(actor) } as const;
    case "inventory":
      return { kind, data: inventoryDashboard(actor) } as const;
    case "regulatory":
      return { kind, data: regulatoryDashboard() } as const;
  }
}

export type Dashboard = ReturnType<typeof buildDashboard>;
