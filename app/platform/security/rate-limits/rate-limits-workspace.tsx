"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field, inputClass, Notice } from "@/components/auth-card";
import type { rateLimitDashboard } from "@/lib/platform/rate-limits";
import { RATE_LIMIT_CATEGORY_IDS } from "@/lib/saas/rate-limit-categories";

type Dashboard = Awaited<ReturnType<typeof rateLimitDashboard>>;
type Filters = { tenant?: string; ip?: string; endpoint?: string; from?: string; to?: string; eventType?: string };
type Tone = "success" | "error";
const button = "rounded-xl px-3 py-2 text-sm font-semibold disabled:opacity-60";
const CATEGORIES: Record<string, string> = {
  api_general: "General API requests",
  login: "Login",
  registration: "Registration",
  password_reset: "Password reset",
  email_verification: "Email verification",
  otp_verification: "OTP verification",
  pos_transactions: "POS transactions",
  product_search: "Product searches",
  barcode_lookup: "Barcode lookups",
  inventory_operations: "Inventory operations",
  stock_transfers: "Stock transfers",
  report_generation: "Report generation",
  file_uploads: "File uploads",
  public_forms: "Public contact and demo forms",
};

async function send(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Could not save changes.");
}

function PolicyRow({ policy, onSaved }: { policy: Dashboard["policies"][number]; onSaved: () => void }) {
  const [rpm, setRpm] = useState(policy.requests_per_minute);
  const [burst, setBurst] = useState(policy.burst);
  const [windowSeconds, setWindowSeconds] = useState(policy.window_seconds);
  const [blockSeconds, setBlockSeconds] = useState(policy.block_seconds);
  const [enabled, setEnabled] = useState(policy.enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    try {
      await send("/api/platform/rate-limits", "POST", {
        action: "policy",
        policy: {
          id: policy.id, category: policy.category, label: policy.label,
          scopeType: policy.scope_type, scopeValue: policy.scope_value, enabled,
          requestsPerMinute: rpm, burst, windowSeconds, blockSeconds,
        },
      });
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save policy.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Remove this ${policy.scope_type} override?`)) return;
    setBusy(true);
    setError("");
    try {
      await send(`/api/platform/rate-limits/${encodeURIComponent(policy.id)}?kind=policy`, "DELETE");
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove policy.");
    } finally {
      setBusy(false);
    }
  }

  const dimension = policy.scope_type === "ip" && !policy.scope_value ? "IP base" : `${policy.scope_type}${policy.scope_value ? `: ${policy.scope_value}` : ""}`;
  const removable = policy.scope_type !== "global" && !(policy.scope_type === "ip" && !policy.scope_value);
  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="py-3 pr-3">
        <p className="font-semibold">{policy.label}</p>
        <p className="text-xs text-slate-500">{policy.category} · {dimension}</p>
        {error ? <p role="alert" className="mt-1 text-xs text-rose-700">{error}</p> : null}
      </td>
      <td className="py-3 pr-2"><input aria-label={`${policy.label} requests per minute`} type="number" min={1} max={100000} className={`${inputClass} w-24`} value={rpm} onChange={(event) => setRpm(Number(event.target.value))} /></td>
      <td className="py-3 pr-2"><input aria-label={`${policy.label} burst allowance`} type="number" min={0} max={100000} className={`${inputClass} w-20`} value={burst} onChange={(event) => setBurst(Number(event.target.value))} /></td>
      <td className="py-3 pr-2"><input aria-label={`${policy.label} window seconds`} type="number" min={1} max={86400} className={`${inputClass} w-20`} value={windowSeconds} onChange={(event) => setWindowSeconds(Number(event.target.value))} /></td>
      <td className="py-3 pr-2"><input aria-label={`${policy.label} automatic block seconds`} type="number" min={0} max={86400} className={`${inputClass} w-20`} value={blockSeconds} onChange={(event) => setBlockSeconds(Number(event.target.value))} /></td>
      <td className="py-3 pr-2"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />Enabled</label></td>
      <td className="py-3">
        <div className="flex gap-2">
          <button type="button" className={`${button} bg-slate-900 text-white`} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
          {removable ? <button type="button" className={`${button} border border-slate-300`} disabled={busy} onClick={remove}>Remove</button> : null}
        </div>
      </td>
    </tr>
  );
}

export function RateLimitsWorkspace({ initial, filters }: { initial: Dashboard; filters: Filters }) {
  const router = useRouter();
  const data = initial;
  const [enabled, setEnabled] = useState(initial.config.enabled);
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => router.refresh();

  async function saveConfig(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await send("/api/platform/rate-limits", "POST", { action: "config", enabled });
      setMessage({ tone: "success", text: `Global rate limiting ${enabled ? "enabled" : "disabled"}.` });
      refresh();
    } catch (reason) {
      setMessage({ tone: "error", text: reason instanceof Error ? reason.message : "Could not save configuration." });
    } finally {
      setBusy(false);
    }
  }

  async function addPolicy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setMessage(null);
    try {
      await send("/api/platform/rate-limits", "POST", {
        action: "policy",
        policy: {
          category: String(form.get("category")),
          label: String(form.get("label")),
          scopeType: String(form.get("scopeType")),
          scopeValue: String(form.get("scopeValue")),
          enabled: true,
          requestsPerMinute: Number(form.get("rpm")),
          burst: Number(form.get("burst")),
          windowSeconds: 60,
          blockSeconds: 0,
        },
      });
      formElement.reset();
      refresh();
    } catch (reason) {
      setMessage({ tone: "error", text: reason instanceof Error ? reason.message : "Could not create override." });
    } finally {
      setBusy(false);
    }
  }

  async function addIpRule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setMessage(null);
    try {
      await send("/api/platform/rate-limits", "POST", {
        action: "ip-rule",
        address: String(form.get("address")),
        effect: String(form.get("effect")),
        reason: String(form.get("reason") ?? ""),
        expiresHours: form.get("effect") === "block" ? Number(form.get("expiresHours")) : undefined,
      });
      formElement.reset();
      refresh();
    } catch (reason) {
      setMessage({ tone: "error", text: reason instanceof Error ? reason.message : "Could not save IP rule." });
    } finally {
      setBusy(false);
    }
  }

  async function addBlock(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setMessage(null);
    try {
      await send("/api/platform/rate-limits", "POST", {
        action: "block",
        ip: String(form.get("ip")),
        reason: String(form.get("reason")),
        expiresMinutes: Number(form.get("expiresMinutes")),
      });
      formElement.reset();
      refresh();
    } catch (reason) {
      setMessage({ tone: "error", text: reason instanceof Error ? reason.message : "Could not block IP." });
    } finally {
      setBusy(false);
    }
  }

  async function remove(kind: "rule" | "block", id: string) {
    try {
      await send(`/api/platform/rate-limits/${encodeURIComponent(id)}?kind=${kind}`, "DELETE");
      refresh();
    } catch (reason) {
      setMessage({ tone: "error", text: reason instanceof Error ? reason.message : "Could not remove entry." });
    }
  }

  const time = (value: string | null) => value ? `${value.replace("T", " ").slice(0, 16)} UTC` : "Never";
  const policyRows = data.policies.filter((policy) => policy.scope_type === "global" || (policy.scope_type === "ip" && !policy.scope_value));
  const dateInput = (value?: string) => value ? value.slice(0, 16) : "";

  return (
    <div className="mt-5 space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Rate-limit overview">
        {[
          ["Protection", data.config.enabled ? "Enabled" : "Disabled", data.config.enabled ? "text-emerald-700" : "text-slate-600"],
          ["Violations · 24 hours", data.summary.violations24h, "text-slate-900"],
          ["Active IP blocks", data.blocks.length, "text-rose-700"],
          ["Enabled policies", data.summary.enabledPolicies, "text-slate-900"],
        ].map(([label, value, tone]) => (
          <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
            <p className={`mt-1 text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
          </div>
        ))}
      </section>

      <section className={`rounded-2xl border p-4 text-sm ${data.config.redisConfigured ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-950"}`} role={data.config.redisConfigured ? undefined : "alert"}>
        <strong>{data.config.redisConfigured ? "Distributed storage configured" : "Redis setup required"}</strong>
        <p className="mt-1">
          {data.config.redisConfigured
            ? "Requests are counted in managed Redis using atomic sliding windows and expiring counters."
            : "Rate limiting cannot be enabled until UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set in the server environment. No in-memory fallback is used."}
        </p>
        {data.config.enabled && !data.config.redisConfigured ? <p className="mt-1 font-semibold">Protection is enabled in the database but unavailable: API requests will fail closed with HTTP 503.</p> : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="font-semibold">Global protection</h2><p className="text-sm text-slate-600">Applies before every API route. Tenant, user, IP, role, and endpoint counters are evaluated atomically. Allowlisted addresses skip only the IP-specific limit; other limits and block rules still apply.</p></div>
          <form onSubmit={saveConfig} className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />{enabled ? "Enabled" : "Disabled"}</label>
            <button type="submit" className={`${button} bg-blue-700 text-white`} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          </form>
        </div>
        {message ? <div className="mt-3"><Notice tone={message.tone}>{message.text}</Notice></div> : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Policy configuration</h2>
        <p className="text-sm text-slate-600">Each category has independent platform, tenant, user, IP, role, and endpoint sliding windows. Burst is added to the per-window request allowance.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500"><tr><th className="pb-2">Policy</th><th className="pb-2">Requests / min</th><th className="pb-2">Burst</th><th className="pb-2">Window (sec)</th><th className="pb-2">Temp block (sec)</th><th className="pb-2">State</th><th className="pb-2">Action</th></tr></thead>
            <tbody>{policyRows.map((policy) => <PolicyRow key={`${policy.id}:${policy.requests_per_minute}:${policy.burst}:${policy.window_seconds}:${policy.block_seconds}:${policy.enabled}`} policy={policy} onSaved={refresh} />)}</tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Tenant, role, user, and endpoint overrides</h2>
        <form onSubmit={addPolicy} className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Field label="Category"><select className={inputClass} name="category" required>{RATE_LIMIT_CATEGORY_IDS.map((id) => <option key={id} value={id}>{CATEGORIES[id]}</option>)}</select></Field>
          <Field label="Override type"><select className={inputClass} name="scopeType" required><option value="tenant">Tenant ID</option><option value="user">User ID</option><option value="ip">Exact IP address</option><option value="role">Role</option><option value="endpoint">Exact API endpoint</option></select></Field>
          <Field label="Scope value" hint="Use an existing tenant ID, user ID, exact IP, role name, or exact /api/... path."><input className={inputClass} name="scopeValue" required maxLength={240} /></Field>
          <Field label="Label"><input className={inputClass} name="label" required maxLength={100} /></Field>
          <Field label="Requests / min"><input className={inputClass} name="rpm" type="number" min={1} max={100000} defaultValue={60} required /></Field>
          <Field label="Burst"><input className={inputClass} name="burst" type="number" min={0} max={100000} defaultValue={10} required /></Field>
          <button className={`${button} bg-slate-900 text-white sm:col-span-2 xl:col-span-6`} disabled={busy}>Add override</button>
        </form>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[650px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500"><tr><th className="pb-2">Override</th><th className="pb-2">Requests / min</th><th className="pb-2">Burst</th><th className="pb-2">Window (sec)</th><th className="pb-2">Temp block (sec)</th><th className="pb-2">State</th><th /></tr></thead>
            <tbody>{data.policies.filter((policy) => policy.scope_type !== "global").map((policy) => <PolicyRow key={`${policy.id}:${policy.requests_per_minute}:${policy.burst}:${policy.window_seconds}:${policy.block_seconds}:${policy.enabled}`} policy={policy} onSaved={refresh} />)}</tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">IP allowlist and blocklist</h2>
          <form onSubmit={addIpRule} className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="IP or CIDR"><input className={inputClass} name="address" placeholder="203.0.113.8 or 203.0.113.0/24" required /></Field>
            <Field label="Action"><select className={inputClass} name="effect"><option value="allow">Allowlist</option><option value="block">Blocklist (temporary)</option></select></Field>
            <Field label="Reason"><input className={inputClass} name="reason" maxLength={200} /></Field>
            <Field label="Blocklist expiry (hours)" hint="Required for blocklist entries; at most 30 days."><input className={inputClass} name="expiresHours" type="number" min={1} max={720} defaultValue={24} /></Field>
            <button className={`${button} bg-slate-900 text-white sm:col-span-2`} disabled={busy}>Save IP rule</button>
          </form>
          <ul className="mt-4 divide-y divide-slate-100 text-sm">
            {data.ipRules.length ? data.ipRules.map((rule) => (
              <li key={rule.id} className="flex items-center justify-between gap-3 py-2">
                <span><strong className="font-mono">{rule.address}</strong> · {rule.effect} · {rule.reason || "No reason"}<span className="block text-xs text-slate-500">Expires: {time(rule.expires_at)}</span></span>
                <button type="button" className={`${button} border border-slate-300`} onClick={() => remove("rule", rule.id)}>Remove</button>
              </li>
            )) : <li className="py-2 text-slate-500">No IP rules configured.</li>}
          </ul>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">Temporary IP blocks</h2>
          <form onSubmit={addBlock} className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="IP address"><input className={inputClass} name="ip" required /></Field>
            <Field label="Expires after (minutes)"><input className={inputClass} name="expiresMinutes" type="number" min={1} max={1440} defaultValue={60} required /></Field>
            <Field label="Reason"><input className={inputClass} name="reason" minLength={5} maxLength={200} required /></Field>
            <button className={`${button} self-end bg-rose-700 text-white`} disabled={busy}>Block temporarily</button>
          </form>
          <ul className="mt-4 divide-y divide-slate-100 text-sm">
            {data.blocks.length ? data.blocks.map((block) => (
              <li key={block.id} className="flex items-center justify-between gap-3 py-2">
                <span><strong className="font-mono">{block.ip}</strong> · {block.reason}<span className="block text-xs text-slate-500">Expires: {time(block.expires_at)}</span></span>
                <button type="button" className={`${button} border border-slate-300`} onClick={() => remove("block", block.id)}>Unblock</button>
              </li>
            )) : <li className="py-2 text-slate-500">No active temporary blocks.</li>}
          </ul>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_2fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">Tenant usage · violations, 24 hours</h2>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {data.tenantUsage.length ? data.tenantUsage.map((tenant) => (
              <li key={tenant.tenantId} className="flex justify-between gap-3 py-2"><span className="font-mono text-xs">{tenant.tenantId}</span><strong>{tenant.violations}</strong></li>
            )) : <li className="py-2 text-slate-500">No tenant violations recorded.</li>}
          </ul>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h2 className="font-semibold">Rate-limit violation history</h2><p className="text-xs text-slate-500">Latest 100 matching events. Sensitive request bodies and credentials are not logged.</p></div>
            <form method="get" className="flex flex-wrap gap-2">
              <input name="tenant" placeholder="Tenant ID" defaultValue={filters.tenant} className={`${inputClass} w-32`} />
              <input name="ip" placeholder="IP address" defaultValue={filters.ip} className={`${inputClass} w-32`} />
              <input name="endpoint" placeholder="Endpoint contains…" defaultValue={filters.endpoint} className={`${inputClass} w-40`} />
              <label className="flex items-center gap-1 text-xs text-slate-500">From<input name="from" type="datetime-local" defaultValue={dateInput(filters.from)} className={`${inputClass} w-44`} /></label>
              <label className="flex items-center gap-1 text-xs text-slate-500">To<input name="to" type="datetime-local" defaultValue={dateInput(filters.to)} className={`${inputClass} w-44`} /></label>
              <select name="eventType" defaultValue={filters.eventType} className={`${inputClass} w-36`}><option value="">All event types</option><option value="rate_limited">Rate limited</option><option value="blocked_ip">Blocked IP</option><option value="automatic_block">Automatic block</option></select>
              <button className={`${button} bg-slate-900 text-white`}>Filter</button>
            </form>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500"><tr><th className="pb-2">Time (UTC)</th><th className="pb-2">Tenant / User</th><th className="pb-2">IP</th><th className="pb-2">Endpoint</th><th className="pb-2">Policy / Limit</th><th className="pb-2">Action</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.events.length ? data.events.map((event) => (
                  <tr key={event.id} className="align-top">
                    <td className="whitespace-nowrap py-2 text-xs">{time(event.at)}</td>
                    <td className="py-2 font-mono text-xs">{event.tenant_id ?? "—"}<span className="block text-slate-500">{event.user_id ?? "anonymous"}</span></td>
                    <td className="py-2 font-mono text-xs">{event.ip}</td>
                    <td className="py-2 text-xs"><span>{event.method} {event.endpoint}</span></td>
                    <td className="py-2 text-xs">{event.policy}<span className="block text-slate-500">{event.limit_exceeded || "blocklist"} requests</span></td>
                    <td className="py-2 text-xs">{event.action}{event.block_expires_at ? <span className="block text-slate-500">until {time(event.block_expires_at)}</span> : null}</td>
                  </tr>
                )) : <tr><td colSpan={6} className="py-3 text-slate-500">No matching rate-limit events.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
