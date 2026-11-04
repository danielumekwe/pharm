import {
  AlertTriangle,
  ArrowUpRight,
  CreditCard,
  PackageCheck,
  ShoppingCart,
  TrendingUp,
} from "lucide-react";

import Link from "next/link";

import { DashboardShell } from "@/components/dashboard-shell";
import { SalesAreaChart, OutletBarChart } from "@/components/charts";
import { getDashboardSnapshot, outlets, products, stockMovements } from "@/lib/data";
import { getSalesKpis, scopeByOutlet } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import { compactMoney, isoDaysFromNow, money } from "@/lib/format";
import { can } from "@/lib/rbac";
import { alertSummary } from "@/lib/erp/alerts";
import { requirePage } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function DashboardPage() {
  const actor = await requirePage("dashboard.view", "/dashboard");
  const store = getStore();
  const sales = scopeByOutlet(actor, store.sales, (sale) => sale.outletId);
  const kpis = getSalesKpis(sales);
  const scopedProducts = scopeByOutlet(actor, products, (product) => product.outletId);
  const orders = scopeByOutlet(actor, store.purchaseOrders, (order) => order.outletId);
  const payables = store.suppliers.reduce((sum, supplier) => sum + supplier.balance, 0);
  const since = isoDaysFromNow(-30);

  const base = getDashboardSnapshot();
  const snapshot = {
    ...base,
    monthlySales: kpis.gross,
    lowStock: scopedProducts.filter((product) => product.status === "LOW_STOCK"),
    salesByOutlet: scopeByOutlet(actor, outlets.filter((outlet) => outlet.type !== "WAREHOUSE"), (outlet) => outlet.id).map((outlet) => ({
      name: outlet.name,
      value: sales.filter((sale) => sale.outletId === outlet.id && sale.status !== "Voided" && sale.date >= since).reduce((sum, sale) => sum + sale.total, 0),
    })),
    recentTransactions: scopeByOutlet(actor, stockMovements, (movement) => movement.outletId).slice(0, 6),
  };

  // Dashboard tiles follow the viewer's permissions: sales and finance figures only for roles that may see them.
  const showSales = can(actor, "sales.view");
  const showFinance = can(actor, "finance.view");
  const pendingMovements = scopeByOutlet(actor, stockMovements, (movement) => movement.outletId).filter((movement) => movement.status === "Pending");
  const candidates = [
    showSales && {
      title: "Today's Sales",
      value: money(kpis.todaySales),
      note: `${sales.filter((sale) => sale.date.slice(0, 10) === new Date().toISOString().slice(0, 10) && sale.status !== "Voided").length} invoices today`,
      icon: ShoppingCart,
    },
    can(actor, "purchase.view") && {
      title: "Open Purchase Orders",
      value: String(orders.filter((order) => ["Pending approval", "Approved", "Partially received"].includes(order.status)).length),
      note: `${orders.filter((order) => order.status === "Pending approval").length} awaiting approval`,
      icon: PackageCheck,
    },
    showFinance && {
      title: "Payment Receivables",
      value: money(kpis.receivable),
      note: "Credit, HMO & corporate accounts",
      icon: TrendingUp,
    },
    showFinance && {
      title: "Payment Payables",
      value: money(payables),
      note: "Owed to suppliers for received goods",
      icon: CreditCard,
    },
    {
      title: "Stock at cost",
      value: money(scopedProducts.reduce((sum, product) => sum + product.stock * product.purchasePrice, 0)),
      note: `${scopedProducts.length} item-location records`,
      icon: PackageCheck,
    },
    {
      title: "Pending stock approvals",
      value: String(pendingMovements.length),
      note: "Transfers, adjustments & destructions",
      icon: TrendingUp,
    },
    {
      title: "Below reorder level",
      value: String(scopedProducts.filter((product) => product.status === "LOW_STOCK").length),
      note: "Raise a PO or request a transfer",
      icon: CreditCard,
    },
  ];
  const alerts = can(actor, "alerts.view") ? alertSummary(actor) : null;
  const stats = candidates.filter((item): item is Exclude<typeof item, false> => Boolean(item)).slice(0, 4);

  const recentInvoices = sales.slice(0, 5).map((sale) => ({
    date: new Date(sale.date).toLocaleDateString("en-GB").replace(/\//g, "-"),
    code: sale.number,
    customer: sale.customerName,
    total: money(sale.total),
    balance: money(sale.status === "Voided" ? 0 : sale.total - sale.amountPaid),
    status: sale.status === "Paid" ? "PAID" : sale.status === "Voided" ? "VOIDED" : "UNPAID",
  }));

  const lowStock = [...scopedProducts]
    .sort((a, b) => a.stock / Math.max(1, a.minStock) - b.stock / Math.max(1, b.minStock))
    .slice(0, 5)
    .map((product) => ({
      name: product.name,
      brand: product.manufacturer,
      category: product.category,
      min: String(product.minStock),
      stock: String(product.stock),
      unit: product.uom,
    }));

  return (
    <DashboardShell>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ title, value, note, icon: Icon }) => (
          <Card key={title} className="border-slate-800 bg-slate-900/70">
            <CardContent className="p-5">
              <div className="flex items-center justify-between text-slate-300">
                <p className="text-sm">{title}</p>
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-emerald-300">
                  <Icon className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-4 text-2xl font-semibold text-white">{value}</p>
              <p className="mt-2 text-xs text-slate-400">{note}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {alerts ? (
        <section className="mt-6 rounded-2xl border border-l-4 border-slate-800 border-l-lime-400 bg-slate-900/70 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">Inventory alerts</p>
              <p className="text-sm text-slate-400">Live from batch-level stock · {alerts.unacknowledged} unacknowledged</p>
            </div>
            <Link href="/alerts" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800">Open alerts centre</Link>
          </div>
          <div className={`mt-4 grid gap-3 sm:grid-cols-2 ${alerts.showExpiry ? "xl:grid-cols-5" : "xl:grid-cols-2"}`}>
            {[
              { label: "Low-stock products", value: String(alerts.lowStock), note: `${alerts.outOfStock} out of stock`, href: "/alerts?tab=low", tone: alerts.lowStock ? "text-amber-300" : "text-white" },
              { label: "Outlets with critical shortages", value: String(alerts.criticalOutlets.length), note: alerts.criticalOutlets.map((row) => row.name.replace(/^Outlet \d - /, "")).join(", ") || "None", href: "/alerts?tab=low", tone: alerts.criticalOutlets.length ? "text-rose-300" : "text-white" },
              ...(alerts.showExpiry
                ? [
                    { label: "Expired batches", value: String(alerts.expiredBatches), note: "Blocked from sale", href: "/alerts?tab=expired", tone: alerts.expiredBatches ? "text-rose-300" : "text-white" },
                    { label: "Expired stock value", value: compactMoney(alerts.expiredValue), note: "At cost, awaiting return/disposal", href: "/alerts?tab=expired", tone: alerts.expiredValue ? "text-rose-300" : "text-white" },
                    { label: "Approaching expiry", value: String(alerts.nearExpiryProducts), note: `${alerts.nearExpiry} batch(es)`, href: "/alerts?tab=near", tone: alerts.nearExpiry ? "text-amber-300" : "text-white" },
                  ]
                : []),
            ].map((widget) => (
              <Link key={widget.label} href={widget.href} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 transition hover:border-emerald-500/40">
                <p className="text-xs text-slate-400">{widget.label}</p>
                <p className={`mt-1 text-2xl font-semibold tabular-nums ${widget.tone}`}>{widget.value}</p>
                <p className="truncate text-[11px] text-slate-500">{widget.note}</p>
              </Link>
            ))}
          </div>
          {alerts.recent.length ? (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-slate-400">Recent alerts</p>
              <ul className="grid gap-2 md:grid-cols-2">
                {alerts.recent.slice(0, 6).map((alert) => (
                  <li key={alert.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate text-white">{alert.productName}{alert.batchNumber ? ` · ${alert.batchNumber}` : ""}</span>
                      <span className="block text-[11px] text-slate-500">
                        {alert.type === "LOW_STOCK" ? `${alert.snapshot.available} left (min ${alert.snapshot.minStock})` : alert.type === "EXPIRED" ? `Expired ${alert.snapshot.expiryDate}` : `Expires in ${alert.snapshot.daysToExpiry} days`}
                      </span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${alert.severity === "critical" ? "bg-rose-500/15 text-rose-300" : alert.severity === "warning" ? "bg-amber-500/15 text-amber-300" : "bg-sky-500/15 text-sky-300"}`}>
                      {alert.type === "LOW_STOCK" ? (alert.snapshot.available === 0 ? "Out of stock" : alert.severity === "critical" ? "Critical" : "Low stock") : alert.type === "EXPIRED" ? "Expired" : "Near expiry"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {showSales ? (
      <div className="mt-6 grid gap-5 xl:grid-cols-[1.6fr_0.8fr]">
        <Card className="border-slate-800 bg-slate-900/70">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg text-white">Sale vs. Purchase</CardTitle>
            <Badge variant="secondary" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
              +18.4% YoY
            </Badge>
          </CardHeader>
          <CardContent>
            <SalesAreaChart data={snapshot.salesTrend} />
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/70">
          <CardHeader>
            <CardTitle className="text-lg text-white">Revenue by outlet</CardTitle>
          </CardHeader>
          <CardContent>
            <OutletBarChart data={snapshot.salesByOutlet} />
          </CardContent>
        </Card>
      </div>
      ) : null}

      <div className={`mt-6 grid gap-5 ${showSales ? "xl:grid-cols-[1.15fr_1.05fr]" : ""}`}>
        {showSales ? (
        <Card className="border-slate-800 bg-slate-900/70">
          <CardHeader className="flex items-center justify-between">
            <CardTitle className="text-lg text-white">Recent Invoices</CardTitle>
            <Link href="/sales" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800">
              View All
            </Link>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800">
                  <TableHead className="text-slate-300">Date</TableHead>
                  <TableHead className="text-slate-300">Code</TableHead>
                  <TableHead className="text-slate-300">Customer</TableHead>
                  <TableHead className="text-slate-300">Grand Total</TableHead>
                  <TableHead className="text-slate-300">Balance</TableHead>
                  <TableHead className="text-slate-300">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentInvoices.map((invoice) => (
                  <TableRow key={`${invoice.code}-${invoice.date}`} className="border-slate-800">
                    <TableCell className="text-slate-200">{invoice.date}</TableCell>
                    <TableCell className="text-slate-200">{invoice.code}</TableCell>
                    <TableCell className="text-slate-200">{invoice.customer}</TableCell>
                    <TableCell className="text-slate-200">{invoice.total}</TableCell>
                    <TableCell className="text-slate-200">{invoice.balance}</TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={
                          invoice.status === "PAID"
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                            : invoice.status === "VOIDED"
                              ? "border-slate-600/40 bg-slate-700/20 text-slate-300"
                              : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                        }
                      >
                        {invoice.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        ) : null}

        <Card className="border-slate-800 bg-slate-900/70">
          <CardHeader className="flex items-center justify-between">
            <CardTitle className="text-lg text-white">Low Stock Items</CardTitle>
            <Link href="/stock" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800">
              View All
            </Link>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800">
                  <TableHead className="text-slate-300">#</TableHead>
                  <TableHead className="text-slate-300">Item</TableHead>
                  <TableHead className="text-slate-300">Brand</TableHead>
                  <TableHead className="text-slate-300">Category</TableHead>
                  <TableHead className="text-slate-300">Min</TableHead>
                  <TableHead className="text-slate-300">Stock</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lowStock.map((item, index) => (
                  <TableRow key={item.name} className="border-slate-800">
                    <TableCell className="text-slate-300">{index + 1}</TableCell>
                    <TableCell className="text-slate-200">{item.name}</TableCell>
                    <TableCell className="text-slate-200">{item.brand}</TableCell>
                    <TableCell className="text-slate-200">{item.category}</TableCell>
                    <TableCell className="text-slate-300">{item.min}</TableCell>
                    <TableCell className="text-amber-300">{item.stock}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.15fr_1.05fr]">
        <Card className="border-slate-800 bg-slate-900/70">
          <CardHeader className="flex items-center justify-between">
            <CardTitle className="text-lg text-white">Alert queue</CardTitle>
            <Link href="/stock" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800">
              Review all items
            </Link>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-amber-100">
              <p className="text-sm font-medium">Low stock</p>
              <div className="mt-2 space-y-2">
                {snapshot.lowStock.map((product) => (
                  <div key={product.id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-200">{product.name}</span>
                    <span className="font-medium text-amber-300">{product.stock} left</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-3 text-rose-100">
              <p className="text-sm font-medium">Expiry watch</p>
              <div className="mt-2 space-y-2">
                {snapshot.expiring.slice(0, 3).map((batch) => (
                  <div key={batch.id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-200">{batch.productName}</span>
                    <span className="font-medium text-rose-300">{batch.expiryDate}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/70">
          <CardHeader>
            <CardTitle className="text-lg text-white">Recent movements</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {snapshot.recentTransactions.map((movement) => (
              <div key={movement.id} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-white">{movement.productName}</p>
                  <p className="text-xs text-slate-400">{movement.reference}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-emerald-300">{movement.type}</p>
                  <p className="text-xs text-slate-500">{movement.date}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm text-slate-300">
        <div className="flex items-center gap-2 text-amber-300">
          <AlertTriangle className="h-4 w-4" />
          {snapshot.lowStock.length} products are below minimum stock threshold.
        </div>
        {showSales ? (
          <div className="flex items-center gap-2 text-emerald-300">
            <ArrowUpRight className="h-4 w-4" />
            30-day sales: ₦{snapshot.monthlySales.toLocaleString()}
          </div>
        ) : null}
      </div>
    </DashboardShell>
  );
}
