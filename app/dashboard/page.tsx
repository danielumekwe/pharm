import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeftRight,
  BadgeCheck,
  Banknote,
  Boxes,
  CalendarClock,
  CalendarX,
  ClipboardCheck,
  Clock,
  FileText,
  FileWarning,
  History,
  Hourglass,
  Landmark,
  LineChart,
  PackageCheck,
  PauseCircle,
  Percent,
  Receipt,
  RotateCcw,
  ShoppingCart,
  SlidersHorizontal,
  Store,
  Target,
  TrendingUp,
  Users,
  Wallet,
  XCircle,
} from "lucide-react";

import { DashboardShell } from "@/components/dashboard-shell";
import { DonutChart, TrendChart } from "@/components/dashboard/charts";
import { BarList, Card, CardLink, Chip, Empty, Kpi, KpiGrid, Pill, PrimaryAction, QuickActions } from "@/components/dashboard/widgets";
import { LiveSalesFeed } from "@/components/erp/live-sales-feed";
import { buildDashboard, type Dashboard } from "@/lib/erp/dashboards";
import { salesFeed } from "@/lib/erp/sales-feed";
import type { Actor } from "@/lib/erp/types";
import { compactMoney, dateTime, money, shortDate } from "@/lib/format";
import { can, ROLE_LABELS } from "@/lib/rbac";
import { onboardingStatus } from "@/lib/saas/onboarding";
import { pageData } from "@/lib/session";

type Data<K extends Dashboard["kind"]> = Extract<Dashboard, { kind: K }>["data"];
type Search = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const statusTone = (status: string) => (status === "Paid" || status === "Received" ? "green" : status === "Voided" || status === "Rejected" ? "rose" : status.includes("Pending") || status === "Partially paid" ? "amber" : "blue");

export default async function DashboardPage({ searchParams }: { searchParams: Search }) {
  return pageData("dashboard.view", "/dashboard", async (actor) => {
    const params = await searchParams;
    const trend = first(params.trend);
    const dashboard = buildDashboard(actor, {
      from: first(params.from),
      to: first(params.to),
      outlet: first(params.outlet),
      trend: trend === "weekly" || trend === "monthly" || trend === "yearly" ? trend : "daily",
    });
    const greeting = `Welcome, ${actor.name.split(" ")[0]}`;
    // Read inside the page's transaction; the views below render later and only get plain values.
    const feed = dashboard.kind === "sales" || dashboard.kind === "admin" ? salesFeed(actor) : null;
    const setup = can(actor, "settings.manage") ? await onboardingStatus(actor) : null;

    return (
      <DashboardShell>
        <div className="space-y-6" data-dashboard={dashboard.kind}>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">{ROLE_LABELS[actor.role]} dashboard</p>
              <h1 className="mt-1 text-2xl font-bold text-white">{greeting}</h1>
            </div>
            <p className="text-sm text-slate-400">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" })}</p>
          </div>
          {setup && setup.completed < setup.total ? (
            <Link href="/onboarding" data-setup-banner className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-green-200 bg-green-50 px-5 py-4 text-green-900 hover:border-green-400">
              <span><span className="font-semibold">Finish setting up your pharmacy</span> · {setup.completed} of {setup.total} steps done</span>
              <span className="text-sm font-semibold text-green-700">Open the checklist →</span>
            </Link>
          ) : null}
          {dashboard.kind === "sales" && feed ? <SalesView actor={actor} data={dashboard.data} feed={feed} /> : null}
          {dashboard.kind === "cashier" ? <CashierView data={dashboard.data} /> : null}
          {dashboard.kind === "inventory" ? <InventoryView actor={actor} data={dashboard.data} /> : null}
          {dashboard.kind === "manager" ? <ManagerView actor={actor} data={dashboard.data} /> : null}
          {dashboard.kind === "admin" && feed ? <AdminView actor={actor} data={dashboard.data} feed={feed} /> : null}
          {dashboard.kind === "regulatory" ? <RegulatoryView data={dashboard.data} /> : null}
        </div>
      </DashboardShell>
    );
  });
}

