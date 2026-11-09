"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Field, inputClass, Notice } from "@/components/auth-card";

import { button, Empty, StatusBadge, table } from "./ui";

type Message = { tone: "success" | "error"; text: string } | null;

async function send(url: string, method: string, body?: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as { error?: string; ok?: boolean; refund?: { status: string; error: string | null } };
  if (!response.ok) throw new Error(data.error ?? "Request failed.");
  return data;
}

type Profile = { businessName: string; businessEmail: string; businessPhone: string; address: string; country: string; state: string; currency: string; timeZone: string };

export function ProfileEditor({ tenantId, profile, countries, currencies, states }: { tenantId: string; profile: Profile; countries: { code: string; name: string }[]; currencies: string[]; states: string[] }) {
  const router = useRouter();
  const [value, setValue] = useState(profile);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const form = useRef<HTMLFormElement>(null);
  const set = (patch: Partial<Profile>) => setValue({ ...value, ...patch });
  // The header's "Edit details" button opens this form.
  useEffect(() => {
    const open = () => setEditing(true);
    window.addEventListener("tenant-edit", open);
    return () => window.removeEventListener("tenant-edit", open);
  }, []);
  useEffect(() => {
    if (editing) form.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [editing]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    try {
      await send(`/api/platform/tenants/${tenantId}`, "PATCH", { action: "update-profile", profile: value });
      setMessage({ tone: "success", text: "Saved." });
      setEditing(false);
      router.refresh();
    } catch (error) {
      setMessage({ tone: "error", text: (error as Error).message });
    }
  }
  if (!editing) {
    return (
      <div>
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <button type="button" onClick={() => setEditing(true)} className={`${button.secondary} mt-4`}>Edit details</button>
      </div>
    );
  }
  return (
    <form ref={form} onSubmit={save} className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-slate-50/50 p-4 sm:grid-cols-2" data-profile-editor>
      <Field label="Pharmacy name"><input className={inputClass} value={value.businessName} onChange={(event) => set({ businessName: event.target.value })} /></Field>
      <Field label="Business email"><input type="email" className={inputClass} value={value.businessEmail} onChange={(event) => set({ businessEmail: event.target.value })} /></Field>
      <Field label="Phone"><input className={inputClass} value={value.businessPhone} onChange={(event) => set({ businessPhone: event.target.value })} /></Field>
      <Field label="Address"><input className={inputClass} value={value.address} onChange={(event) => set({ address: event.target.value })} /></Field>
      <Field label="Country"><select className={inputClass} value={value.country} onChange={(event) => set({ country: event.target.value })}>{countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}</select></Field>
      <Field label="State">
        {value.country === "NG" ? <select className={inputClass} value={value.state} onChange={(event) => set({ state: event.target.value })}><option value="">Choose…</option>{states.map((state) => <option key={state}>{state}</option>)}</select>
          : <input className={inputClass} value={value.state} onChange={(event) => set({ state: event.target.value })} />}
      </Field>
      <Field label="Currency"><select className={inputClass} value={value.currency} onChange={(event) => set({ currency: event.target.value })}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></Field>
      <Field label="Time zone"><input className={inputClass} value={value.timeZone} onChange={(event) => set({ timeZone: event.target.value })} /></Field>
      {message ? <div className="sm:col-span-2"><Notice tone={message.tone}>{message.text}</Notice></div> : null}
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className={button.primary}>Save details</button>
        <button type="button" onClick={() => { setEditing(false); setValue(profile); }} className={button.secondary}>Cancel</button>
      </div>
    </form>
  );
}

type Closure = { id: string; requestedBy: string; requestedAt: string; reason: string; status: string; decidedBy: string | null; decidedAt: string | null; note: string | null; purgeAfter: string | null };

export function ClosureRequests({ tenantId, requests, canDecide, retentionDays }: { tenantId: string; requests: Closure[]; canDecide: boolean; retentionDays: number }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  async function decide(requestId: string, decision: "approve" | "reject") {
    if (decision === "approve" && !window.confirm(`Close this pharmacy? Nobody will be able to sign in. Its data is kept for ${retentionDays} days.`)) return;
    setBusy(true);
    setMessage(null);
    try {
      await send(`/api/platform/tenants/${tenantId}`, "PATCH", { action: "closure", requestId, decision, note });
      setMessage({ tone: "success", text: decision === "approve" ? "The pharmacy is closed." : "The request was declined; the owner has been told." });
      router.refresh();
    } catch (error) {
      setMessage({ tone: "error", text: (error as Error).message });
    }
    setBusy(false);
  }
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
  return (
    <div data-closure-requests>
      {requests.length === 0 ? <Empty>No closure has been requested.</Empty> : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
          {requests.map((request) => (
            <li key={request.id} className="px-4 py-3" data-closure={request.status}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p><span className="font-medium text-slate-900">{request.requestedBy}</span> <span className="text-slate-500">asked on {day(request.requestedAt)}</span></p>
                <StatusBadge status={request.status} />
              </div>
              <p className="mt-1 text-slate-800">{request.reason}</p>
              <p className="mt-1 text-slate-500">
                {request.status === "REQUESTED" ? "Waiting for a decision." : `${request.status.toLowerCase()}${request.decidedBy ? ` by ${request.decidedBy}` : ""} on ${day(request.decidedAt)}${request.note ? ` — ${request.note}` : ""}${request.purgeAfter ? `. Data kept until ${day(request.purgeAfter)}.` : ""}`}
              </p>
              {request.status === "REQUESTED" && canDecide ? (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input className={`${inputClass} h-10`} placeholder="Note (required to decline; sent to the owner)" value={note} onChange={(event) => setNote(event.target.value)} />
                  <button type="button" disabled={busy} onClick={() => void decide(request.id, "reject")} className={`${button.secondary} shrink-0`}>Decline</button>
                  <button type="button" disabled={busy} onClick={() => void decide(request.id, "approve")} className={`${button.danger} shrink-0`}>Close the pharmacy</button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {message ? <div className="mt-2"><Notice tone={message.tone}>{message.text}</Notice></div> : null}
      <p className="mt-3 text-xs text-slate-500">Closing stops all sign-ins and cancels the subscription. Data is kept for {retentionDays} days (subscription policy); deleting it is a separate step.</p>
    </div>
  );
}

type Refund = { id: string; reference: string | null; amount: number; currency: string; reason: string; status: string; requestedBy: string; requestedById: string; requestedAt: string; decidedBy: string | null; note: string | null; providerStatus: string | null; error: string | null; processedAt: string | null };
const money = (currency: string, value: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);

/** Request a refund on a successful payment. */
export function RefundButton({ paymentId, remaining, currency }: { paymentId: string; remaining: number; currency: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(remaining);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (remaining <= 0) return <span className="ml-2 text-xs text-slate-500">fully refunded</span>;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="ml-2 rounded border border-slate-300 px-2 py-0.5 text-xs" data-refund-open>Refund…</button>;
  async function submit() {
    setError(null);
    try {
      await send("/api/platform/refunds", "POST", { paymentId, amount, reason });
      setOpen(false);
      router.refresh();
    } catch (failure) {
      setError((failure as Error).message);
    }
  }
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1" data-refund-form>
      <input type="number" step="0.01" min={0.01} max={remaining} className="w-28 rounded border border-slate-300 px-2 py-1 text-xs" value={amount} onChange={(event) => setAmount(Number(event.target.value))} aria-label={`Amount (${currency})`} />
      <input className="w-56 rounded border border-slate-300 px-2 py-1 text-xs" placeholder="Reason (required)" value={reason} onChange={(event) => setReason(event.target.value)} />
      <button type="button" onClick={() => void submit()} className="rounded bg-slate-900 px-2 py-1 text-xs font-semibold text-white">Request refund</button>
      <button type="button" onClick={() => setOpen(false)} className="rounded border border-slate-300 px-2 py-1 text-xs">Cancel</button>
      {error ? <span className="w-full text-xs text-rose-700">{error}</span> : null}
    </div>
  );
}

export function RefundList({ refunds, actorId, canDecide, twoPerson }: { refunds: Refund[]; actorId: string; canDecide: boolean; twoPerson: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<Message>(null);
  async function act(refund: Refund, path: string, body?: unknown) {
    setMessage(null);
    try {
      const result = await send(`/api/platform/refunds/${refund.id}${path}`, "POST", body);
      setMessage(result.refund?.error ? { tone: "error", text: result.refund.error } : { tone: "success", text: "Done." });
      router.refresh();
    } catch (error) {
      setMessage({ tone: "error", text: (error as Error).message });
    }
  }
  if (!refunds.length) return null;
  return (
    <div className="border-t border-slate-100 px-5 py-4" data-refunds>
      <h3 className="text-sm font-semibold text-slate-900">Refunds</h3>
      <div className={`${table.wrap} mt-2 rounded-lg border border-slate-200`}>
      <table className={table.table}>
        <thead className={table.head}><tr><th className={table.th}>Requested</th><th className={table.th}>Payment</th><th className={table.th}>Amount</th><th className={table.th}>Reason</th><th className={table.th}>Status</th><th className={table.th} /></tr></thead>
        <tbody className={table.body}>
          {refunds.map((refund) => (
            <tr key={refund.id} data-refund={refund.status} className="align-top">
              <td className={table.td}>{refund.requestedAt.slice(0, 10)}<span className="block text-xs text-slate-500">{refund.requestedBy}</span></td>
              <td className={`${table.td} font-mono text-xs`}>{refund.reference}</td>
              <td className={table.td}>{money(refund.currency, refund.amount)}</td>
              <td className={table.td}>{refund.reason}{refund.note ? <span className="block text-xs text-slate-500">{refund.decidedBy}: {refund.note}</span> : null}</td>
              <td className={table.td}><StatusBadge status={refund.status} />{refund.error ? <span className="mt-1 block text-xs text-rose-700">{refund.error}</span> : null}</td>
              <td className={`${table.td} space-x-1 whitespace-nowrap`}>
                {refund.status === "REQUESTED" && canDecide ? (
                  twoPerson && refund.requestedById === actorId ? <span className="text-xs text-slate-500">needs another approver</span> : (
                    <>
                      <button type="button" onClick={() => void act(refund, "", { decision: "approve", note })} className="rounded bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white" data-refund-approve>Approve and send</button>
                      <button type="button" onClick={() => void act(refund, "", { decision: "reject", note })} className="rounded border border-slate-300 px-2 py-0.5 text-xs">Reject</button>
                    </>
                  )
                ) : null}
                {refund.status === "PENDING" && canDecide ? <button type="button" onClick={() => void act(refund, "/sync")} className="rounded border border-slate-300 px-2 py-0.5 text-xs">Check with Paystack</button> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {canDecide && refunds.some((refund) => refund.status === "REQUESTED") ? <input className={`${inputClass} mt-2`} placeholder="Note for your decision (required to reject)" value={note} onChange={(event) => setNote(event.target.value)} /> : null}
      {message ? <div className="mt-2"><Notice tone={message.tone}>{message.text}</Notice></div> : null}
    </div>
  );
}
