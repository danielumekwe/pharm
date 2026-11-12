"use client";

import { CheckCircle2, HardDriveDownload, Loader2, ShieldAlert, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { ActionButton, Field, FormError, SelectInput, TextInput } from "@/components/erp/fields";
import { Panel } from "@/components/erp/stat-card";
import { downloadPackage, forgetDevice, localStatus, offlineSupported, provisionDevice, type LocalStatus } from "@/lib/offline/device";
import { PIN_PATTERN } from "@/lib/offline/crypto";

export type OfflineSetupProps = {
  tenantId: string;
  tenantName: string;
  user: { id: string; name: string; role: string };
  outlets: { id: string; name: string }[];
  defaultOutletId: string;
  policy: { enabled: boolean; sessionHours: number };
};

const noSubscription = () => () => {};
const when = (value: string | null | undefined) => (value ? new Date(value).toLocaleString("en-NG") : "—");

function guessDeviceName() {
  const agent = navigator.userAgent;
  const platform = /Android/.test(agent) ? "Android" : /iPhone|iPad/.test(agent) ? "iPhone/iPad" : /Windows/.test(agent) ? "Windows PC" : /Macintosh/.test(agent) ? "Mac" : "Device";
  return `${platform} (${/Edg\//.test(agent) ? "Edge" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : /Firefox\//.test(agent) ? "Firefox" : "browser"})`;
}

export function OfflineSetup({ tenantId, tenantName, user, outlets, defaultOutletId, policy }: OfflineSetupProps) {
  const [status, setStatus] = useState<LocalStatus | null>(null);
  const supported = useSyncExternalStore(noSubscription, offlineSupported, () => true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(() => ({ name: typeof navigator === "undefined" ? "" : guessDeviceName(), outletId: defaultOutletId, pin: "", confirm: "" }));

  const refresh = useCallback(async () => {
    const next = offlineSupported() ? await localStatus(tenantId, user.id) : null;
    setStatus(next);
  }, [tenantId, user.id]);

  useEffect(() => {
    queueMicrotask(() => void refresh());
    const update = () => void refresh();
    window.addEventListener("pharmaerp:offline-updated", update);
    return () => window.removeEventListener("pharmaerp:offline-updated", update);
  }, [refresh]);

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  function provision() {
    if (!PIN_PATTERN.test(form.pin)) return setError("Choose a PIN of 6 to 8 digits.");
    if (form.pin !== form.confirm) return setError("The two PINs do not match.");
    const outlet = outlets.find((entry) => entry.id === form.outletId);
    if (!outlet) return setError("Choose the outlet this device works at.");
    void run(() => provisionDevice({ tenantId, tenantName, userId: user.id, userName: user.name, role: user.role, outletId: outlet.id, outletName: outlet.name, deviceName: form.name, pin: form.pin, platform: guessDeviceName() }));
    setForm((current) => ({ ...current, pin: "", confirm: "" }));
  }

  const device = status?.device;
  return (
    <Panel title="Offline use on this device" description="Set this device up while online. PharmaERP then keeps your outlet's products and stock on it, so it can open without internet.">
      {!supported ? (
        <p className="text-sm text-amber-200">This browser cannot store data for offline use. Use a current Chrome, Edge, Safari or Firefox, or the installed app.</p>
      ) : !policy.enabled ? (
        <p className="text-sm text-amber-200">Offline use is switched off for {tenantName}. A Super Admin can enable it under Settings → Offline Mode &amp; Devices.</p>
      ) : !status ? (
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      ) : device ? (
        <div className="space-y-4" data-offline-ready={status.ready ? "yes" : "no"}>
          <div className={`flex items-start gap-3 rounded-xl border p-3 ${status.ready ? "border-emerald-500/30 bg-emerald-500/10" : "border-amber-500/30 bg-amber-500/10"}`}>
            {status.ready ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-400" /> : <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-400" />}
            <div className="text-sm">
              <p className="font-medium text-white">{status.ready ? "Ready for offline use" : status.expired ? "Offline access has expired" : "Not ready yet: the offline data has not been downloaded"}</p>
              <p className="text-slate-300">
                {status.ready
                  ? `Offline access lasts until ${when(device.validUntil)} and is renewed automatically whenever this device is online.`
                  : status.expired
                    ? "Connect to the internet; the data and access are renewed automatically."
                    : "Connect to the internet and download the data."}
              </p>
            </div>
          </div>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {[
              ["Device name", device.name],
              ["Device ID", device.deviceId],
              ["Assigned user", device.userName],
              ["Assigned outlet", device.outletName],
              ["Last successful download", when(device.lastPackageAt)],
              ["Permissions last refreshed", when(device.lastPackageAt)],
              ["Local data", `${status.counts.products.toLocaleString()} products · ${status.counts.batches.toLocaleString()} batches · ${status.counts.barcodes.toLocaleString()} barcodes · ${status.counts.customers.toLocaleString()} customers`],
              ["Waiting to upload", status.pending ? `${status.pending} operation(s)` : "Nothing"],
              ["Last refresh", status.lastDownload ? `${when(status.lastDownload.at)} · ${status.lastDownload.mode === "delta" ? `only changes (${status.lastDownload.products} updated, ${status.lastDownload.removed} removed)` : "full download"}` : "—"],
              ["Storage", status.persisted ? "Kept permanently by the browser" : "The browser may clear it if space runs low (install the app to keep it)"],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs uppercase tracking-wider text-slate-500">{label}</dt>
                <dd className="break-all text-slate-100">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="rounded-xl border border-slate-800 p-3 text-sm text-slate-300">
            <p className="font-medium text-white">Available offline in this version</p>
            <p>Unlock with your PIN when there is no internet: the till (cash, card and transfer sales, receipts, drafts), stock receiving, new products and stock adjustments (by permission), and dated stock, expiry and sales reports. Everything uploads automatically when the connection returns.</p>
          </div>
          <FormError message={error} />
          <div className="flex flex-wrap gap-2">
            <ActionButton tone="secondary" disabled={busy} onClick={() => void run(() => downloadPackage(tenantId, user.id))}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <HardDriveDownload className="h-4 w-4" />} Download latest data
            </ActionButton>
            <ActionButton
              tone="danger"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Remove this device from offline use? Its stored data and PIN are deleted. Work that has not been uploaded is kept until it is.")) void run(() => forgetDevice(tenantId, user.id));
              }}
            >
              <Trash2 className="h-4 w-4" /> Remove this device
            </ActionButton>
          </div>
          <p className="text-xs text-slate-500">Data is refreshed automatically when this device is online; the download button is only for checking.</p>
        </div>
      ) : (
        <div className="space-y-4" data-offline-ready="no">
          <p className="text-sm text-slate-300">
            This device is not set up for offline use yet. Choose a name, your outlet and a 6–8 digit PIN. The PIN unlocks PharmaERP on this device when there is no internet; it is never sent to the server. Offline access expires after {policy.sessionHours} hours without a connection.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Device name">
              <TextInput value={form.name} maxLength={60} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </Field>
            <Field label="Outlet">
              <SelectInput value={form.outletId} onChange={(event) => setForm({ ...form, outletId: event.target.value })} options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} />
            </Field>
            <Field label="Offline PIN (6–8 digits)">
              <TextInput type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={form.pin} onChange={(event) => setForm({ ...form, pin: event.target.value.replace(/\D/g, "") })} />
            </Field>
            <Field label="Repeat PIN">
              <TextInput type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={form.confirm} onChange={(event) => setForm({ ...form, confirm: event.target.value.replace(/\D/g, "") })} />
            </Field>
          </div>
          <FormError message={error} />
          <ActionButton onClick={provision} disabled={busy} data-provision>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <HardDriveDownload className="h-4 w-4" />} Set up offline use
          </ActionButton>
        </div>
      )}
    </Panel>
  );
}