// ---------------------------------------------------------------- shared tables

function RecentSalesTable({ rows, showCashier = true }: { rows: Data<"sales">["recent"]; showCashier?: boolean }) {
  if (rows.length === 0) return <Empty>No sales yet.</Empty>;
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="text-left text-[11px] uppercase tracking-[0.12em] text-slate-500">
          <tr><th className="px-5 py-2">Receipt</th><th className="py-2">Time</th><th className="py-2">Customer</th>{showCashier ? <th className="py-2">Cashier</th> : null}<th className="py-2">Payment</th><th className="py-2 text-right">Total</th><th className="px-5 py-2 text-right">Status</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="px-5 py-2.5"><Link href={`/sales?q=${row.number}`} className="font-mono text-xs text-blue-600 hover:underline">{row.number}</Link></td>
              <td className="py-2.5 text-xs text-slate-400">{dateTime(row.date)}</td>
              <td className="py-2.5 text-slate-300">{row.customer}</td>
              {showCashier ? <td className="py-2.5 text-slate-300">{row.cashier}</td> : null}
              <td className="py-2.5 text-xs text-slate-400">{row.payment}</td>
              <td className="py-2.5 text-right font-medium tabular-nums text-white">{money(row.total)}</td>
              <td className="px-5 py-2.5 text-right"><Pill tone={statusTone(row.status)}>{row.status}</Pill></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BatchList({ rows, empty }: { rows: Data<"inventory">["position"]["expiring"]; empty: string }) {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  return (
    <ul className="divide-y divide-slate-800">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
          <div className="min-w-0">
            <Link href={`/products/${row.productId}`} className="truncate font-medium text-white hover:text-blue-600">{row.product}</Link>
            <p className="text-xs text-slate-400">Batch {row.batchNumber} · {row.outlet} · {row.quantity.toLocaleString()} units</p>
          </div>
          <Pill tone={row.days < 0 ? "rose" : row.days <= 60 ? "amber" : "slate"}>{row.days < 0 ? `Expired ${shortDate(row.expiryDate)}` : `${row.days}d · ${shortDate(row.expiryDate)}`}</Pill>
        </li>
      ))}
    </ul>
  );
}

function LowStockList({ rows }: { rows: Data<"inventory">["position"]["low"] }) {
  if (rows.length === 0) return <Empty>Nothing below its reorder level.</Empty>;
  return (
    <ul className="divide-y divide-slate-800">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
          <div className="min-w-0">
            <Link href={`/products/${row.id}`} className="truncate font-medium text-white hover:text-blue-600">{row.name}</Link>
            <p className="text-xs text-slate-400">{row.outlet} · reorder at {row.minStock.toLocaleString()}</p>
          </div>
          <span className={`tabular-nums font-semibold ${row.stock === 0 ? "text-rose-300" : "text-amber-300"}`}>{row.stock.toLocaleString()} {row.unit}</span>
        </li>
      ))}
    </ul>
  );
}

