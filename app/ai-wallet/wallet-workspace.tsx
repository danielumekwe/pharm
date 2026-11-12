"use client";

import { ArrowDownCircle, Coins, CreditCard, History, Lock, Receipt, ScanText, Sparkles, Tag } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { DailyBars } from "@/components/charts/daily-bars";
import { ActionButton, Field, FormError, SelectInput, TextInput } from "@/components/erp/fields";
import { PageHeader } from "@/components/erp/page-header";
import { StatGrid } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";

type Overview = {
  wallet: { available: number; reserved: number; purchasedTotal: number; freeTotal: number; consumedTotal: number; refundedTotal: number; status: string; createdAt: string; lastTransactionAt: string | null };
  prices: { code: string; name: string; description: string; method: string; coins: number; override: boolean }[];
  scanPrices: Record<string, number>;
  packages: { id: string; name: string; description: string; coins: number; bonusCoins: number; totalCoins: number; price: number; currency: string; promoEndsAt: string | null }[];
  purchases: { reference: string; packageName: string; coins: number; amount: number; currency: string; status: string; failureReason: string | null; by: string; createdAt: string | null; creditedAt: string | null }[];
  permissions: { view: boolean; usage: boolean; purchase: boolean; manage: boolean };
};
type Transactions = { page: number; pageSize: number; total: number; types: { value: string; label: string }[]; rows: { id: string; reference: string; type: string; typeLabel: string; description: string; credited: number; debited: number; amount: number; direction: string; balanceAfter: number; reservedAfter: number; operation: string | null; related: { type: string; id: string } | null; by: string; status: string; at: string | null }[] };
type Usage = { from: string; to: string; byStaff: { name: string; pages: number; failed: number; coins: number }[]; byJob: { jobId: string | null; reference: string; pages: number; failed: number; coins: number; last: string | null }[]; byOperation: { code: string; requests: number; coins: number }[]; daily: { day: string; coins: number; pages: number }[] };

const n = (value: number) => value.toLocaleString("en-NG");
const naira = (value: number, currency = "NGN") => new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
const when = (value: string | null) => (value ? new Date(value).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }) : "—");
const METHOD: Record<string, string> = { FIXED: "per operation", PER_PAGE: "per page", PER_DOCUMENT: "per document", PER_1K_TOKENS: "per 1,000 tokens" };
const PURCHASE_TONE: Record<string, "emerald" | "amber" | "rose" | "slate" | "sky"> = { SUCCESS: "emerald", PENDING: "sky", FAILED: "rose", ABANDONED: "slate", REFUNDED: "amber" };

async function getJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url, { cache: "no-store" });
  return response.ok ? ((await response.json()) as T) : null;
}

