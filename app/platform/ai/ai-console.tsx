"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { Notice, inputClass } from "@/components/auth-card";
import { DailyBars } from "@/components/charts/daily-bars";

// ---------------------------------------------------------------- shared helpers

const n = (value: number) => value.toLocaleString("en-NG");
const ngn = (value: number | null) => (value === null ? "—" : new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(value));
const usd = (value: number | null, digits = 2) => (value === null ? "—" : `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 4) })}`);
const when = (value: string | null) => (value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—");
const pct = (value: number | null) => (value === null ? "—" : `${(value * 100).toFixed(1)}%`);
const small = "h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm text-slate-900 outline-none focus:border-green-600";
const button = "inline-flex h-9 items-center justify-center rounded-lg bg-green-700 px-3 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50";
const ghost = "inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";

async function get<T>(query: string): Promise<T> {
  const response = await fetch(`/api/platform/ai?${query}`, { cache: "no-store" });
  const data = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data as T;
}
async function post<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/platform/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data as T;
}

function useView<T>(query: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!query) return;
    try {
      setData(await get<T>(query));
      setError(null);
    } catch (problem) {
      setError((problem as Error).message);
    }
  }, [query]);
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);
  return { data, setData, error, reload: load };
}

function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5">
      {title || actions ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title ? <h2 className="font-semibold text-slate-900">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
      {note ? <p className="mt-0.5 text-xs text-slate-500">{note}</p> : null}
    </div>
  );
}

