// Management reports computed from live ERP data.

import { batches, outlets, products } from "@/lib/data";
import { daysToExpiry, isExpired, outletName, saleTenders } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import type { Actor } from "@/lib/erp/types";
import { can, isOutletScoped } from "@/lib/rbac";

const DAY = 1000 * 60 * 60 * 24;
export const REPORT_PERIODS = [7, 30, 90] as const;

export type ReportOptions = { days: number; outletId: string | null };

function pct(part: number, whole: number) {
  return whole ? Math.round((part / whole) * 1000) / 10 : 0;
}

export function buildReport(actor: Actor, options: ReportOptions) {
  const store = getStore();
  const days = (REPORT_PERIODS as readonly number[]).includes(options.days) ? options.days : 30;
  const sections = {
    sales: can(actor, "reports.sales"),
    inventory: can(actor, "reports.inventory"),
    financial: can(actor, "reports.financial"),
  };
  // Consolidated (all-outlet) reporting is a central permission; everyone else sees their active outlet.
  const consolidated = can(actor, "reports.consolidated") && !isOutletScoped(actor.role);
  const outletId = consolidated ? options.outletId : (actor.outletId ?? actor.outletIds[0] ?? null);
  const inScope = (id: string | null | undefined) => !outletId || id === outletId;

  const now = Date.now();
  const start = new Date(now - days * DAY).toISOString();
  const previousStart = new Date(now - 2 * days * DAY).toISOString();
  const costOf = (productId: string, fallback: number) => products.find((product) => product.id === productId)?.purchasePrice ?? fallback * 0.7;

  const valid = store.sales.filter((sale) => sale.status !== "Voided" && inScope(sale.outletId));
  const sales = valid.filter((sale) => sale.date >= start);
  const previous = valid.filter((sale) => sale.date >= previousStart && sale.date < start);

  // ---- summary & P&L
  const revenue = sales.reduce((sum, sale) => sum + sale.total, 0);
  const netSales = sales.reduce((sum, sale) => sum + sale.subtotal - sale.discount, 0);
  const vat = sales.reduce((sum, sale) => sum + sale.vat, 0);
  const discounts = sales.reduce((sum, sale) => sum + sale.discount, 0);
  const cogs = sales.reduce((sum, sale) => sum + sale.lines.reduce((acc, line) => acc + line.quantity * costOf(line.productId, line.unitPrice), 0), 0);
  const grossProfit = netSales - cogs;
  const expenseRows = store.expenses.filter((expense) => expense.date >= start.slice(0, 10) && (expense.status === "Approved" || expense.status === "Paid") && inScope(expense.outletId));
  const operatingExpenses = expenseRows.reduce((sum, expense) => sum + expense.amount, 0);
  const previousRevenue = previous.reduce((sum, sale) => sum + sale.total, 0);

  const summary = {
    revenue,
    netSales,
    vat,
    discounts,
    invoices: sales.length,
    avgBasket: sales.length ? Math.round(revenue / sales.length) : 0,
    cogs: Math.round(cogs),
    grossProfit: Math.round(grossProfit),
    grossMargin: pct(grossProfit, netSales),
    operatingExpenses,
    netProfit: Math.round(grossProfit - operatingExpenses),
    revenueChange: previousRevenue ? pct(revenue - previousRevenue, previousRevenue) : null,
    voided: store.sales.filter((sale) => sale.status === "Voided" && sale.date >= start && inScope(sale.outletId)).length,
  };

  // ---- trend (daily up to 31 days, weekly beyond)
  const bucketDays = days > 31 ? 7 : 1;
  const trend: { month: string; sales: number }[] = [];
  for (let offset = days - bucketDays; offset >= 0; offset -= bucketDays) {
    const from = now - (offset + bucketDays) * DAY;
    const to = now - offset * DAY;
    const label = new Date(to - DAY / 2).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    trend.push({
      month: bucketDays === 1 ? label : `w/e ${label}`,
      sales: sales.filter((sale) => { const t = Date.parse(sale.date); return t >= from && t < to; }).reduce((sum, sale) => sum + sale.total, 0),
    });
  }

  // ---- by outlet
  const byOutlet = outlets
    .filter((outlet) => outlet.type !== "WAREHOUSE" && inScope(outlet.id))
    .map((outlet) => {
      const rows = sales.filter((sale) => sale.outletId === outlet.id);
      const net = rows.reduce((sum, sale) => sum + sale.subtotal - sale.discount, 0);
      const cost = rows.reduce((sum, sale) => sum + sale.lines.reduce((acc, line) => acc + line.quantity * costOf(line.productId, line.unitPrice), 0), 0);
      return {
        id: outlet.id,
        name: outlet.name,
        invoices: rows.length,
        revenue: rows.reduce((sum, sale) => sum + sale.total, 0),
        vat: rows.reduce((sum, sale) => sum + sale.vat, 0),
        grossProfit: Math.round(net - cost),
        margin: pct(net - cost, net),
      };
    });

  // ---- by item
  const itemMap = new Map<string, { name: string; quantity: number; revenue: number; cost: number; invoices: number }>();
  for (const sale of sales) {
    for (const line of sale.lines) {
      const row = itemMap.get(line.productName) ?? { name: line.productName, quantity: 0, revenue: 0, cost: 0, invoices: 0 };
      row.quantity += line.quantity;
      row.revenue += line.total;
      row.cost += line.quantity * costOf(line.productId, line.unitPrice);
      row.invoices += 1;
      itemMap.set(line.productName, row);
    }
  }
  const byItem = [...itemMap.values()]
    .map((row) => ({ ...row, cost: Math.round(row.cost), grossProfit: Math.round(row.revenue - row.cost), margin: pct(row.revenue - row.cost, row.revenue), share: pct(row.revenue, netSales) }))
    .sort((a, b) => b.revenue - a.revenue);

  // ---- by payment method
  const byMethod = ["Cash", "Card", "Transfer", "Credit", "HMO", "Account"].map((method) => {
    const rows = sales.filter((sale) => saleTenders(sale).some((row) => row.method === method));
    const amount = sales.reduce((sum, sale) => sum + saleTenders(sale).filter((row) => row.method === method).reduce((acc, row) => acc + row.amount, 0), 0);
    return { method: method === "Card" ? "POS terminal" : method, invoices: rows.length, amount, share: pct(amount, revenue) };
  }).filter((row) => row.invoices > 0 || ["Cash", "POS terminal", "Transfer"].includes(row.method));

  // ---- stock valuation & expiry exposure (point in time)
  const stock = outlets
    .filter((outlet) => inScope(outlet.id))
    .map((outlet) => {
      const items = products.filter((product) => product.outletId === outlet.id);
      const locationBatches = batches.filter((batch) => batch.assignedOutletId === outlet.id && batch.availableQuantity > 0);
      const costValue = items.reduce((sum, product) => sum + product.stock * product.purchasePrice, 0);
      const retailValue = items.reduce((sum, product) => sum + product.stock * product.sellingPrice, 0);
      return {
        id: outlet.id,
        name: outlet.name,
        type: outlet.type ?? "RETAIL",
        skus: items.length,
        units: items.reduce((sum, product) => sum + product.stock, 0),
        costValue,
        retailValue,
        potentialMargin: retailValue - costValue,
        expiredValue: locationBatches.filter((batch) => isExpired(batch, now)).reduce((sum, batch) => sum + batch.availableQuantity * batch.purchasePrice, 0),
        expiring90Value: locationBatches
          .filter((batch) => !isExpired(batch, now) && daysToExpiry(batch, now) <= 90)
          .reduce((sum, batch) => sum + batch.availableQuantity * batch.purchasePrice, 0),
        lowStock: items.filter((product) => product.status === "LOW_STOCK").length,
      };
    });

  // ---- VAT by calendar month (last 6 months, independent of the period filter)
  const vatMonthly: { month: string; taxableSales: number; outputVat: number; invoices: number; dueDate: string }[] = [];
  const cursor = new Date(now);
  for (let i = 5; i >= 0; i -= 1) {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() - i + 1, 1);
    const rows = valid.filter((sale) => { const t = Date.parse(sale.date); return t >= monthStart.getTime() && t < monthEnd.getTime(); });
    if (rows.length === 0 && i > 1) continue;
    vatMonthly.push({
      month: monthStart.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
      taxableSales: rows.reduce((sum, sale) => sum + sale.subtotal - sale.discount, 0),
      outputVat: rows.reduce((sum, sale) => sum + sale.vat, 0),
      invoices: rows.length,
      // VAT returns are due by the 21st of the following month.
      dueDate: new Date(monthEnd.getFullYear(), monthEnd.getMonth(), 21).toISOString().slice(0, 10),
    });
  }

  // ---- purchases by supplier (orders raised in the period)
  const orders = store.purchaseOrders.filter((order) => order.createdAt >= start && order.status !== "Cancelled" && inScope(order.outletId));
  const purchases = store.suppliers
    .map((supplier) => {
      const rows = orders.filter((order) => order.supplierId === supplier.id);
      const ordered = rows.reduce((sum, order) => sum + order.total, 0);
      const received = rows.reduce((sum, order) => sum + order.lines.reduce((acc, line) => acc + line.receivedQuantity * line.unitCost, 0), 0);
      return { id: supplier.id, name: supplier.name, orders: rows.length, ordered, received, fillRate: pct(received, ordered), outstanding: supplier.balance };
    })
    .filter((row) => row.orders > 0 || row.outstanding > 0)
    .sort((a, b) => b.ordered - a.ordered);

  // ---- expenses by category
  const categoryMap = new Map<string, { category: string; count: number; amount: number }>();
  for (const expense of expenseRows) {
    const row = categoryMap.get(expense.category) ?? { category: expense.category, count: 0, amount: 0 };
    row.count += 1;
    row.amount += expense.amount;
    categoryMap.set(expense.category, row);
  }
  const expenses = [...categoryMap.values()].map((row) => ({ ...row, share: pct(row.amount, operatingExpenses) })).sort((a, b) => b.amount - a.amount);

  // ---- by cashier (sales performance)
  const cashierMap = new Map<string, { cashier: string; invoices: number; revenue: number; items: number }>();
  for (const sale of sales) {
    const row = cashierMap.get(sale.cashier) ?? { cashier: sale.cashier, invoices: 0, revenue: 0, items: 0 };
    row.invoices += 1;
    row.revenue += sale.total;
    row.items += sale.lines.reduce((sum, line) => sum + line.quantity, 0);
    cashierMap.set(sale.cashier, row);
  }
  const voidsBy = new Map<string, number>();
  for (const sale of store.sales.filter((row) => row.status === "Voided" && row.date >= start && inScope(row.outletId))) {
    voidsBy.set(sale.cashier, (voidsBy.get(sale.cashier) ?? 0) + 1);
  }
  const byCashier = [...cashierMap.values()]
    .map((row) => ({ ...row, avgBasket: Math.round(row.revenue / row.invoices), voids: voidsBy.get(row.cashier) ?? 0, share: pct(row.revenue, revenue) }))
    .sort((a, b) => b.revenue - a.revenue);

  const showSales = sections.sales || sections.financial;
  const financialOnly = <T,>(value: T, empty: T) => (sections.financial ? value : empty);

  return {
    meta: {
      days,
      outletId,
      scopeLabel: outletName(outletId),
      from: start.slice(0, 10),
      to: new Date(now).toISOString().slice(0, 10),
      generatedAt: new Date(now).toISOString(),
      generatedBy: actor.name,
      locked: !consolidated,
      sections,
    },
    summary: showSales
      ? financialOnly(summary, { ...summary, cogs: 0, grossProfit: 0, grossMargin: 0, operatingExpenses: 0, netProfit: 0 })
      : { ...summary, revenue: 0, netSales: 0, vat: 0, discounts: 0, invoices: 0, avgBasket: 0, cogs: 0, grossProfit: 0, grossMargin: 0, operatingExpenses: 0, netProfit: 0, revenueChange: null, voided: 0 },
    trend: showSales ? trend : [],
    byOutlet: showSales ? byOutlet.map((row) => financialOnly(row, { ...row, grossProfit: 0, margin: 0 })) : [],
    byItem: showSales ? byItem.map((row) => financialOnly(row, { ...row, cost: 0, grossProfit: 0, margin: 0 })) : [],
    byMethod: showSales ? byMethod : [],
    byCashier: sections.sales ? byCashier : [],
    stock: sections.inventory || sections.financial ? stock : [],
    vatMonthly: financialOnly(vatMonthly, []),
    purchases: sections.inventory || sections.financial ? purchases : [],
    expenses: financialOnly(expenses, []),
  };
}

export type Report = ReturnType<typeof buildReport>;