function TransferList({ data }: { data: Data<"inventory">["transfers"] }) {
  if (data.rows.length === 0) return <Empty>No transfers in progress.</Empty>;
  return (
    <ul className="divide-y divide-slate-800">
      {data.rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
          <div className="min-w-0">
            <Link href={`/transfers?id=${row.id}`} className="font-mono text-xs text-blue-600 hover:underline">{row.reference}</Link>
            <p className="truncate text-xs text-slate-400">{row.from} → {row.to} · {row.items} item(s){row.incoming ? " · incoming" : ""}</p>
          </div>
          <Pill tone={row.status === "Dispatched" ? "blue" : "amber"}>{row.status}</Pill>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- Sales manager

type Feed = ReturnType<typeof salesFeed>;

function SalesView({ actor, data, feed }: { actor: Actor; data: Data<"sales">; feed: Feed }) {
  const today = data.today;
  return (
    <>
      <PrimaryAction
        href="/pos"
        icon={ShoppingCart}
        title="NEW SALE"
        text="Open the pharmacy POS terminal to start a new customer transaction."
        meta={<><Chip>{data.outlet}</Chip>{data.held ? <Chip>{data.held} held transaction(s)</Chip> : null}</>}
      />
      <KpiGrid>
        <Kpi label="Today's sales (net)" value={money(today?.net ?? 0)} note={`Gross ${money(today?.gross ?? 0)} · discounts ${money(today?.discounts ?? 0)}`} icon={Banknote} />
        <Kpi label="Transactions today" value={String(today?.transactions ?? 0)} note={`Average basket ${money(today?.avgBasket ?? 0)}${today?.voided ? ` · ${today.voided} voided` : ""}`} icon={Receipt} tone="green" />
        <Kpi label="Held / pending" value={String(data.held)} note="Parked baskets waiting at the till" icon={PauseCircle} tone="amber" href="/pos?held=1" />
        {data.target ? (
          <Kpi label="Daily target" value={`${data.target.pct}%`} note={<span className="block"><span className="mb-1 block h-1.5 overflow-hidden rounded-full bg-slate-800"><span className="block h-full rounded-full bg-blue-500" style={{ width: `${data.target.pct}%` }} /></span>{money(data.target.achieved)} of {money(data.target.amount)}</span>} icon={Target} tone="blue" />
        ) : (
          <Kpi label="Returns today" value={money(today?.returns ?? 0)} note={`${today?.returnsCount ?? 0} return(s)`} icon={RotateCcw} tone="rose" />
        )}
      </KpiGrid>
      <QuickActions
        actions={[
          { href: "/sales", label: "Sales history", icon: History },
          { href: "/pos?held=1", label: "Held transactions", icon: PauseCircle },
          { href: "/contacts", label: "Customer records", icon: Users },
          { href: "/stock-levels", label: "Stock levels", icon: Boxes },
          { href: "/sales-overview", label: "Daily sales report", icon: LineChart },
          ...(can(actor, "reports.sales") && !can(actor, "stock.levels") ? [{ href: "/reports", label: "Sales reports", icon: FileText }] : []),
        ]}
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Sales performance" description="Net sales, last 14 days" className="xl:col-span-2"><TrendChart data={data.trend} /></Card>
        <Card title="Daily sales summary" description="Today, after discounts and returns">
          <dl className="space-y-2 text-sm">
            {[
              ["Gross sales", today?.gross ?? 0],
              ["Discounts", -(today?.discounts ?? 0)],
              ["Returns", -(today?.returns ?? 0)],
              ["Net sales", today?.net ?? 0],
              ["VAT", today?.vat ?? 0],
              ["Cash collected", today?.payments.netCash ?? 0],
              ["POS terminal", today?.payments.netPos ?? 0],
              ["Bank transfer", today?.payments.netTransfer ?? 0],
            ].map(([label, value]) => (
              <div key={label as string} className={`flex justify-between ${label === "Net sales" ? "border-t border-slate-800 pt-2 font-semibold text-white" : "text-slate-300"}`}>
                <dt>{label}</dt>
                <dd className="tabular-nums">{money(value as number)}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Sales by cashier" description="Today, net"><BarList rows={data.byCashier.map((row) => ({ name: row.name, value: row.value, note: `${row.transactions} sale(s)` }))} empty="No sales today yet." /></Card>
        <Card title="Top-selling products" description="Last 30 days, by revenue"><BarList rows={data.topProducts.map((row) => ({ name: row.name, value: row.revenue, note: `${row.units.toLocaleString()} units` }))} /></Card>
        <Card title="Payment methods" description={data.paymentMixPeriod}><DonutChart data={data.paymentMix} /></Card>
      </div>
      <Card title="Recent sales" action={<CardLink href="/sales">Sales history</CardLink>}><RecentSalesTable rows={data.recent} /></Card>
      <LiveSalesFeed initial={feed} />
    </>
  );
}

// ---------------------------------------------------------------- Cashier

function CashierView({ data }: { data: Data<"cashier"> }) {
  return (
    <>
      <PrimaryAction
        href="/pos"
        icon={ShoppingCart}
        title="NEW SALE"
        text="Open the pharmacy POS terminal to start a new customer transaction."
        meta={<>{data.outlet ? <Chip>{data.outlet}</Chip> : null}{data.held.length ? <Chip>{data.held.length} held</Chip> : null}</>}
      />
      <KpiGrid>
        <Kpi label="My transactions today" value={String(data.todayCount)} note={data.voided ? `${data.voided} voided` : "Completed sales"} icon={Receipt} />
        <Kpi label="My sales today" value={money(data.todayTotal)} note={`Average basket ${money(data.avgBasket)}`} icon={Banknote} tone="green" />
        <Kpi label="Held transactions" value={String(data.held.length)} note="Resume them from the POS" icon={PauseCircle} tone="amber" href="/pos?held=1" />
        <Kpi label="Last sale" value={data.lastSale ? dateTime(data.lastSale).split(",").pop()?.trim() ?? "—" : "—"} note={data.firstSale ? `First sale ${dateTime(data.firstSale).split(",").pop()?.trim()} · ${data.returns} return(s)` : "No sales yet today"} icon={Clock} tone="slate" />
      </KpiGrid>
      <QuickActions
        actions={[
          { href: "/sales", label: "My sales history", icon: History },
          { href: "/pos?held=1", label: "Held transactions", icon: PauseCircle },
          { href: "/stock-levels", label: "Stock levels", icon: Boxes },
          { href: "/contacts", label: "Customers", icon: Users },
        ]}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="My recent sales" className="lg:col-span-2" action={<CardLink href="/sales">My sales history</CardLink>}><RecentSalesTable rows={data.recent} showCashier={false} /></Card>
        <div className="space-y-6">
          <Card title="Held transactions">
            {data.held.length === 0 ? (
              <Empty>No held baskets.</Empty>
            ) : (
              <ul className="divide-y divide-slate-800 text-sm">
                {data.held.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-2 py-2">
                    <span><span className="font-mono text-xs text-white">{row.reference}</span> <span className="text-xs text-slate-400">{row.label ?? `${row.lines} line(s)`}</span></span>
                    <Link href={`/pos?resume=${row.id}`} className="text-xs font-medium text-blue-600 hover:underline">Resume</Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="How I was paid today"><DonutChart data={data.paymentMix} /></Card>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Inventory manager

function InventoryView({ actor, data }: { actor: Actor; data: Data<"inventory"> }) {
  const p = data.position;
  return (
    <>
      <PrimaryAction
        href="/inventory?receive=1"
        icon={PackageCheck}
        title="RECEIVE STOCK"
        text="Record a delivery: scan items, enter batch and expiry, and post it to this outlet's stock."
        meta={<>{data.receiving.count ? <Chip>{data.receiving.count} purchase order(s) awaiting delivery</Chip> : null}{data.transfers.rows.some((row) => row.incoming && row.status === "Dispatched") ? <Chip>Incoming transfer to confirm</Chip> : null}</>}
      />
      <KpiGrid>
        <Kpi label="Inventory value (cost)" value={compactMoney(p.valueAtCost)} note={`${p.products} products · ${p.units.toLocaleString()} units · retail ${compactMoney(p.valueAtRetail)}`} icon={Boxes} href="/products" />
        <Kpi label="Low stock" value={String(p.lowCount)} note="At or below reorder level" icon={AlertTriangle} tone="amber" href="/alerts" />
        <Kpi label="Expiring batches" value={String(p.expiringCount)} note={`Within ${p.nearExpiryDays} days`} icon={CalendarClock} tone="amber" href="/alerts?tab=near" />
        <Kpi label="Expired stock" value={String(p.expiredCount)} note={`${money(p.expiredValue)} at cost, blocked from sale`} icon={CalendarX} tone="rose" href="/alerts?tab=expired" />
      </KpiGrid>
      <QuickActions
        actions={[
          { href: "/inventory?receive=1", label: "Receive stock", icon: PackageCheck },
          { href: "/products", label: "View inventory", icon: Boxes },
          { href: "/transfers?new=1", label: "Create transfer", icon: ArrowLeftRight },
          { href: "/stock?adjust=1", label: "Stock adjustment", icon: SlidersHorizontal },
          { href: "/alerts?tab=near", label: "Expiry report", icon: CalendarClock },
        ]}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Low-stock products" action={<CardLink href="/alerts">Alerts</CardLink>}><LowStockList rows={p.low} /></Card>
        <Card title="Expiring batches" description={`First-expiry-first-out · next ${p.nearExpiryDays} days`}><BatchList rows={p.expiring} empty="Nothing expiring soon." /></Card>
        <Card title="Expired stock" description="Quarantine, return or dispose"><BatchList rows={p.expired} empty="No expired stock on hand." /></Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Stock transfers" description={`${data.transfers.count} in progress`} action={<CardLink href="/transfers">Transfers</CardLink>}><TransferList data={data.transfers} /></Card>
        <Card title="Pending receiving" description="Approved purchase orders" action={<CardLink href="/inventory">Receiving</CardLink>}>
          {data.receiving.rows.length === 0 ? <Empty>No deliveries expected.</Empty> : (
            <ul className="divide-y divide-slate-800 text-sm">
              {data.receiving.rows.map((row) => (
                <li key={row.id} className="py-2.5"><p className="font-medium text-white">{row.number} · {row.supplier}</p><p className="text-xs text-slate-400">{row.outstanding.toLocaleString()} unit(s) outstanding · expected {shortDate(row.expected)}</p></li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Adjustment requests" description="Awaiting a second person's approval" action={<CardLink href="/stock?tab=movements">Approvals</CardLink>}>
          {data.adjustments.rows.length === 0 ? <Empty>No pending requests.</Empty> : (
            <ul className="divide-y divide-slate-800 text-sm">
              {data.adjustments.rows.map((row) => (
                <li key={row.id} className="py-2.5"><p className="font-medium text-white">{row.type} · {row.product}</p><p className="text-xs text-slate-400">{row.reference} · {row.quantity} unit(s) · by {row.requestedBy}</p></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card title="Recent stock movements" description="From the stock ledger" action={can(actor, "stock.view") ? <CardLink href="/stock">Stock ledger</CardLink> : null}>
        {data.movements.length === 0 ? <Empty>No movements yet.</Empty> : (
          <ul className="divide-y divide-slate-800 text-sm">
            {data.movements.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0"><span className="text-white">{row.product}</span> <span className="text-xs text-slate-400">· {row.type} · {row.reference} · {dateTime(row.at)}</span></span>
                <span className={`tabular-nums font-medium ${row.quantity < 0 ? "text-rose-300" : "text-emerald-300"}`}>{row.quantity > 0 ? "+" : ""}{row.quantity.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- Pharmacy manager

function ManagerView({ actor, data }: { actor: Actor; data: Data<"manager"> }) {
  const today = data.today;
  const p = data.position;
  return (
    <>
      <KpiGrid>
        <Kpi label="Consolidated sales today" value={money(today?.net ?? 0)} note={`${today?.transactions ?? 0} transactions · gross ${money(today?.gross ?? 0)}`} icon={Banknote} href="/sales-overview" />
        <Kpi label="Inventory value (cost)" value={compactMoney(p.valueAtCost)} note={`${p.products} products across outlets`} icon={Boxes} tone="green" href="/products" />
        <Kpi label="Low-stock alerts" value={String(p.lowCount)} note={`${p.expiringCount} batch(es) expiring · ${p.expiredCount} expired`} icon={AlertTriangle} tone="amber" href="/alerts" />
        <Kpi label="Pending transfers" value={String(data.transfers.count)} note="Awaiting approval, dispatch or receipt" icon={ArrowLeftRight} tone="slate" href="/transfers" />
      </KpiGrid>
      <QuickActions
        actions={[
          { href: "/sales-overview", label: "Sales overview", icon: LineChart },
          { href: "/transfers", label: "Approve transfers", icon: ArrowLeftRight },
          { href: "/stock?tab=movements", label: "Stock approvals", icon: ClipboardCheck },
          { href: "/alerts", label: "Stock alerts", icon: AlertTriangle },
          ...(can(actor, "sales.create") ? [{ href: "/pos", label: "Open POS", icon: ShoppingCart }] : [{ href: "/reports", label: "Reports", icon: FileText }]),
        ]}
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Sales performance" description="Net sales, last 30 days" className="xl:col-span-2"><TrendChart data={data.trend} /></Card>
        <Card title="Sales by outlet" description="Today, net"><BarList rows={data.byOutletToday.map((row) => ({ name: row.name, value: row.value, note: `${row.transactions} sales` }))} empty="No sales today yet." /></Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Outlet performance" description="Last 30 days"><BarList rows={data.outletPerformance.map((row) => ({ name: row.name, value: row.value, note: `avg ${money(row.avgBasket)}` }))} /></Card>
        <Card title="Cashier performance" description="Last 30 days, net"><BarList rows={data.byCashier} /></Card>
        <Card title="Financial overview">
          <dl className="space-y-2 text-sm">
            {[
              ["Net sales (30 days)", data.finance.net30],
              ["Expenses (30 days)", data.finance.expenses30],
              ["Cash collected today", data.finance.cashToday],
              ["Customer receivables", data.finance.receivable],
              ["Supplier payables", data.finance.payable],
            ].map(([label, value]) => (
              <div key={label as string} className="flex justify-between text-slate-300"><dt>{label}</dt><dd className="tabular-nums text-white">{money(value as number)}</dd></div>
            ))}
          </dl>
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Low stock" action={<CardLink href="/alerts">Alerts</CardLink>}><LowStockList rows={p.low} /></Card>
        <Card title="Expiring stock"><BatchList rows={p.expiring} empty="Nothing expiring soon." /></Card>
        <Card title="Transfers in progress" action={<CardLink href="/transfers">Transfers</CardLink>}><TransferList data={data.transfers} /></Card>
      </div>
      <Card title="Recent transactions" action={<CardLink href="/sales">Sales history</CardLink>}><RecentSalesTable rows={data.recent} /></Card>
    </>
  );
}

// ---------------------------------------------------------------- Super Admin

function AdminView({ actor, data, feed }: { actor: Actor; data: Data<"admin">; feed: Feed }) {
  const t = data.totals;
  const p = data.position;
  const scopeLabel = data.filters.outlet === "all" ? "All outlets" : data.outlets.find((row) => row.id === data.filters.outlet)?.name ?? data.filters.outlet;
  return (
    <>
      <form className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-sm" method="get">
        <label className="grid gap-1 text-xs text-slate-400">From<input type="date" name="from" defaultValue={data.filters.from} className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-white" /></label>
        <label className="grid gap-1 text-xs text-slate-400">To<input type="date" name="to" defaultValue={data.filters.to} className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-white" /></label>
        <label className="grid gap-1 text-xs text-slate-400">Outlet
          <select name="outlet" defaultValue={data.filters.outlet} className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-white">
            <option value="all">All outlets</option>
            {data.outlets.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-slate-400">Trend
          <select name="trend" defaultValue={data.filters.trend} className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-white">
            <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option>
          </select>
        </label>
        <button type="submit" className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-medium text-[#fff] hover:bg-blue-700">Apply</button>
        <Link href="/dashboard" className="h-9 rounded-lg border border-slate-700 px-3 text-sm leading-9 text-slate-300 hover:bg-slate-800">Today</Link>
        <p className="ml-auto text-xs text-slate-400">{scopeLabel} · {shortDate(data.filters.from)}{data.filters.to !== data.filters.from ? ` – ${shortDate(data.filters.to)}` : ""}</p>
      </form>
      <KpiGrid>
        <Kpi label="Net sales" value={money(t.net)} note={`Gross ${money(t.gross)} − discounts ${money(t.discounts)} − returns ${money(t.returns)}`} icon={Banknote} href="/sales-overview" />
        <Kpi label="Transactions" value={t.transactions.toLocaleString()} note={`Average basket ${money(t.avgBasket)} · ${t.voided} voided (excluded)`} icon={Receipt} tone="green" />
        <Kpi label="Discounts" value={money(t.discounts)} note={t.gross ? `${((t.discounts / t.gross) * 100).toFixed(1)}% of gross` : "—"} icon={Percent} tone="amber" />
        <Kpi label="Returns & refunds" value={money(t.returns)} note={`${t.returnsCount} return(s) · refunded ${money(t.refunded)}`} icon={RotateCcw} tone="rose" />
      </KpiGrid>
      <KpiGrid>
        <Kpi label="Products" value={p.products.toLocaleString()} note={`${p.records} item-outlet records`} icon={Boxes} tone="slate" href="/products" />
        <Kpi label="Inventory value (cost)" value={compactMoney(p.valueAtCost)} note={`Retail ${compactMoney(p.valueAtRetail)}`} icon={Wallet} tone="blue" />
        <Kpi label="Low stock / near expiry" value={`${p.lowCount} / ${p.expiringCount}`} note={`Near expiry = within ${p.nearExpiryDays} days`} icon={AlertTriangle} tone="amber" href="/alerts" />
        <Kpi label="Expired stock · transfers" value={`${p.expiredCount} · ${data.transfers.count}`} note={`${money(p.expiredValue)} expired at cost · transfers in progress`} icon={Hourglass} tone="rose" href="/transfers" />
      </KpiGrid>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Sales trend" description={`Net sales, ${data.filters.trend}`} className="xl:col-span-2" action={<CardLink href="/sales-overview">Full report</CardLink>}><TrendChart data={data.trend} /></Card>
        <Card title="Sales by outlet" description="Net, selected period"><BarList rows={data.byOutlet.map((row) => ({ name: row.name, value: row.value, note: `${row.transactions} sales` }))} /></Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Sales by cashier"><BarList rows={data.byCashier} /></Card>
        <Card title="Top-selling products"><BarList rows={data.topProducts.map((row) => ({ name: row.name, value: row.revenue, note: `${row.units.toLocaleString()} units` }))} /></Card>
        <Card title="Payment methods"><DonutChart data={data.paymentMix} /></Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Inventory by outlet" description="Value at cost"><BarList rows={p.byOutlet} format={compactMoney} /></Card>
        <Card title="Low stock" action={<CardLink href="/alerts">Alerts</CardLink>}><LowStockList rows={p.low} /></Card>
        <Card title="Staff activity" description="Last 24 hours" action={can(actor, "audit.view") ? <CardLink href="/audit">Audit log</CardLink> : null}>
          {data.staff.length === 0 ? <Empty>No activity.</Empty> : (
            <ul className="divide-y divide-slate-800 text-sm">
              {data.staff.map((row) => (
                <li key={row.name} className="flex items-center justify-between py-2"><span className="text-white">{row.name} <span className="text-xs text-slate-400">· {row.role.replace("_", " ").toLowerCase()}</span></span><span className="text-xs text-slate-400">{row.actions} action(s)</span></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Near-expiry batches"><BatchList rows={p.expiring} empty="Nothing expiring soon." /></Card>
        <Card title="Pending transfers" action={<CardLink href="/transfers">Transfers</CardLink>}><TransferList data={data.transfers} /></Card>
      </div>
      <LiveSalesFeed initial={feed} />
    </>
  );
}

// ---------------------------------------------------------------- Regulatory officer

function RegulatoryView({ data }: { data: Data<"regulatory"> }) {
  return (
    <>
      <PrimaryAction href="/regulatory?tab=products" icon={Landmark} title="REGULATORY RECORDS" text="Review NAFDAC registrations, renewals due and supporting documents." meta={<>{data.renewalsDue ? <Chip>{data.renewalsDue} renewal(s) due</Chip> : null}{data.expired ? <Chip>{data.expired} expired</Chip> : null}</>} />
      <KpiGrid>
        <Kpi label="Registered products" value={`${data.registered} / ${data.total}`} note="Approved and current" icon={BadgeCheck} tone="green" href="/regulatory?tab=products" />
        <Kpi label="Pending & under review" value={`${data.pending} · ${data.underReview}`} note="Awaiting NAFDAC or internal review" icon={Hourglass} tone="amber" />
        <Kpi label="Renewals due" value={String(data.renewalsDue)} note="Within the 180-day renewal window" icon={CalendarClock} tone="amber" />
        <Kpi label="Expired / rejected" value={`${data.expired} · ${data.rejected}`} note="Products must not be sold while expired" icon={XCircle} tone="rose" />
      </KpiGrid>
      <QuickActions
        actions={[
          { href: "/regulatory?tab=products", label: "NAFDAC records", icon: BadgeCheck },
          { href: "/regulatory?tab=documents", label: "Documents", icon: FileText },
          { href: "/regulatory?tab=licences", label: "Premises licences", icon: Store },
          { href: "/alerts?tab=expired", label: "Expiry & recalls", icon: FileWarning },
          { href: "/audit", label: "Compliance audit", icon: TrendingUp },
        ]}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Products awaiting regulatory action" className="lg:col-span-2" action={<CardLink href="/regulatory?tab=products">Register</CardLink>}>
          {data.attention.length === 0 ? <Empty>Every registration is current.</Empty> : (
            <ul className="divide-y divide-slate-800 text-sm">
              {data.attention.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0"><p className="truncate font-medium text-white">{row.name}</p><p className="text-xs text-slate-400">NAFDAC {row.nafdac}{row.expiryDate ? ` · expires ${shortDate(row.expiryDate)}` : ""}</p></div>
                  <Pill tone={row.state === "Expired" || row.status === "Rejected" ? "rose" : row.state === "Renewal due" ? "amber" : "slate"}>{row.state === "Valid" ? row.status : row.state}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Regulatory documents" description={`${data.documents.total} on file · ${data.documents.expiringSoon} expiring within 90 days`} action={<CardLink href="/regulatory?tab=documents">All</CardLink>}>
          {data.documents.recent.length === 0 ? <Empty>No documents uploaded yet.</Empty> : (
            <ul className="divide-y divide-slate-800 text-sm">
              {data.documents.recent.map((row) => (
                <li key={row.id} className="py-2"><p className="text-white">{row.title}</p><p className="text-xs text-slate-400">{row.category} · {shortDate(row.uploadedAt)}</p></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card title="Upcoming renewal calendar" description="Registration expiries and renewal dates, next 12 months">
        {data.calendar.length === 0 ? <Empty>Nothing due in the next 12 months.</Empty> : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.calendar.map((month) => (
              <div key={month.month} className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                <p className="text-sm font-semibold text-white">{new Date(`${month.month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</p>
                <ul className="mt-2 space-y-1 text-xs">
                  {month.items.map((item) => <li key={`${item.id}-${item.kind}`} className="text-slate-300">{shortDate(item.date)} · {item.name} <span className="text-slate-500">({item.kind.toLowerCase()})</span></li>)}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