function Table({ head, rows, empty = "Nothing yet." }: { head: string[]; rows: ReactNode[][]; empty?: string }) {
  if (!rows.length) return <p className="text-sm text-slate-500">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>{head.map((cell) => <th key={cell} className="px-2 py-2 font-medium">{cell}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-slate-700">
          {rows.map((row, index) => (
            <tr key={index}>{row.map((cell, column) => <td key={column} className="px-2 py-2 align-top">{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DateRange({ value, onChange }: { value: { from: string; to: string }; onChange: (value: { from: string; to: string }) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="flex items-center gap-1.5">From <input type="date" className={small} value={value.from} onChange={(event) => onChange({ ...value, from: event.target.value })} /></label>
      <label className="flex items-center gap-1.5">To <input type="date" className={small} value={value.to} onChange={(event) => onChange({ ...value, to: event.target.value })} /></label>
    </div>
  );
}

const TABS = [
  ["dashboard", "Dashboard"],
  ["costs", "AI provider costs"],
  ["pricing", "Coin pricing"],
  ["packages", "Coin packages"],
  ["tenants", "Pharmacy usage"],
  ["limits", "Spending limits"],
  ["purchases", "Purchases"],
  ["reconciliation", "Reconciliation"],
  ["settings", "Wallet settings"],
] as const;

// ---------------------------------------------------------------- console

type Dashboard = {
  from: string;
  to: string;
  coins: { issued: number; purchased: number; free: number; consumed: number; refunded: number; reservedNow: number; availableNow: number; wallets: number };
  jobs: { successfulRequests: number; failedRequests: number; jobs: number };
  provider: { cost: number; currency: string; failedCost: number; unpricedRequests: number; basis: string };
  money: { currency: string; revenue: number; refunds: number; purchases: number; fees: number; feesUnknown: number; usdToNgnRate: number | null; costNgn: number | null; grossProfit: number | null; grossMargin: number | null; costPerPage: number | null; revenuePerPage: number | null; coinValue: { ngnPerCoin: number; consumedValue: number; freeValue: number } | null };
  series: { day: string; coins: number; cost: number; revenue: number }[];
  byTenant: { tenantId: string; name: string; coins: number; cost: number; pages: number }[];
  byOperation: { code: string; requests: number; coins: number; cost: number }[];
};

export function AiConsole({ initialTab, initialDashboard, canManage }: { initialTab: string; initialDashboard: Dashboard; canManage: boolean }) {
  const [tab, setTab] = useState(TABS.some(([key]) => key === initialTab) ? initialTab : "dashboard");
  const go = (key: string) => {
    setTab(key);
    window.history.replaceState(null, "", `/platform/ai${key === "dashboard" ? "" : `?tab=${key}`}`);
  };
  return (
    <div className="space-y-5">
      <nav className="flex gap-1 overflow-x-auto border-b border-slate-200" aria-label="AI Usage & Billing sections">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" onClick={() => go(key)} aria-current={tab === key ? "page" : undefined} className={`shrink-0 border-b-2 px-3 py-2 text-sm ${tab === key ? "border-green-700 font-semibold text-green-800" : "border-transparent text-slate-600 hover:text-slate-900"}`}>
            {label}
          </button>
        ))}
      </nav>
      {!canManage ? <Notice tone="info">You can view AI usage and billing. Changes need the AI management permission (Platform Super Admin or Billing Administrator).</Notice> : null}
      {tab === "dashboard" ? <DashboardTab initial={initialDashboard} /> : null}
      {tab === "costs" ? <CostsTab /> : null}
      {tab === "pricing" ? <PricingTab canManage={canManage} /> : null}
      {tab === "packages" ? <PackagesTab canManage={canManage} /> : null}
      {tab === "tenants" ? <TenantsTab /> : null}
      {tab === "limits" ? <LimitsTab canManage={canManage} /> : null}
      {tab === "purchases" ? <PurchasesTab canManage={canManage} /> : null}
      {tab === "reconciliation" ? <ReconciliationTab canManage={canManage} /> : null}
      {tab === "settings" ? <SettingsTab canManage={canManage} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- dashboard

function DashboardTab({ initial }: { initial: Dashboard }) {
  const [range, setRange] = useState({ from: initial.from, to: initial.to });
  const query = range.from === initial.from && range.to === initial.to ? null : `view=dashboard&from=${range.from}&to=${range.to}`;
  const { data } = useView<Dashboard>(query);
  const d = query ? data ?? initial : initial;
  const m = d.money;
  return (
    <div className="space-y-5">
      <DateRange value={range} onChange={setRange} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Coins issued" value={n(d.coins.issued)} note={`${n(d.coins.purchased)} bought · ${n(d.coins.free)} free`} />
        <Stat label="Coins consumed" value={n(d.coins.consumed)} note={`${n(d.coins.refunded)} refunded`} />
        <Stat label="Coins held now" value={n(d.coins.reservedNow)} note={`${n(d.coins.availableNow)} available in ${n(d.coins.wallets)} wallet(s)`} />
        <Stat label="AI requests" value={n(d.jobs.successfulRequests)} note={`${n(d.jobs.failedRequests)} failed · ${n(d.jobs.jobs)} job(s)`} />
        <Stat label="Coin sales revenue" value={ngn(m.revenue)} note={`${n(m.purchases)} purchase(s)${m.refunds ? ` · ${ngn(m.refunds)} refunded` : ""}`} />
        <Stat label="AI provider cost (est.)" value={usd(d.provider.cost)} note={m.costNgn !== null ? `≈ ${ngn(m.costNgn)} at ₦${n(m.usdToNgnRate!)}/$` : "Set the USD→NGN rate in Wallet settings"} />
        <Stat label="Payment fees" value={ngn(m.fees)} note={m.feesUnknown ? `${m.feesUnknown} purchase(s) without a reported fee` : "As reported by Paystack"} />
        <Stat label="Estimated gross profit" value={ngn(m.grossProfit)} note={`Margin ${pct(m.grossMargin)}`} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Cost per page read (est.)" value={usd(m.costPerPage, 4)} />
        <Stat label="Revenue per page read" value={m.revenuePerPage === null ? "—" : ngn(m.revenuePerPage)} />
        <Stat label="Failed-request cost (est.)" value={usd(d.provider.failedCost, 4)} note={d.provider.unpricedRequests ? `${d.provider.unpricedRequests} request(s) without usage data` : undefined} />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Coins consumed per day">
          <div className="text-slate-600"><DailyBars data={d.series.map((row) => ({ day: row.day, value: row.coins }))} format={n} label="Coins consumed" /></div>
        </Card>
        <Card title="AI provider cost per day (USD, est.)">
          <div className="text-slate-600"><DailyBars data={d.series.map((row) => ({ day: row.day, value: row.cost }))} format={(value) => usd(value, 2)} label="Provider cost" /></div>
        </Card>
        <Card title="Coin sales revenue per day">
          <div className="text-slate-600"><DailyBars data={d.series.map((row) => ({ day: row.day, value: row.revenue }))} format={(value) => ngn(value)} label="Revenue" /></div>
        </Card>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="AI usage by pharmacy (top 10)">
          <Table head={["Pharmacy", "Pages read", "Coins", "Cost (est.)"]} rows={d.byTenant.map((row) => [<Link key={row.tenantId} className="text-green-700 hover:underline" href={`/platform/ai/tenants/${encodeURIComponent(row.tenantId)}`}>{row.name}</Link>, n(row.pages), n(row.coins), usd(row.cost, 4)])} />
        </Card>
        <Card title="By AI operation">
          <Table head={["Operation", "Requests", "Coins", "Cost (est.)"]} rows={d.byOperation.map((row) => [row.code, n(row.requests), n(row.coins), usd(row.cost, 4)])} />
        </Card>
      </div>
      <Card title="How these figures are worked out">
        <ul className="space-y-1 text-sm text-slate-600">
          <li>• Revenue is cash received for coins on the payment date, less refunds. Free welcome and promotional coins are not revenue.</li>
          <li>• AI provider cost is estimated from the tokens the provider reported for each request × the model price configured under Coin pricing. It is not the provider&apos;s invoice.</li>
          <li>• Gross profit = revenue − Paystack fees − provider cost converted at the configured USD→NGN rate. Unused coin balances are not counted as cost.</li>
          {m.coinValue ? <li>• At the configured ₦{m.coinValue.ngnPerCoin}/coin, coins consumed are worth {ngn(m.coinValue.consumedValue)} and free coins issued {ngn(m.coinValue.freeValue)} (for reporting only).</li> : null}
        </ul>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- provider costs

type CostRow = { key: string; label: string; requests: number; success: number; failed: number; inputTokens: number; outputTokens: number; cost: number; failedCost: number; unpriced: number; costPerPage: number | null };
type Costs = { from: string; to: string; basis: string; byModel: CostRow[]; byTenant: CostRow[]; byOperation: CostRow[]; daily: CostRow[]; monthly: { month: string; cost: number; requests: number }[]; recent: { at: string | null; tenant: string; model: string; operation: string | null; job: string | null; requestId: string | null; inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheCreationTokens: number | null; cost: number | null; basis: string; pricingVersion: string | null; durationMs: number | null; status: string; attempt: number; error: string | null }[] };

function CostsTab() {
  const [range, setRange] = useState({ from: "", to: "" });
  const { data, error } = useView<Costs>(`view=costs${range.from ? `&from=${range.from}` : ""}${range.to ? `&to=${range.to}` : ""}`);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;
  const rows = (list: CostRow[]) => list.map((row) => [row.label, n(row.requests), `${n(row.success)} / ${n(row.failed)}`, n(row.inputTokens), n(row.outputTokens), usd(row.cost, 4), usd(row.failedCost, 4), row.costPerPage === null ? "—" : usd(row.costPerPage, 4)]);
  const head = ["", "Requests", "OK / failed", "Input tokens", "Output tokens", "Cost (est.)", "Failed cost", "Per page"];
  return (
    <div className="space-y-5">
      <DateRange value={{ from: range.from || data.from, to: range.to || data.to }} onChange={setRange} />
      <Notice tone="info">{data.basis}</Notice>
      <Card title="By model"><Table head={["Model", ...head.slice(1)]} rows={rows(data.byModel)} /></Card>
      <Card title="By pharmacy"><Table head={["Pharmacy", ...head.slice(1)]} rows={rows(data.byTenant)} /></Card>
      <Card title="By AI operation"><Table head={["Operation", ...head.slice(1)]} rows={rows(data.byOperation)} /></Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Daily"><Table head={["Day", ...head.slice(1, 3), "Cost (est.)"]} rows={data.daily.map((row) => [row.key, n(row.requests), `${n(row.success)} / ${n(row.failed)}`, usd(row.cost, 4)])} /></Card>
        <Card title="Monthly"><Table head={["Month", "Requests", "Cost (est.)"]} rows={data.monthly.map((row) => [row.month, n(row.requests), usd(row.cost, 4)])} /></Card>
      </div>
      <Card title="Latest requests">
        <Table
          head={["Time", "Pharmacy", "Model", "Operation / job", "Request", "Tokens in / out / cache", "Cost", "Duration", "Status"]}
          rows={data.recent.map((row) => [
            when(row.at),
            row.tenant,
            row.model,
            `${row.operation ?? "—"}${row.job ? ` · ${row.job}` : ""}`,
            <span key="request" className="font-mono text-xs">{row.requestId?.slice(0, 18) ?? "—"}</span>,
            row.inputTokens === null ? "not reported" : `${n(row.inputTokens)} / ${n(row.outputTokens ?? 0)} / ${n((row.cacheReadTokens ?? 0) + (row.cacheCreationTokens ?? 0))}`,
            row.cost === null ? "unavailable" : `${usd(row.cost, 4)} (est.)`,
            row.durationMs === null ? "—" : `${(row.durationMs / 1000).toFixed(1)} s`,
            `${row.status === "SUCCESS" ? "OK" : "Failed"}${row.attempt > 1 ? ` (try ${row.attempt})` : ""}${row.error ? ` — ${row.error}` : ""}`,
          ])}
        />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- pricing

type Operation = { id: string; code: string; tenantId: string | null; tenantName: string | null; name: string; description: string; method: string; coins: number; enabled: boolean; effectiveFrom: string | null; effectiveTo: string | null; createdBy: string; current: boolean };
type ModelPriceRow = { id: string; provider: string; model: string; input: number; output: number; cacheRead: number; cacheWrite: number; currency: string; source: string; effectiveFrom: string | null; effectiveTo: string | null; createdBy: string; current: boolean };
const METHODS = [["PER_PAGE", "Per page"], ["PER_DOCUMENT", "Per document"], ["FIXED", "Fixed per operation"], ["PER_1K_TOKENS", "Per 1,000 tokens"]];

function PricingTab({ canManage }: { canManage: boolean }) {
  const { data, setData, error } = useView<{ operations: Operation[]; models: ModelPriceRow[] }>("view=pricing");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Operation>>({});
  const [newOp, setNewOp] = useState({ code: "", name: "", description: "", method: "FIXED", coins: "0", enabled: false, tenantId: "" });
  const [model, setModel] = useState({ provider: "anthropic", model: "", input: "", output: "", cacheRead: "", cacheWrite: "", source: "" });
  const [showHistory, setShowHistory] = useState(false);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;
  const current = data.operations.filter((row) => row.current);
  const save = async (price: Record<string, unknown>) => {
    try {
      setData(await post({ action: "price", price }));
      setMessage({ tone: "success", text: "Saved. The new price applies to work started from now; work already reserved keeps its price." });
    } catch (problem) {
      setMessage({ tone: "error", text: (problem as Error).message });
    }
  };
  return (
    <div className="space-y-5">
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Card title="AI operation prices (coins)">
        <Table
          head={["Operation", "Applies to", "Method", "Coins", "Enabled", "Since", ""]}
          rows={current.map((row) => {
            const draft = drafts[row.id] ?? row;
            const set = (change: Partial<Operation>) => setDrafts({ ...drafts, [row.id]: { ...draft, ...change } });
            return [
              <div key="name"><p className="font-medium text-slate-900">{row.name}</p><p className="font-mono text-xs text-slate-500">{row.code}</p></div>,
              row.tenantName ?? "All pharmacies",
              <select key="method" className={small} disabled={!canManage} value={draft.method} onChange={(event) => set({ method: event.target.value })}>{METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>,
              <input key="coins" className={`${small} w-24`} type="number" min={0} disabled={!canManage} value={draft.coins} onChange={(event) => set({ coins: Number(event.target.value) })} />,
              <input key="enabled" type="checkbox" disabled={!canManage} checked={draft.enabled} onChange={(event) => set({ enabled: event.target.checked })} aria-label={`${row.name} enabled`} />,
              `${when(row.effectiveFrom)} · ${row.createdBy}`,
              canManage ? (
                <div key="actions" className="flex gap-1">
                  <button type="button" className={button} disabled={!drafts[row.id]} onClick={() => save({ code: row.code, tenantId: row.tenantId, name: draft.name, description: draft.description, method: draft.method, coins: draft.coins, enabled: draft.enabled })}>Save</button>
                  {row.tenantId ? <button type="button" className={ghost} onClick={async () => setData(await post({ action: "end-override", code: row.code, tenantId: row.tenantId }))}>Remove override</button> : null}
                </div>
              ) : null,
            ];
          })}
        />
        <button type="button" className="mt-3 text-sm text-green-700 hover:underline" onClick={() => setShowHistory(!showHistory)}>{showHistory ? "Hide" : "Show"} price history</button>
        {showHistory ? <div className="mt-3"><Table head={["Operation", "Applies to", "Coins", "From", "To", "By"]} rows={data.operations.filter((row) => !row.current).map((row) => [row.code, row.tenantName ?? "All", n(row.coins), when(row.effectiveFrom), when(row.effectiveTo), row.createdBy])} empty="No earlier prices." /></div> : null}
      </Card>
      {canManage ? (
        <Card title="Add an operation or a pharmacy price override">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm font-medium">Code<input className={inputClass} placeholder="e.g. ai.stock-analysis" value={newOp.code} onChange={(event) => setNewOp({ ...newOp, code: event.target.value })} /></label>
            <label className="text-sm font-medium">Name<input className={inputClass} value={newOp.name} onChange={(event) => setNewOp({ ...newOp, name: event.target.value })} /></label>
            <label className="text-sm font-medium">Pharmacy ID (blank = all)<input className={inputClass} value={newOp.tenantId} onChange={(event) => setNewOp({ ...newOp, tenantId: event.target.value })} /></label>
            <label className="text-sm font-medium sm:col-span-3">Description<input className={inputClass} value={newOp.description} onChange={(event) => setNewOp({ ...newOp, description: event.target.value })} /></label>
            <label className="text-sm font-medium">Method<select className={inputClass} value={newOp.method} onChange={(event) => setNewOp({ ...newOp, method: event.target.value })}>{METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="text-sm font-medium">Coins<input className={inputClass} type="number" min={0} value={newOp.coins} onChange={(event) => setNewOp({ ...newOp, coins: event.target.value })} /></label>
            <label className="flex items-center gap-2 pt-6 text-sm font-medium"><input type="checkbox" checked={newOp.enabled} onChange={(event) => setNewOp({ ...newOp, enabled: event.target.checked })} /> Enabled</label>
          </div>
          <button type="button" className={`${button} mt-3`} onClick={() => save({ code: newOp.code, tenantId: newOp.tenantId.trim() || null, name: newOp.name, description: newOp.description, method: newOp.method, coins: Number(newOp.coins), enabled: newOp.enabled })}>Save price</button>
        </Card>
      ) : null}
      <Card title="AI model prices (USD per million tokens) — used to estimate provider cost">
        <Table head={["Model", "Input", "Output", "Cache read", "Cache write", "Source", "Since"]} rows={data.models.filter((row) => row.current).map((row) => [`${row.provider} / ${row.model}`, usd(row.input), usd(row.output), usd(row.cacheRead), usd(row.cacheWrite), row.source, `${when(row.effectiveFrom)} · ${row.createdBy}`])} />
        {canManage ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <label className="text-sm font-medium">Model<input className={inputClass} placeholder="claude-opus-5-5" value={model.model} onChange={(event) => setModel({ ...model, model: event.target.value })} /></label>
            {(["input", "output", "cacheRead", "cacheWrite"] as const).map((key) => (
              <label key={key} className="text-sm font-medium">{{ input: "Input $", output: "Output $", cacheRead: "Cache read $", cacheWrite: "Cache write $" }[key]}<input className={inputClass} type="number" min={0} step="0.001" value={model[key]} onChange={(event) => setModel({ ...model, [key]: event.target.value })} /></label>
            ))}
            <label className="text-sm font-medium sm:col-span-2">Source<input className={inputClass} placeholder="Anthropic pricing page, date" value={model.source} onChange={(event) => setModel({ ...model, source: event.target.value })} /></label>
            <div className="flex items-end"><button type="button" className={button} onClick={async () => {
              try {
                setData(await post({ action: "model-price", price: { provider: model.provider, model: model.model, input: Number(model.input), output: Number(model.output), cacheRead: Number(model.cacheRead), cacheWrite: Number(model.cacheWrite), source: model.source } }));
                setMessage({ tone: "success", text: "Model price saved for requests from now." });
              } catch (problem) {
                setMessage({ tone: "error", text: (problem as Error).message });
              }
            }}>Save model price</button></div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- packages

type Package = { id: string; name: string; description: string; coins: number; bonusCoins: number; price: number; currency: string; active: boolean; displayOrder: number; promoStartsAt: string | null; promoEndsAt: string | null; maxPerTenantPerMonth: number | null; sold: number; updatedAt: string | null };
const blankPackage: Package = { id: "", name: "", description: "", coins: 500, bonusCoins: 0, price: 2000, currency: "NGN", active: false, displayOrder: 10, promoStartsAt: null, promoEndsAt: null, maxPerTenantPerMonth: null, sold: 0, updatedAt: null };

function PackagesTab({ canManage }: { canManage: boolean }) {
  const { data, setData, error } = useView<Package[]>("view=packages");
  const [editing, setEditing] = useState<Package | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;
  const save = async (pack: Package) => {
    try {
      const body = { ...(pack.id ? { id: pack.id } : {}), name: pack.name, description: pack.description, coins: pack.coins, bonusCoins: pack.bonusCoins, price: pack.price, active: pack.active, displayOrder: pack.displayOrder, promoStartsAt: pack.promoStartsAt ? new Date(pack.promoStartsAt).toISOString() : null, promoEndsAt: pack.promoEndsAt ? new Date(pack.promoEndsAt).toISOString() : null, maxPerTenantPerMonth: pack.maxPerTenantPerMonth };
      setData(await post({ action: "package", package: body }));
      setEditing(null);
      setMessage({ tone: "success", text: "Package saved. Changes apply to purchases started from now." });
    } catch (problem) {
      setMessage({ tone: "error", text: (problem as Error).message });
    }
  };
  const local = (value: string | null) => (value ? new Date(value).toISOString().slice(0, 16) : "");
  return (
    <div className="space-y-5">
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Card title="Coin packages" actions={canManage ? <button type="button" className={button} onClick={() => setEditing({ ...blankPackage })}>New package</button> : null}>
        <Table
          head={["Order", "Package", "Coins", "Bonus", "Price", "₦ per coin", "On sale", "Promotion", "Limit / month", "Sold", ""]}
          rows={data.map((pack) => [
            pack.displayOrder,
            <div key="name"><p className="font-medium text-slate-900">{pack.name}</p><p className="text-xs text-slate-500">{pack.description}</p></div>,
            n(pack.coins),
            pack.bonusCoins ? `+${n(pack.bonusCoins)}` : "—",
            ngn(pack.price),
            (pack.price / (pack.coins + pack.bonusCoins)).toFixed(2),
            pack.active ? "Yes" : "No",
            pack.promoStartsAt || pack.promoEndsAt ? `${pack.promoStartsAt ? when(pack.promoStartsAt) : "now"} → ${pack.promoEndsAt ? when(pack.promoEndsAt) : "open"}` : "—",
            pack.maxPerTenantPerMonth ?? "—",
            n(pack.sold),
            canManage ? <div key="actions" className="flex gap-1"><button type="button" className={ghost} onClick={() => setEditing({ ...pack })}>Edit</button><button type="button" className={ghost} onClick={() => save({ ...pack, active: !pack.active })}>{pack.active ? "Take off sale" : "Put on sale"}</button></div> : null,
          ])}
        />
      </Card>
      {editing ? (
        <Card title={editing.id ? `Edit ${editing.name}` : "New package"}>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm font-medium">Name<input className={inputClass} value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
            <label className="text-sm font-medium sm:col-span-2">Description<input className={inputClass} value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></label>
            <label className="text-sm font-medium">Coins<input className={inputClass} type="number" min={1} value={editing.coins} onChange={(event) => setEditing({ ...editing, coins: Number(event.target.value) })} /></label>
            <label className="text-sm font-medium">Bonus coins<input className={inputClass} type="number" min={0} value={editing.bonusCoins} onChange={(event) => setEditing({ ...editing, bonusCoins: Number(event.target.value) })} /></label>
            <label className="text-sm font-medium">Price (₦)<input className={inputClass} type="number" min={1} value={editing.price} onChange={(event) => setEditing({ ...editing, price: Number(event.target.value) })} /></label>
            <label className="text-sm font-medium">Bonus from<input className={inputClass} type="datetime-local" value={local(editing.promoStartsAt)} onChange={(event) => setEditing({ ...editing, promoStartsAt: event.target.value || null })} /></label>
            <label className="text-sm font-medium">Bonus until<input className={inputClass} type="datetime-local" value={local(editing.promoEndsAt)} onChange={(event) => setEditing({ ...editing, promoEndsAt: event.target.value || null })} /></label>
            <label className="text-sm font-medium">Max per pharmacy per month<input className={inputClass} type="number" min={1} value={editing.maxPerTenantPerMonth ?? ""} onChange={(event) => setEditing({ ...editing, maxPerTenantPerMonth: event.target.value ? Number(event.target.value) : null })} /></label>
            <label className="text-sm font-medium">Display order<input className={inputClass} type="number" min={0} value={editing.displayOrder} onChange={(event) => setEditing({ ...editing, displayOrder: Number(event.target.value) })} /></label>
            <label className="flex items-center gap-2 pt-6 text-sm font-medium"><input type="checkbox" checked={editing.active} onChange={(event) => setEditing({ ...editing, active: event.target.checked })} /> On sale</label>
          </div>
          <p className="mt-2 text-xs text-slate-500">Total received: {n(editing.coins + editing.bonusCoins)} coins (bonus coins apply only inside the promotion dates, when set).</p>
          <div className="mt-3 flex gap-2"><button type="button" className={button} onClick={() => save(editing)}>Save package</button><button type="button" className={ghost} onClick={() => setEditing(null)}>Cancel</button></div>
        </Card>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- pharmacies

type TenantRow = { tenantId: string; name: string; status: string; demo: boolean; hasWallet: boolean; walletStatus: string | null; available: number; reserved: number; purchased: number; free: number; consumed: number; jobs: number; cost: number; revenue: number; lastActivity: string | null };

function TenantsTab() {
  const { data, error } = useView<TenantRow[]>("view=tenants");
  const [search, setSearch] = useState("");
  const rows = useMemo(() => (data ?? []).filter((row) => `${row.name} ${row.tenantId}`.toLowerCase().includes(search.trim().toLowerCase())), [data, search]);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;
  return (
    <Card title="Pharmacy AI usage" actions={<input className={small} placeholder="Search pharmacies" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search pharmacies" />}>
      <Table
        head={["Pharmacy", "Status", "Available", "Held", "Bought", "Free", "Used", "AI jobs", "AI cost (est.)", "Coin revenue", "Last AI activity"]}
        rows={rows.map((row) => [
          <Link key="name" href={`/platform/ai/tenants/${encodeURIComponent(row.tenantId)}`} className="font-medium text-green-700 hover:underline">{row.name}</Link>,
          `${row.status.toLowerCase()}${row.walletStatus === "SUSPENDED" ? " · wallet suspended" : ""}${row.demo ? " · demo" : ""}`,
          row.hasWallet ? n(row.available) : "no wallet yet",
          n(row.reserved),
          n(row.purchased),
          n(row.free),
          n(row.consumed),
          n(row.jobs),
          usd(row.cost, 4),
          ngn(row.revenue),
          when(row.lastActivity),
        ])}
      />
    </Card>
  );
}

// ---------------------------------------------------------------- limits

type LimitRow = { tenantId: string | null; tenantName: string | null; maxDailyCost: number | null; maxMonthlyCost: number | null; maxJobsPerDay: number | null; maxPagesPerJob: number | null; maxConcurrentJobs: number | null; maxRequestsPerUserPerDay: number | null; paused: boolean; updatedBy: string | null; updatedAt: string | null };
const LIMIT_FIELDS: [keyof LimitRow, string][] = [["maxDailyCost", "Max AI cost per day ($)"], ["maxMonthlyCost", "Max AI cost per month ($)"], ["maxJobsPerDay", "Max AI jobs per pharmacy per day"], ["maxPagesPerJob", "Max pages per job"], ["maxConcurrentJobs", "Max jobs running at once per pharmacy"], ["maxRequestsPerUserPerDay", "Max AI jobs started per user per day"]];

export function LimitsEditor({ row, onSaved, canManage }: { row: LimitRow; onSaved: (value: unknown) => void; canManage: boolean }) {
  const [draft, setDraft] = useState<Record<string, string | boolean>>(() => Object.fromEntries([...LIMIT_FIELDS.map(([key]) => [key, row[key] === null ? "" : String(row[key])]), ["paused", row.paused]]));
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const save = async () => {
    try {
      const limits = { tenantId: row.tenantId, paused: draft.paused === true, ...Object.fromEntries(LIMIT_FIELDS.map(([key]) => [key, draft[key] === "" ? null : Number(draft[key])])) };
      onSaved(await post({ action: "limits", limits }));
      setMessage({ tone: "success", text: "Limits saved." });
    } catch (problem) {
      setMessage({ tone: "error", text: (problem as Error).message });
    }
  };
  return (
    <div className="space-y-3">
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        {LIMIT_FIELDS.map(([key, label]) => (
          <label key={key} className="text-sm font-medium">{label}<input className={inputClass} type="number" min={0} step="any" disabled={!canManage} placeholder="No limit" value={String(draft[key])} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /></label>
        ))}
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" disabled={!canManage} checked={draft.paused === true} onChange={(event) => setDraft({ ...draft, paused: event.target.checked })} /> Pause new AI jobs</label>
      </div>
      {canManage ? <button type="button" className={button} onClick={save}>Save limits</button> : null}
      {row.updatedBy ? <p className="text-xs text-slate-500">Last changed by {row.updatedBy}, {when(row.updatedAt)}</p> : null}
    </div>
  );
}

function LimitsTab({ canManage }: { canManage: boolean }) {
  const { data, setData, error } = useView<{ spend: { today: number; month: number }; rows: LimitRow[] }>("view=limits");
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;
  const global = data.rows.find((row) => row.tenantId === null) ?? { tenantId: null, tenantName: null, maxDailyCost: null, maxMonthlyCost: null, maxJobsPerDay: null, maxPagesPerJob: null, maxConcurrentJobs: null, maxRequestsPerUserPerDay: null, paused: false, updatedBy: null, updatedAt: null };
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2"><Stat label="AI cost today (est.)" value={usd(data.spend.today, 4)} /><Stat label="AI cost this month (est.)" value={usd(data.spend.month, 4)} /></div>
      <Card title="Platform-wide limits">
        <p className="mb-3 text-sm text-slate-600">When a limit is reached, new paid AI jobs are refused with an explanation. Pages already queued are still read and finished records are kept. Pharmacies cannot change these limits.</p>
        <LimitsEditor key={JSON.stringify(global)} row={global} canManage={canManage} onSaved={(value) => setData(value as typeof data)} />
      </Card>
      <Card title="Pharmacy-specific limits (override the platform limits)">
        <Table head={["Pharmacy", "Cost/day", "Cost/month", "Jobs/day", "Pages/job", "At once", "Per user/day", "Paused"]} rows={data.rows.filter((row) => row.tenantId).map((row) => [<Link key="tenant" className="text-green-700 hover:underline" href={`/platform/ai/tenants/${encodeURIComponent(row.tenantId!)}`}>{row.tenantName}</Link>, row.maxDailyCost ?? "—", row.maxMonthlyCost ?? "—", row.maxJobsPerDay ?? "—", row.maxPagesPerJob ?? "—", row.maxConcurrentJobs ?? "—", row.maxRequestsPerUserPerDay ?? "—", row.paused ? "Yes" : "No"])} empty="None. Set them on a pharmacy's AI usage page." />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- purchases

type Purchase = { id: string; reference: string; tenantId: string; tenant: string; packageName: string; coins: number; amount: number; fees: number | null; currency: string; status: string; failureReason: string | null; settledBy: string | null; by: string; createdAt: string | null; paidAt: string | null; creditedAt: string | null; refundedAt: string | null };

function PurchasesTab({ canManage }: { canManage: boolean }) {
  const [status, setStatus] = useState("");
  const { data, error, reload } = useView<Purchase[]>(`view=purchases${status ? `&status=${status}` : ""}`);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;
  const act = async (body: Record<string, unknown>, done: string) => {
    try {
      const result = await post<{ message?: string }>(body);
      setMessage({ tone: "success", text: result.message ?? done });
      await reload();
    } catch (problem) {
      setMessage({ tone: "error", text: (problem as Error).message });
    }
  };
  return (
    <Card title="Coin purchases" actions={<select className={small} value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Status">{["", "PENDING", "SUCCESS", "FAILED", "ABANDONED", "REFUNDED"].map((value) => <option key={value} value={value}>{value ? value.toLowerCase() : "All statuses"}</option>)}</select>}>
      {message ? <div className="mb-3"><Notice tone={message.tone}>{message.text}</Notice></div> : null}
      <Table
        head={["Started", "Pharmacy", "Package", "Coins", "Amount", "Fee", "Status", "Credited", "Reference", ""]}
        rows={data.map((row) => [
          when(row.createdAt),
          row.tenant,
          row.packageName,
          n(row.coins),
          ngn(row.amount),
          row.fees === null ? "—" : ngn(row.fees),
          <span key="status">{row.status.toLowerCase()}{row.failureReason && row.status !== "SUCCESS" ? <span className="block text-xs text-slate-500">{row.failureReason}</span> : null}</span>,
          row.creditedAt ? `${when(row.creditedAt)} (${row.settledBy})` : "—",
          <span key="ref" className="font-mono text-xs">{row.reference}</span>,
          canManage ? (
            <div key="actions" className="flex gap-1">
              {row.status === "PENDING" ? <button type="button" className={ghost} onClick={() => act({ action: "recheck", reference: row.reference }, "Checked with Paystack.")}>Check with Paystack</button> : null}
              {row.status === "SUCCESS" ? <button type="button" className={ghost} onClick={() => { const reason = window.prompt("Reason for the refund (at least 10 characters)"); if (reason) void act({ action: "refund", purchaseId: row.id, reason }, "Refunded."); }}>Refund</button> : null}
            </div>
          ) : null,
        ])}
      />
    </Card>
  );
}

// ---------------------------------------------------------------- reconciliation

type Run = { id: string; trigger: string; startedAt: string | null; finishedAt: string | null; walletsChecked: number; mismatches: { tenantId: string; problem: string }[]; actions: string[] };

function ReconciliationTab({ canManage }: { canManage: boolean }) {
  const { data, error, reload } = useView<Run[]>("view=reconciliation");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;
  return (
    <Card
      title="Wallet reconciliation"
      actions={canManage ? <button type="button" className={button} disabled={busy} onClick={async () => {
        setBusy(true);
        try {
          const run = await post<Run>({ action: "reconcile" });
          setMessage({ tone: run.mismatches.length ? "error" : "success", text: `${run.walletsChecked} wallet(s) checked, ${run.mismatches.length} difference(s), ${run.actions.length} action(s).` });
          await reload();
        } catch (problem) {
          setMessage({ tone: "error", text: (problem as Error).message });
        }
        setBusy(false);
      }}>{busy ? "Checking…" : "Run reconciliation now"}</button> : null}
    >
      <p className="mb-3 text-sm text-slate-600">Rebuilds every wallet from its ledger and compares the balances, settles coins left held by interrupted work, and re-checks pending coin payments with Paystack. It also runs with the scheduled platform jobs.</p>
      {message ? <div className="mb-3"><Notice tone={message.tone}>{message.text}</Notice></div> : null}
      <Table
        head={["Started", "Trigger", "Wallets", "Differences", "Actions"]}
        rows={data.map((run) => [when(run.startedAt), run.trigger, n(run.walletsChecked), run.mismatches.length ? <ul key="m" className="text-rose-700">{run.mismatches.map((item, index) => <li key={index}>{item.tenantId}: {item.problem}</li>)}</ul> : "None", run.actions.length ? <ul key="a" className="text-slate-600">{run.actions.map((item, index) => <li key={index}>{item}</li>)}</ul> : "—"])}
        empty="No runs yet."
      />
    </Card>
  );
}

// ---------------------------------------------------------------- settings

type Settings = { value: { welcomeBonusEnabled: boolean; welcomeBonusCoins: number; welcomeBonusReason: string; lowBalanceThresholds: number[]; maxPurchasesPerDay: number | null; usdToNgnRate: number | null; ngnPerCoin: number | null }; updatedAt: string | null; history: { at: string; by: string; changes: string[] }[] };

function SettingsTab({ canManage }: { canManage: boolean }) {
  const { data, setData, error } = useView<Settings>("view=settings");
  const [draft, setDraft] = useState<Record<string, string | boolean> | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;
  const v = data.value;
  const form = draft ?? { welcomeBonusEnabled: v.welcomeBonusEnabled, welcomeBonusCoins: String(v.welcomeBonusCoins), welcomeBonusReason: v.welcomeBonusReason, lowBalanceThresholds: v.lowBalanceThresholds.join(", "), maxPurchasesPerDay: v.maxPurchasesPerDay === null ? "" : String(v.maxPurchasesPerDay), usdToNgnRate: v.usdToNgnRate === null ? "" : String(v.usdToNgnRate), ngnPerCoin: v.ngnPerCoin === null ? "" : String(v.ngnPerCoin) };
  const set = (change: Record<string, string | boolean>) => setDraft({ ...form, ...change });
  const save = async () => {
    try {
      const value = {
        welcomeBonusEnabled: form.welcomeBonusEnabled === true,
        welcomeBonusCoins: Number(form.welcomeBonusCoins),
        welcomeBonusReason: String(form.welcomeBonusReason),
        lowBalanceThresholds: String(form.lowBalanceThresholds).split(/[,\s]+/).filter(Boolean).map(Number),
        maxPurchasesPerDay: form.maxPurchasesPerDay === "" ? null : Number(form.maxPurchasesPerDay),
        usdToNgnRate: form.usdToNgnRate === "" ? null : Number(form.usdToNgnRate),
        ngnPerCoin: form.ngnPerCoin === "" ? null : Number(form.ngnPerCoin),
      };
      setData(await post({ action: "settings", value }));
      setDraft(null);
      setMessage({ tone: "success", text: "Saved." });
    } catch (problem) {
      setMessage({ tone: "error", text: (problem as Error).message });
    }
  };
  const field = (key: string, label: string, hint?: string, type = "number") => (
    <label className="text-sm font-medium">{label}<input className={inputClass} type={type} disabled={!canManage} value={String(form[key])} onChange={(event) => set({ [key]: event.target.value })} />{hint ? <span className="mt-1 block text-xs font-normal text-slate-500">{hint}</span> : null}</label>
  );
  return (
    <div className="space-y-5">
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Card title="Welcome bonus">
        <label className="mb-3 flex items-center gap-2 text-sm font-medium"><input type="checkbox" disabled={!canManage} checked={form.welcomeBonusEnabled === true} onChange={(event) => set({ welcomeBonusEnabled: event.target.checked })} /> Give free coins once to each pharmacy when its AI Wallet opens</label>
        <div className="grid gap-3 sm:grid-cols-3">
          {field("welcomeBonusCoins", "Coins", "Given once per pharmacy, never again for new staff or outlets.")}
          <div className="sm:col-span-2">{field("welcomeBonusReason", "Reason shown in the ledger", undefined, "text")}</div>
        </div>
      </Card>
      <Card title="Alerts and purchase limits">
        <div className="grid gap-3 sm:grid-cols-2">
          {field("lowBalanceThresholds", "Low-balance alert levels (coins)", "Comma separated, e.g. 100, 50. Each level is announced once until the balance rises again.", "text")}
          {field("maxPurchasesPerDay", "Coin purchases a pharmacy may start per day", "Blank: no limit. Per-package monthly limits are set on each package.")}
        </div>
      </Card>
      <Card title="Accounting">
        <div className="grid gap-3 sm:grid-cols-2">
          {field("usdToNgnRate", "USD → NGN rate for AI cost", "Used to compare provider cost (USD) with coin revenue (NGN). Blank: profit is not shown.")}
          {field("ngnPerCoin", "Accounting value of one coin (₦)", "Optional, for reports only. It never changes prices.")}
        </div>
      </Card>
      {canManage ? <button type="button" className={button} disabled={!draft} onClick={save}>Save settings</button> : null}
      <Card title="Change history">
        <Table head={["When", "Who", "Changes"]} rows={data.history.map((entry) => [when(entry.at), entry.by, entry.changes.join("; ")])} empty="No changes yet." />
      </Card>
    </div>
  );
}