export function WalletWorkspace({ initial, initialTab, purchased }: { initial: Overview; initialTab: string; purchased: boolean }) {
  const tabs = [
    { key: "overview", label: "Overview", show: true },
    { key: "buy", label: "Buy coins", show: initial.permissions.purchase || initial.permissions.manage },
    { key: "transactions", label: "Transaction history", show: initial.permissions.view || initial.permissions.manage },
    { key: "usage", label: "AI usage", show: initial.permissions.usage || initial.permissions.manage },
    { key: "pricing", label: "Pricing", show: true },
  ].filter((entry) => entry.show);
  const [tab, setTab] = useState(tabs.some((entry) => entry.key === initialTab) ? initialTab : "overview");
  const go = (key: string) => {
    setTab(key);
    window.history.replaceState(null, "", key === "overview" ? "/ai-wallet" : `/ai-wallet?tab=${key}`);
  };
  const w = initial.wallet;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="AI services"
        title="AI Wallet"
        description="Your pharmacy's shared AI coins. Coins pay for AI features such as reading paper records with the AI Document Scanner; checking and correcting records is free."
        actions={
          initial.permissions.purchase ? (
            <ActionButton onClick={() => go("buy")}>
              <CreditCard className="h-4 w-4" /> Buy coins
            </ActionButton>
          ) : null
        }
      />
      {purchased ? <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">Payment confirmed. Your coins have been added.</p> : null}
      {w.status !== "ACTIVE" ? <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">This wallet is suspended by Web365. Contact support.</p> : null}

      <StatGrid
        stats={[
          { label: "Available coins", value: n(w.available), note: `≈ ${Math.floor(w.available / Math.max(1, initial.scanPrices.standard || 100))} standard page(s)`, icon: Coins, tone: "emerald" },
          { label: "Reserved coins", value: n(w.reserved), note: "Held for pages being read", icon: Lock, tone: "sky" },
          { label: "Coins purchased", value: n(w.purchasedTotal), note: `Free coins received: ${n(w.freeTotal)}`, icon: Receipt, tone: "slate" },
          { label: "Coins used", value: n(w.consumedTotal), note: w.lastTransactionAt ? `Last activity ${when(w.lastTransactionAt)}` : "No activity yet", icon: ScanText, tone: "amber" },
        ]}
      />

      <nav className="flex gap-1 overflow-x-auto border-b border-slate-800" aria-label="AI Wallet sections">
        {tabs.map((entry) => (
          <button key={entry.key} type="button" onClick={() => go(entry.key)} aria-current={tab === entry.key ? "page" : undefined} className={`shrink-0 border-b-2 px-3 py-2 text-sm ${tab === entry.key ? "border-blue-500 text-white" : "border-transparent text-slate-400 hover:text-white"}`}>
            {entry.label}
          </button>
        ))}
      </nav>

      {tab === "overview" ? <OverviewTab overview={initial} go={go} /> : null}
      {tab === "buy" ? <BuyTab overview={initial} /> : null}
      {tab === "transactions" ? <TransactionsTab /> : null}
      {tab === "usage" ? <UsageTab /> : null}
      {tab === "pricing" ? <PricingTab overview={initial} /> : null}
    </div>
  );
}

function OverviewTab({ overview, go }: { overview: Overview; go: (tab: string) => void }) {
  const actions = [
    { key: "buy", label: "Buy Coins", text: "Pay with Paystack; coins arrive once the payment is confirmed.", icon: CreditCard, show: overview.permissions.purchase },
    { key: "transactions", label: "View Transaction History", text: "Every coin added, reserved, used or returned.", icon: History, show: overview.permissions.view || overview.permissions.manage },
    { key: "usage", label: "View AI Usage", text: "Pages read and coins used by each staff member and job.", icon: ScanText, show: overview.permissions.usage || overview.permissions.manage },
    { key: "pricing", label: "View Pricing", text: "What each AI operation costs in coins.", icon: Tag, show: true },
  ].filter((action) => action.show);
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {actions.map(({ key, label, text, icon: Icon }) => (
          <button key={key} type="button" onClick={() => go(key)} className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-left transition hover:border-blue-500/50">
            <Icon className="mt-0.5 h-5 w-5 shrink-0 text-blue-300" />
            <span>
              <span className="block font-medium text-white">{label}</span>
              <span className="mt-1 block text-sm text-slate-400">{text}</span>
            </span>
          </button>
        ))}
      </div>
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <h4 className="font-semibold text-white">How coins are used</h4>
        <ul className="mt-2 space-y-1.5 text-sm text-slate-300">
          <li>• Before AI reads your pages, the scanner shows the cost and holds enough coins (a reservation).</li>
          <li>• Each page is charged once it has been read: {overview.scanPrices.standard} coins for the first page of a job, {overview.scanPrices.additional} for each further page, {overview.scanPrices.handwritten} for a mostly handwritten page.</li>
          <li>• Pages that cannot be read cost nothing, and unused held coins return to your balance straight away.</li>
          <li>• Checking, correcting and importing records is always free.</li>
        </ul>
        <Link href="/data-migration" className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-blue-400 hover:underline">
          <ScanText className="h-4 w-4" /> Open the AI Document Scanner
        </Link>
      </section>
    </div>
  );
}

