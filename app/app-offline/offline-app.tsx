"use client";

import { CloudOff, Lock, Minus, Plus, Printer, RefreshCw, Save, ScanLine, Trash2, Wifi } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { usePwa } from "@/components/pwa/pwa-client";
import type { DiscountInput } from "@/lib/erp/sale-pricing";
import { profileIndex, type DeviceRecord, type Profile } from "@/lib/offline/db";
import { deviceFor, OfflineError, unlockOffline } from "@/lib/offline/device";
import { getServerSyncState, getSyncState, refreshCounts, requestSync, subscribeSync } from "@/lib/offline/sync";
import { isNativeApp, nativeScan } from "@/lib/native";

import { ReportsView } from "./reports-view";
import { StockForms } from "./stock-forms";
import { availableUnits, checkCart, completeOfflineSale, deleteDraft, levelForBarcode, listDrafts, offlineSales, packPriceOf, saveDraft, searchProducts, type CartLine, type OfflineProduct, type OfflineSale, type SaleCheck, type Tender } from "@/lib/offline/till";

const naira = (value: number) => `₦${value.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (value?: string | null) => (value ? new Date(value).toLocaleString("en-NG") : "—");
const noSubscription = () => () => {};
const STATUS_LABEL: Record<string, string> = { pending: "Waiting to upload", uploading: "Uploading", failed: "Retrying", synced: "Uploaded", conflict: "Needs reconciliation", attention: "Needs attention" };

export function OfflineApp() {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [chosen, setChosen] = useState<Profile | null>(null);
  const [record, setRecord] = useState<DeviceRecord | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pwa = usePwa();

  // Not set up on this device: behave like the plain offline page and reopen PharmaERP once online.
  useEffect(() => {
    if (profiles?.length !== 0) return;
    const reopen = () => window.location.replace("/dashboard");
    window.addEventListener("pharmaerp:connection-restored", reopen);
    return () => window.removeEventListener("pharmaerp:connection-restored", reopen);
  }, [profiles]);

  useEffect(() => {
    profileIndex()
      .profiles.toArray()
      .then((list) => {
        setProfiles(list);
        if (list.length === 1) setChosen(list[0]);
      })
      .catch(() => setProfiles([]));
  }, []);

  async function unlock() {
    if (!chosen) return;
    setError(null);
    try {
      await unlockOffline(chosen.tenantId, chosen.userId, pin);
      setRecord((await deviceFor(chosen.tenantId, chosen.userId)) ?? null);
    } catch (reason) {
      setError(reason instanceof OfflineError ? reason.message : "This device could not be unlocked.");
    } finally {
      setPin("");
    }
  }

  if (record) return <Till record={record} onLock={() => setRecord(null)} />;

  return (
    <main className="grid min-h-screen place-items-center bg-[#f6faf7] p-4 text-slate-900">
      <div className="w-full max-w-sm rounded-3xl border border-emerald-100 bg-white p-7 text-center shadow-xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/pharma-erp-logo.png" alt="PharmaERP" className="mx-auto h-auto w-44" />
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
          {pwa.connection === "offline" ? <CloudOff className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5" />} {pwa.connection === "offline" ? "Working offline" : "Offline till"}
        </p>
        {profiles === null ? (
          <p className="mt-6 text-sm text-slate-500">Loading…</p>
        ) : profiles.length === 0 ? (
          <div className="mt-5 space-y-3 text-sm text-slate-600">
            <h1 className="text-lg font-bold text-slate-900">This device is not set up for offline use</h1>
            <p>While online, sign in and open Settings → Install PharmaERP → “Set up offline use”. Until then PharmaERP needs an internet connection.</p>
            {pwa.connection !== "offline" ? <a href="/dashboard" className="inline-block rounded-full bg-[#188030] px-5 py-2.5 font-semibold text-white">Open PharmaERP</a> : <p className="text-xs">PharmaERP reopens automatically when the connection is back.</p>}
          </div>
        ) : (
          <form
            className="mt-5 space-y-3 text-left"
            onSubmit={(event) => {
              event.preventDefault();
              void unlock();
            }}
          >
            {profiles.length > 1 ? (
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Account</span>
                <select className="h-10 rounded-lg border border-slate-300 px-2" value={chosen?.dbName ?? ""} onChange={(event) => setChosen(profiles.find((profile) => profile.dbName === event.target.value) ?? null)}>
                  <option value="">Choose…</option>
                  {profiles.map((profile) => (
                    <option key={profile.dbName} value={profile.dbName}>
                      {profile.userName} · {profile.tenantName} · {profile.outletName}
                    </option>
                  ))}
                </select>
              </label>
            ) : chosen ? (
              <p className="text-center text-sm text-slate-600">
                <span className="font-semibold text-slate-900">{chosen.userName}</span>
                <br />
                {chosen.tenantName} · {chosen.outletName}
              </p>
            ) : null}
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Offline PIN</span>
              <input autoFocus type="password" inputMode="numeric" autoComplete="current-password" maxLength={8} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} className="h-11 rounded-lg border border-slate-300 px-3 text-center text-lg tracking-[0.4em]" data-offline-pin />
            </label>
            {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
            <button type="submit" disabled={!chosen || pin.length < 6} className="h-11 w-full rounded-full bg-[#188030] font-semibold text-white disabled:opacity-50" data-offline-unlock>
              Unlock
            </button>
            {chosen?.validUntil ? <p className="text-center text-xs text-slate-500">Offline access valid until {when(chosen.validUntil)}</p> : null}
            {pwa.connection !== "offline" ? (
              <p className="text-center text-xs">
                <a href="/dashboard" className="text-[#188030] underline">Online? Open full PharmaERP</a>
              </p>
            ) : null}
          </form>
        )}
      </div>
    </main>
  );
}

type Line = CartLine & { key: string };

function Till({ record, onLock }: { record: DeviceRecord; onLock: () => void }) {
  const pwa = usePwa();
  const native = useSyncExternalStore(noSubscription, isNativeApp, () => false);
  const sync = useSyncExternalStore(subscribeSync, getSyncState, getServerSyncState);
  const [tab, setTab] = useState<"till" | "sales" | "drafts" | "stock" | "reports">(record.permissions.includes("sales.create") ? "till" : "stock");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<(OfflineProduct & { units: number })[]>([]);
  const [catalogue, setCatalogue] = useState<Record<string, OfflineProduct>>({});
  const [cart, setCart] = useState<Line[]>([]);
  const [basketPct, setBasketPct] = useState(0);
  const [tender, setTender] = useState<{ method: Tender["method"]; amount: string; reference: string }>({ method: "Cash", amount: "", reference: "" });
  const [rx, setRx] = useState("");
  const [check, setCheck] = useState<SaleCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<OfflineSale | null>(null);
  const [sales, setSales] = useState<OfflineSale[]>([]);
  const [drafts, setDrafts] = useState<Awaited<ReturnType<typeof listDrafts>>>([]);
  const globalDiscount: DiscountInput | undefined = basketPct > 0 ? { type: "percent", value: basketPct } : undefined;

  const reload = useCallback(async () => {
    setSales(await offlineSales(record));
    setDrafts(await listDrafts(record));
    await refreshCounts(record);
  }, [record]);

  // Upload automatically: now, when the connection returns, and every 30 s while work is waiting.
  useEffect(() => {
    const go = () => void requestSync(record).then(reload);
    queueMicrotask(() => {
      void reload();
      go();
    });
    window.addEventListener("pharmaerp:connection-restored", go);
    const onMessage = (event: MessageEvent) => event.data === "pharmaerp:sync" && go();
    navigator.serviceWorker?.addEventListener("message", onMessage);
    const timer = setInterval(() => getSyncState().pending > 0 && go(), 30_000);
    return () => {
      window.removeEventListener("pharmaerp:connection-restored", go);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
      clearInterval(timer);
    };
  }, [record, reload]);

  useEffect(() => {
    let cancelled = false;
    void searchProducts(record, query).then(async (found) => {
      const withUnits = await Promise.all(found.map(async (product) => ({ ...product, units: await availableUnits(record, product.id) })));
      if (!cancelled) {
        setResults(withUnits);
        setCatalogue((current) => ({ ...current, ...Object.fromEntries(found.map((product) => [product.id, product])) }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [record, query, sales]);

  useEffect(() => {
    let cancelled = false;
    void checkCart(record, cart, globalDiscount).then((result) => !cancelled && setCheck(result));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, cart, basketPct, sales]);

  function add(product: OfflineProduct, packagingId?: string) {
    const level = packagingId ?? product.packaging.find((row) => row.isBase && row.sellable)?.id ?? product.packaging.find((row) => row.sellable)?.id ?? product.packaging[0]?.id;
    if (!level) return;
    setCart((current) => {
      const existing = current.find((line) => line.productId === product.id && line.packagingId === level);
      if (existing) return current.map((line) => (line === existing ? { ...line, quantity: line.quantity + 1 } : line));
      return [...current, { key: crypto.randomUUID(), productId: product.id, packagingId: level, quantity: 1 }];
    });
  }

  async function scanWithCamera() {
    try {
      const code = await nativeScan();
      if (code) await addByCode(code);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  async function scan(event: React.FormEvent) {
    event.preventDefault();
    await addByCode(query.trim());
  }

  async function addByCode(raw: string) {
    const code = raw.trim();
    if (!code) return;
    const found = await searchProducts(record, code, 2);
    const exact = found.find((product) => product.barcodes.includes(code)) ?? (found.length === 1 ? found[0] : undefined);
    if (exact) {
      add(exact, exact.barcodes.includes(code) ? levelForBarcode(exact, code) : undefined);
      setQuery("");
    }
  }

  async function complete() {
    if (!check) return;
    setError(null);
    const amount = Number(tender.amount || check.total);
    try {
      const sale = await completeOfflineSale(record, { cart, globalDiscount, payments: [{ method: tender.method, amount, reference: tender.reference }], prescriptionRef: rx });
      setReceipt(sale);
      setCart([]);
      setBasketPct(0);
      setTender({ method: "Cash", amount: "", reference: "" });
      setRx("");
      await reload();
      void requestSync(record).then(reload);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  const syncLabel = useMemo(() => {
    if (sync.phase === "uploading") return `Uploading ${sync.done}/${sync.total}…`;
    if (sync.phase === "signin") return "Sign in to upload";
    if (sync.phase === "revoked") return "Device revoked";
    if (sync.pending) return `${sync.pending} waiting to upload`;
    if (sync.conflicts || sync.attention) return `${sync.conflicts + sync.attention} need review`;
    return sync.lastSyncAt ? `All uploaded · ${new Date(sync.lastSyncAt).toLocaleTimeString()}` : "Nothing to upload";
  }, [sync]);

  if (sync.phase === "revoked") {
    return (
      <main className="grid min-h-screen place-items-center p-6 text-center">
        <div className="max-w-sm space-y-3">
          <h1 className="text-lg font-bold">This device was removed from offline use</h1>
          <p className="text-sm text-slate-600">{sync.message} Its stored data has been removed. Sign in online to continue.</p>
          <a href="/login" className="inline-block rounded-full bg-[#188030] px-5 py-2.5 font-semibold text-white">Sign in</a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900" data-offline-till>
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5 print:hidden">
        <div className="mr-auto">
          <p className="text-sm font-bold">{record.tenantName} · {record.outletName}</p>
          <p className="text-xs text-slate-500">{record.userName} · permissions as of {when(record.lastPackageAt)}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${pwa.connection === "offline" ? "border-amber-300 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`} data-connection={pwa.connection}>
          {pwa.connection === "offline" ? <CloudOff className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5" />}
          {pwa.connection === "offline" ? "Offline" : pwa.connection === "restored" ? "Connection restored" : "Online"}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-xs" data-sync-phase={sync.phase} data-pending={sync.pending}>
          <RefreshCw className={`h-3.5 w-3.5 ${sync.phase === "uploading" ? "animate-spin" : ""}`} /> {syncLabel}
        </span>
        {pwa.connection !== "offline" && sync.pending === 0 ? (
          <a href="/dashboard" className="rounded-full bg-[#188030] px-3 py-1 text-xs font-semibold text-white">Open full PharmaERP</a>
        ) : null}
        <button type="button" onClick={onLock} className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-3 py-1 text-xs">
          <Lock className="h-3.5 w-3.5" /> Lock
        </button>
      </header>
      {sync.message && sync.phase === "signin" ? (
        <p className="bg-amber-50 px-4 py-2 text-sm text-amber-800 print:hidden">
          {sync.message} <a className="underline" href="/login?callbackUrl=%2Fapp-offline">Sign in</a> — the sales stay on this device until then.
        </p>
      ) : null}

      <nav className="flex gap-1 px-4 pt-3 print:hidden">
        {(["till", "sales", "drafts", "stock", "reports"] as const).filter((name) => name === "reports" ? true : name === "stock" ? ["purchase.receive", "stock.request", "products.manage"].some((permission) => record.permissions.includes(permission)) : record.permissions.includes("sales.create")).map((name) => (
          <button key={name} type="button" onClick={() => setTab(name)} className={`rounded-full px-3 py-1.5 text-sm ${tab === name ? "bg-[#188030] text-white" : "bg-white text-slate-700"}`}>
            {name === "till" ? "Till" : name === "sales" ? `Offline sales (${sales.length})` : name === "drafts" ? `Drafts (${drafts.length})` : name === "stock" ? "Stock" : "Reports"}
          </button>
        ))}
      </nav>

      {tab === "till" ? (
        <div className="grid gap-4 p-4 lg:grid-cols-[1fr_420px] print:hidden">
          <section className="rounded-2xl bg-white p-4">
            <form onSubmit={scan} className="flex items-center gap-2">
              <ScanLine className="h-5 w-5 text-slate-400" />
              <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Scan a barcode or search name / SKU" className="h-11 flex-1 rounded-lg border border-slate-300 px-3" data-offline-search />
              {native ? (
                <button type="button" onClick={() => void scanWithCamera()} className="h-11 rounded-lg border border-slate-300 px-3 text-sm" aria-label="Scan with camera">
                  Camera
                </button>
              ) : null}
            </form>
            <ul className="mt-3 divide-y divide-slate-100">
              {results.map((product) => (
                <li key={product.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <p className="font-medium">{product.name}</p>
                    <p className="text-xs text-slate-500">
                      {product.sku ?? ""} · {naira(packPriceOf(product, product.packaging.find((level) => level.isBase)?.id ?? "") ?? product.sellingPrice)} / {product.baseUnit} · {Math.max(0, product.units).toLocaleString()} on this device
                      {product.rxOnly ? " · Rx" : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1">
                    {product.packaging.filter((level) => level.sellable).map((level) => (
                      <button key={level.id} type="button" onClick={() => add(product, level.id)} className="rounded-lg border border-emerald-200 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-50" data-add-product={product.id}>
                        + {level.name} {naira(packPriceOf(product, level.id) ?? 0)}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
              {!results.length ? <li className="py-6 text-center text-sm text-slate-500">No products found on this device.</li> : null}
            </ul>
          </section>

          <section className="space-y-3 rounded-2xl bg-white p-4">
            <h2 className="font-semibold">Sale</h2>
            {cart.length === 0 ? <p className="text-sm text-slate-500">Scan or choose items.</p> : null}
            <ul className="space-y-2">
              {cart.map((line, index) => {
                const product = catalogue[line.productId];
                const priced = check?.lines[index];
                return (
                  <li key={line.key} className="rounded-xl border border-slate-200 p-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium">{product?.name ?? line.productId}</p>
                      <button type="button" aria-label="Remove" onClick={() => setCart(cart.filter((row) => row.key !== line.key))} className="text-slate-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-sm">
                      <select value={line.packagingId} onChange={(event) => setCart(cart.map((row) => (row.key === line.key ? { ...row, packagingId: event.target.value } : row)))} className="h-8 rounded border border-slate-300 px-1 text-xs">
                        {product?.packaging.filter((level) => level.sellable).map((level) => <option key={level.id} value={level.id}>{level.name}</option>)}
                      </select>
                      <button type="button" aria-label="Less" onClick={() => setCart(cart.map((row) => (row.key === line.key ? { ...row, quantity: Math.max(1, row.quantity - 1) } : row)))} className="rounded border p-1"><Minus className="h-3 w-3" /></button>
                      <input value={line.quantity} inputMode="numeric" onChange={(event) => setCart(cart.map((row) => (row.key === line.key ? { ...row, quantity: Math.max(1, Number(event.target.value.replace(/\D/g, "")) || 1) } : row)))} className="h-8 w-14 rounded border border-slate-300 text-center" />
                      <button type="button" aria-label="More" onClick={() => setCart(cart.map((row) => (row.key === line.key ? { ...row, quantity: row.quantity + 1 } : row)))} className="rounded border p-1"><Plus className="h-3 w-3" /></button>
                      <span className="ml-auto font-medium">{priced ? naira(priced.gross - priced.discount) : ""}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
            <label className="flex items-center justify-between gap-2 text-sm">
              <span>Basket discount %</span>
              <input value={basketPct || ""} inputMode="decimal" onChange={(event) => setBasketPct(Math.max(0, Math.min(100, Number(event.target.value) || 0)))} className="h-8 w-20 rounded border border-slate-300 px-2 text-right" />
            </label>
            {check ? (
              <dl className="space-y-1 border-t border-slate-100 pt-2 text-sm">
                <div className="flex justify-between"><dt>Subtotal</dt><dd>{naira(check.subtotal)}</dd></div>
                <div className="flex justify-between text-slate-500"><dt>Discount</dt><dd>−{naira(check.discount)}</dd></div>
                <div className="flex justify-between text-slate-500"><dt>VAT</dt><dd>{naira(check.vat)}</dd></div>
                <div className="flex justify-between text-base font-bold"><dt>Total</dt><dd data-offline-total>{naira(check.total)}</dd></div>
              </dl>
            ) : null}
            {check?.needsRx ? <input value={rx} onChange={(event) => setRx(event.target.value)} placeholder="Prescription reference (required)" className="h-9 w-full rounded border border-slate-300 px-2 text-sm" /> : null}
            <div className="grid grid-cols-3 gap-1">
              {(["Cash", "Card", "Transfer"] as const).map((method) => (
                <button key={method} type="button" onClick={() => setTender({ ...tender, method })} className={`rounded-lg border px-2 py-1.5 text-sm ${tender.method === method ? "border-[#188030] bg-emerald-50 font-semibold" : "border-slate-300"}`}>
                  {method === "Card" ? "POS card" : method}
                </button>
              ))}
            </div>
            <input value={tender.amount} inputMode="decimal" onChange={(event) => setTender({ ...tender, amount: event.target.value.replace(/[^\d.]/g, "") })} placeholder={check ? `Amount received (${naira(check.total)})` : "Amount received"} className="h-9 w-full rounded border border-slate-300 px-2 text-sm" />
            {tender.method !== "Cash" ? (
              <>
                <input value={tender.reference} onChange={(event) => setTender({ ...tender, reference: event.target.value })} placeholder="Terminal / transfer reference" className="h-9 w-full rounded border border-slate-300 px-2 text-sm" />
                <p className="text-xs text-amber-700">Recorded offline: this payment stays “pending verification” until a manager confirms it.</p>
              </>
            ) : check && Number(tender.amount) > check.total ? (
              <p className="text-sm">Change: <span className="font-semibold">{naira(Number(tender.amount) - check.total)}</span></p>
            ) : null}
            {[...(check?.problems ?? []), ...(error ? [error] : [])].map((problem) => <p key={problem} className="rounded bg-rose-50 px-2 py-1 text-xs text-rose-700">{problem}</p>)}
            {check?.stockWarnings.map((warning) => <p key={warning} className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{warning}</p>)}
            <div className="flex gap-2">
              <button type="button" disabled={!cart.length} onClick={async () => { await saveDraft(record, cart.map(({ key, ...line }) => (void key, line)), `Draft ${new Date().toLocaleTimeString()}`); setCart([]); await reload(); }} className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">
                <Save className="h-4 w-4" /> Save draft
              </button>
              <button type="button" onClick={() => void complete()} disabled={!cart.length || !check || check.problems.length > 0} className="flex-1 rounded-full bg-[#188030] py-2 font-semibold text-white disabled:opacity-50" data-offline-complete>
                Complete sale
              </button>
            </div>
          </section>
        </div>
      ) : tab === "reports" ? (
        <ReportsView record={record} />
      ) : tab === "stock" ? (
        <StockForms record={record} onSaved={() => void requestSync(record).then(reload)} />
      ) : tab === "sales" ? (
        <section className="m-4 overflow-x-auto rounded-2xl bg-white p-4 print:hidden">
          <table className="w-full min-w-[640px] text-sm" data-offline-sales>
            <thead>
              <tr className="text-left text-xs uppercase text-slate-500"><th className="py-2">Receipt</th><th>Time</th><th>Total</th><th>Payment</th><th>Upload</th><th></th></tr>
            </thead>
            <tbody>
              {sales.map((sale) => (
                <tr key={sale.id} className="border-t border-slate-100" data-sale-status={sale.syncStatus}>
                  <td className="py-2 font-medium">{sale.localNumber}{sale.serverNumber ? <span className="block text-xs text-emerald-700">{sale.serverNumber}</span> : null}</td>
                  <td>{when(sale.createdAt)}</td>
                  <td>{naira(sale.total)}</td>
                  <td>{sale.payments.map((tender) => tender.method).join(" + ") || "Cash"}</td>
                  <td>{STATUS_LABEL[sale.syncStatus] ?? sale.syncStatus}{sale.syncMessage ? <span className="block max-w-xs text-xs text-slate-500">{sale.syncMessage}</span> : null}</td>
                  <td><button type="button" onClick={() => setReceipt(sale)} className="text-[#188030] underline">Receipt</button></td>
                </tr>
              ))}
              {!sales.length ? <tr><td colSpan={6} className="py-6 text-center text-slate-500">No offline sales on this device.</td></tr> : null}
            </tbody>
          </table>
        </section>
      ) : (
        <section className="m-4 space-y-2 rounded-2xl bg-white p-4 print:hidden">
          {drafts.map((draft) => (
            <div key={draft.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-3 text-sm">
              <span>{draft.cart.label} · {draft.cart.lines.length} item(s)</span>
              <span className="flex gap-2">
                <button type="button" className="text-[#188030] underline" onClick={async () => { setCart(draft.cart.lines.map((line) => ({ ...line, key: crypto.randomUUID() }))); await deleteDraft(record, draft.id); await reload(); setTab("till"); }}>Resume</button>
                <button type="button" className="text-rose-600 underline" onClick={async () => { await deleteDraft(record, draft.id); await reload(); }}>Delete</button>
              </span>
            </div>
          ))}
          {!drafts.length ? <p className="text-center text-sm text-slate-500">No drafts.</p> : null}
        </section>
      )}

      {receipt ? <Receipt sale={receipt} onClose={() => setReceipt(null)} /> : null}
    </main>
  );
}

function Receipt({ sale, onClose }: { sale: OfflineSale; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-slate-900/60 p-4 print:static print:block print:bg-white print:p-0" onClick={onClose}>
      <div className="w-full max-w-xs rounded-xl bg-white p-4 font-mono text-xs text-slate-900 print:max-w-none print:rounded-none" onClick={(event) => event.stopPropagation()} data-offline-receipt>
        <p className="text-center text-sm font-bold">{sale.tenantName}</p>
        <p className="text-center">{sale.outletName}</p>
        <p className="mt-2 text-center font-bold">{sale.serverNumber ? `Receipt ${sale.serverNumber}` : "OFFLINE SALE"}</p>
        <p className="text-center">{sale.localNumber}{sale.serverNumber ? " (made offline)" : ""}</p>
        <p className="mt-2">{new Date(sale.createdAt).toLocaleString("en-NG")}</p>
        <p>Cashier: {sale.cashier}</p>
        <hr className="my-2 border-dashed" />
        {sale.lines.map((line, index) => (
          <div key={index} className="mb-1">
            <p>{line.productName}</p>
            <p className="flex justify-between"><span>{line.quantity} {line.packagingName} × {naira(line.packPrice)}</span><span>{naira(line.gross - line.discount)}</span></p>
          </div>
        ))}
        <hr className="my-2 border-dashed" />
        <p className="flex justify-between"><span>Subtotal</span><span>{naira(sale.subtotal)}</span></p>
        {sale.discount ? <p className="flex justify-between"><span>Discount</span><span>−{naira(sale.discount)}</span></p> : null}
        <p className="flex justify-between"><span>VAT</span><span>{naira(sale.vat)}</span></p>
        <p className="flex justify-between text-sm font-bold"><span>TOTAL</span><span>{naira(sale.total)}</span></p>
        {sale.payments.map((tender, index) => <p key={index} className="flex justify-between"><span>{tender.method}{tender.method !== "Cash" ? " (pending verification)" : ""}</span><span>{naira(tender.amount)}</span></p>)}
        {sale.change ? <p className="flex justify-between"><span>Change</span><span>{naira(sale.change)}</span></p> : null}
        <hr className="my-2 border-dashed" />
        <p className="text-center">{sale.serverNumber ? "Uploaded to PharmaERP." : "Made without internet; uploaded automatically when the connection returns."}</p>
        <div className="mt-3 flex gap-2 print:hidden">
          <button type="button" onClick={() => window.print()} className="inline-flex flex-1 items-center justify-center gap-1 rounded-full bg-[#188030] py-2 font-sans text-white"><Printer className="h-4 w-4" /> Print</button>
          <button type="button" onClick={onClose} className="flex-1 rounded-full border border-slate-300 py-2 font-sans">Close</button>
        </div>
      </div>
    </div>
  );
}
