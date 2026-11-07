import { PlatformShell } from "@/components/platform/platform-shell";
import { platformQuery } from "@/lib/db/database";
import { paystackConfig } from "@/lib/billing/config";
import { requirePlatformPage } from "@/lib/platform/pages";
import { secretsAvailable } from "@/lib/platform/secrets";
import { describePlatformSetting, lastChecks } from "@/lib/platform/settings";

import { PaystackSettingsForm } from "./paystack-form";

export const metadata = { title: "Payment gateway · Web365 platform" };

export default async function PaymentGatewayPage() {
  const actor = await requirePlatformPage("billing.manage");
  const [setting, checks, active, webhooks, transactions] = await Promise.all([
    describePlatformSetting("payments.paystack"),
    lastChecks("paystack"),
    paystackConfig(),
    platformQuery<Array<{ event_type: string; reference: string | null; received_at: Date; processed_at: Date | null; result: string | null }>>((query) =>
      query(`SELECT event_type, reference, received_at, processed_at, result FROM webhook_events WHERE provider = 'paystack' ORDER BY received_at DESC LIMIT 20`),
    ),
    platformQuery<Array<{ reference: string; tenant: string; amount: string; currency: string; status: string; created_at: Date; settled_by: string | null }>>((query) =>
      query(`SELECT b.reference, t.name AS tenant, b.amount, b.currency, b.status, b.created_at, b.settled_by FROM billing_payments b JOIN tenants t ON t.id = b.tenant_id ORDER BY b.created_at DESC LIMIT 50`),
    ),
  ]);
  const base = (process.env.APP_URL || process.env.NEXTAUTH_URL || "").replace(/\/$/, "");
  const time = (value: Date | string | null) => (value ? new Date(value).toISOString().replace("T", " ").slice(0, 16) : "—");
  return (
    <PlatformShell actor={actor}>
      <h1 className="text-2xl font-bold">Payment gateway</h1>
      <p className="text-sm text-slate-600">Paystack is the payment provider for subscriptions. Other providers (such as Flutterwave) can be added to the same interface later.</p>
      {!secretsAvailable() ? <p role="alert" className="mt-3 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">Secret storage is not set up on this server (SETTINGS_ENCRYPTION_KEY). Keys cannot be saved until it is.</p> : null}

      <section className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-2">
          <PaystackSettingsForm setting={JSON.parse(JSON.stringify(setting))} />
        </div>
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm" data-gateway-status>
            <h2 className="font-semibold">In use now</h2>
            <p className="mt-1">{active.source === "none" ? "No keys: online payment is off." : `${active.mode === "live" ? "Live" : "Test"} mode, keys from ${active.source === "settings" ? "these settings" : "the server environment"}.`}</p>
            <p className="mt-2 text-slate-600">Last test: {checks.last ? `${checks.last.ok ? "succeeded" : "failed"} at ${time(checks.last.at)} UTC — ${checks.last.detail}` : "never run"}</p>
            <p className="text-slate-600">Last success: {checks.lastSuccessAt ? `${time(checks.lastSuccessAt)} UTC` : "—"}</p>
            {checks.lastError ? <p className="text-rose-700">Last error: {checks.lastError.detail} ({time(checks.lastError.at)} UTC)</p> : null}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm">
            <h2 className="font-semibold">Set in the Paystack dashboard</h2>
            <p className="mt-1 text-slate-600">Webhook URL</p>
            <code className="block break-all rounded bg-slate-100 p-2 text-xs">{base ? `${base}/api/billing/webhooks/paystack` : "Set APP_URL on the server first"}</code>
            <p className="mt-2 text-slate-600">Callback URL (sent with each payment)</p>
            <code className="block break-all rounded bg-slate-100 p-2 text-xs">{base ? `${base}/billing/callback` : "Set APP_URL on the server first"}</code>
            <p className="mt-2 text-xs text-slate-500">Paystack signs webhooks with your secret key; it has no separate webhook secret. Signatures are checked on every webhook.</p>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Recent webhooks</h2>
        <table className="mt-2 w-full text-sm" data-webhook-log>
          <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Received (UTC)</th><th>Event</th><th>Reference</th><th>Result</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {webhooks.length === 0 ? <tr><td colSpan={4} className="py-2 text-slate-500">None received yet.</td></tr> : webhooks.map((event, index) => (
              <tr key={index}><td className="py-1">{time(event.received_at)}</td><td>{event.event_type}</td><td className="font-mono text-xs">{event.reference ?? "—"}</td><td>{event.processed_at ? event.result : <span className="text-amber-700">{event.result ?? "not processed"}</span>}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Recent transactions</h2>
        <table className="mt-2 w-full text-sm" data-transactions>
          <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Started (UTC)</th><th>Pharmacy</th><th>Amount</th><th>Status</th><th>Confirmed by</th><th>Reference</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {transactions.length === 0 ? <tr><td colSpan={6} className="py-2 text-slate-500">No payments yet.</td></tr> : transactions.map((row) => (
              <tr key={row.reference}><td className="py-1">{time(row.created_at)}</td><td>{row.tenant}</td><td>{row.currency} {Number(row.amount).toLocaleString("en-NG")}</td><td>{row.status.toLowerCase()}</td><td>{row.settled_by ?? "—"}</td><td className="font-mono text-xs">{row.reference}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Change history</h2>
        <ul className="mt-2 divide-y divide-slate-100 text-sm" data-settings-history>
          {setting.history.length === 0 ? <li className="py-2 text-slate-500">No changes yet.</li> : setting.history.map((entry, index) => (
            <li key={index} className="py-2"><span className="text-slate-500">{time(entry.at)} UTC · {entry.by}</span><span className="block">{entry.changes.join("; ")}</span></li>
          ))}
        </ul>
      </section>
    </PlatformShell>
  );
}