function BuyTab({ overview }: { overview: Overview }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!overview.permissions.purchase) return <p className="text-sm text-slate-400">Your role cannot buy coins. Ask your Pharmacy Super Admin.</p>;
  const buy = async (packageId: string) => {
    setBusy(packageId);
    setError(null);
    const response = await fetch("/api/ai-wallet/purchases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packageId }) });
    const data = (await response.json().catch(() => ({}))) as { checkoutUrl?: string; error?: string };
    if (response.ok && data.checkoutUrl) {
      window.location.assign(data.checkoutUrl);
      return;
    }
    setError(data.error ?? "The payment could not be started.");
    setBusy(null);
  };
  return (
    <div className="space-y-5">
      <FormError message={error} />
      {overview.packages.length === 0 ? (
        <p className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 text-center text-sm text-slate-400">No coin packages are on sale yet. Contact Web365 to buy coins.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {overview.packages.map((pack) => (
            <div key={pack.id} className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-400">{pack.name}</p>
              <p className="mt-3 text-3xl font-bold text-white">{n(pack.totalCoins)}</p>
              <p className="text-sm text-slate-400">coins{pack.bonusCoins ? ` (${n(pack.coins)} + ${n(pack.bonusCoins)} bonus)` : ""}</p>
              {pack.description ? <p className="mt-2 text-sm text-slate-400">{pack.description}</p> : null}
              {pack.bonusCoins && pack.promoEndsAt ? <p className="mt-2 flex items-center gap-1 text-xs text-amber-300"><Sparkles className="h-3.5 w-3.5" /> Bonus until {new Date(pack.promoEndsAt).toLocaleDateString("en-GB")}</p> : null}
              <p className="mt-4 text-xl font-semibold text-white">{naira(pack.price, pack.currency)}</p>
              <ActionButton className="mt-4" disabled={busy !== null} onClick={() => buy(pack.id)}>
                {busy === pack.id ? "Opening Paystack…" : "Buy with Paystack"}
              </ActionButton>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-500">You pay on Paystack&apos;s secure page. Coins are added only after Paystack confirms the payment to PharmaERP; you will get an in-app message and an email receipt.</p>
      {overview.purchases.length ? (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <h4 className="font-semibold text-white">Your coin purchases</h4>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs uppercase tracking-[0.14em] text-slate-500">
                <tr><th className="py-2">Date</th><th>Package</th><th className="text-right">Coins</th><th className="text-right">Amount</th><th>Status</th><th>By</th><th>Reference</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {overview.purchases.map((row) => (
                  <tr key={row.reference}>
                    <td className="py-2">{when(row.createdAt)}</td>
                    <td>{row.packageName}</td>
                    <td className="text-right">{n(row.coins)}</td>
                    <td className="text-right">{naira(row.amount, row.currency)}</td>
                    <td><StatusBadge status={row.status.charAt(0) + row.status.slice(1).toLowerCase()} tone={PURCHASE_TONE[row.status]} />{row.failureReason && row.status !== "SUCCESS" ? <p className="mt-0.5 text-[11px] text-slate-500">{row.failureReason}</p> : null}</td>
                    <td>{row.by}</td>
                    <td className="font-mono text-xs text-slate-500">{row.reference}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function TransactionsTab() {
  const [filters, setFilters] = useState({ type: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Transactions | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "25", ...(filters.type ? { type: filters.type } : {}), ...(filters.from ? { from: filters.from } : {}), ...(filters.to ? { to: filters.to } : {}) });
    setData(await getJson<Transactions>(`/api/ai-wallet/transactions?${params}`));
    setLoading(false);
  }, [filters, page]);
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Type">
          <SelectInput value={filters.type} onChange={(event) => { setPage(1); setFilters({ ...filters, type: event.target.value }); }} options={[{ value: "", label: "All types" }, ...(data?.types ?? [])]} />
        </Field>
        <Field label="From">
          <TextInput type="date" value={filters.from} onChange={(event) => { setPage(1); setFilters({ ...filters, from: event.target.value }); }} />
        </Field>
        <Field label="To">
          <TextInput type="date" value={filters.to} onChange={(event) => { setPage(1); setFilters({ ...filters, to: event.target.value }); }} />
        </Field>
        <div className="flex items-end">
          <ActionButton tone="ghost" onClick={() => { setPage(1); setFilters({ type: "", from: "", to: "" }); }}>Clear filters</ActionButton>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="text-left text-xs uppercase tracking-[0.14em] text-slate-500">
            <tr><th className="py-2">Date &amp; time</th><th>Reference</th><th>Description</th><th>Type</th><th className="text-right">Credited</th><th className="text-right">Debited</th><th className="text-right">Balance</th><th>AI operation</th><th>Staff</th><th>Status</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-slate-300">
            {data?.rows.map((row) => (
              <tr key={row.id}>
                <td className="py-2 whitespace-nowrap">{when(row.at)}</td>
                <td className="font-mono text-xs text-slate-500">{row.reference}</td>
                <td className="max-w-[280px]">{row.description}</td>
                <td className="whitespace-nowrap">{row.typeLabel}</td>
                <td className="text-right text-emerald-300">{row.credited ? `+${n(row.credited)}` : ""}</td>
                <td className="text-right text-rose-300">{row.debited ? `−${n(row.debited)}` : ""}</td>
                <td className="text-right font-medium text-white">{n(row.balanceAfter)}{row.reservedAfter ? <span className="block text-[11px] font-normal text-slate-500">{n(row.reservedAfter)} held</span> : null}</td>
                <td className="text-xs text-slate-400">{row.operation ?? (row.related ? row.related.type : "—")}</td>
                <td className="whitespace-nowrap">{row.by}</td>
                <td><StatusBadge status={row.status} tone="emerald" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && data && data.rows.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">No transactions match these filters.</p> : null}
        {loading ? <p className="py-6 text-center text-sm text-slate-400">Loading…</p> : null}
      </div>
      <div className="flex items-center justify-between text-sm text-slate-400">
        <span>{data ? `${n(data.total)} transaction(s)` : ""}</span>
        <div className="flex items-center gap-2">
          <ActionButton tone="secondary" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Previous</ActionButton>
          <span>Page {page} of {pages}</span>
          <ActionButton tone="secondary" disabled={page >= pages || loading} onClick={() => setPage(page + 1)}>Next</ActionButton>
        </div>
      </div>
    </section>
  );
}

function UsageTab() {
  const [range, setRange] = useState({ from: "", to: "" });
  const [data, setData] = useState<Usage | null>(null);
  useEffect(() => {
    const params = new URLSearchParams({ ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}) });
    queueMicrotask(() => void getJson<Usage>(`/api/ai-wallet/usage?${params}`).then(setData));
  }, [range]);
  if (!data) return <p className="text-sm text-slate-400">Loading…</p>;
  const total = data.byStaff.reduce((sum, row) => sum + row.coins, 0);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="From"><TextInput type="date" value={range.from || data.from} onChange={(event) => setRange({ ...range, from: event.target.value })} /></Field>
        <Field label="To"><TextInput type="date" value={range.to || data.to} onChange={(event) => setRange({ ...range, to: event.target.value })} /></Field>
        <p className="pb-2 text-sm text-slate-400">{n(total)} coins used in this period.</p>
      </div>
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 text-slate-300">
        <h4 className="mb-2 font-semibold text-white">Coins used per day</h4>
        <DailyBars data={fillDays(data.from, data.to, data.daily).map((row) => ({ day: row.day, value: row.coins, note: `${row.pages} page(s)` }))} format={(value) => `${n(value)}`} label="Coins used" />
      </section>
      <div className="grid gap-5 lg:grid-cols-2">
        <SimpleTable title="By staff member" head={["Staff", "Pages read", "Failed", "Coins"]} rows={data.byStaff.map((row) => [row.name, n(row.pages), n(row.failed), n(row.coins)])} />
        <SimpleTable title="By AI operation" head={["Operation", "Requests", "Coins"]} rows={data.byOperation.map((row) => [row.code, n(row.requests), n(row.coins)])} />
      </div>
      <SimpleTable
        title="By scanning job"
        head={["Job", "Pages read", "Failed", "Coins", "Last activity"]}
        rows={data.byJob.map((row) => [row.jobId ? <Link key={row.jobId} className="text-blue-400 hover:underline" href={`/data-migration/scanner/${encodeURIComponent(row.jobId)}`}>{row.reference}</Link> : row.reference, n(row.pages), n(row.failed), n(row.coins), when(row.last)])}
      />
    </div>
  );
}

function fillDays(from: string, to: string, rows: { day: string; coins: number; pages: number }[]) {
  const map = new Map(rows.map((row) => [row.day, row]));
  const out: { day: string; coins: number; pages: number }[] = [];
  for (let day = new Date(`${from}T12:00:00Z`); day <= new Date(`${to}T12:00:00Z`) && out.length < 400; day = new Date(day.getTime() + 86_400_000)) {
    const key = day.toISOString().slice(0, 10);
    out.push(map.get(key) ?? { day: key, coins: 0, pages: 0 });
  }
  return out;
}

function SimpleTable({ title, head, rows }: { title: string; head: string[]; rows: React.ReactNode[][] }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <h4 className="font-semibold text-white">{title}</h4>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">Nothing yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-[0.14em] text-slate-500">
              <tr>{head.map((cell, index) => <th key={cell} className={`py-2 ${index ? "text-right" : ""}`}>{cell}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {rows.map((row, index) => (
                <tr key={index}>{row.map((cell, column) => <td key={column} className={`py-2 ${column ? "text-right" : ""}`}>{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PricingTab({ overview }: { overview: Overview }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <h4 className="font-semibold text-white">AI operation prices</h4>
      <p className="mt-1 text-sm text-slate-400">Set by Web365. Prices are fixed when coins are reserved, so a change never affects work already started.</p>
      <ul className="mt-4 divide-y divide-slate-800">
        {overview.prices.map((price) => (
          <li key={price.code} className="flex flex-wrap items-start justify-between gap-2 py-3">
            <div>
              <p className="font-medium text-white">{price.name}{price.override ? <span className="ml-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">Your price</span> : null}</p>
              <p className="text-sm text-slate-400">{price.description}</p>
            </div>
            <p className="flex items-center gap-1 text-sm font-semibold text-white"><ArrowDownCircle className="h-4 w-4 text-slate-500" />{price.coins === 0 ? "Free" : `${n(price.coins)} coins ${METHOD[price.method] ?? ""}`}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
