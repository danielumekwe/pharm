"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  Camera,
  CheckCircle2,
  CreditCard,
  FileDown,
  Landmark,
  Minus,
  PauseCircle,
  Percent,
  Plus,
  Printer,
  ScanBarcode,
  Search,
  Save,
  ShoppingCart,
  Split,
  Trash2,
  User,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { BrandLogo, BrandWordmark } from "@/components/branding";
import { ImpersonationBanner } from "@/components/dashboard-shell";
import type { PosCatalogItem } from "@/lib/erp/pos";
import type { HeldSale, SaleInvoice, TenderMethod } from "@/lib/erp/types";
import { describeBreakdown } from "@/lib/erp/packaging";
import { isNativeApp, nativeScan } from "@/lib/native";
import { money, shortDate } from "@/lib/format";

type Discount = { type: "percent" | "amount"; value: number };
type Line = { key: string; productId: string; packagingId: string; quantity: number; discount?: Discount };
type Customer = { id: string; name: string; type: string; phone: string; status: string; available: number };
type Tender = { key: string; method: TenderMethod; amount: string; reference: string };
type Props = {
  cashier: { id: string; name: string; role: string };
  outlets: { id: string; name: string; address: string }[];
  initialOutletId: string | null;
  initialCatalog: PosCatalogItem[];
  initialHeld: HeldSale[];
  customers: Customer[];
  settings: { vatRate: number; cashierMaxDiscountPct: number; approverMaxDiscountPct: number };
  canDiscount: boolean;
  nextInvoice: string;
  openHeld: boolean;
  resumeId: string | null;
};

const round2 = (value: number) => Math.round(value * 100) / 100;
let seq = 0;
const key = () => `l${Date.now().toString(36)}${++seq}`;
const METHOD_LABEL: Record<TenderMethod, string> = { Cash: "Cash", Transfer: "Bank transfer", Card: "POS terminal" };

function discountOf(discount: Discount | undefined, base: number) {
  if (!discount || !(discount.value > 0)) return 0;
  return discount.type === "percent" ? round2((base * Math.min(100, discount.value)) / 100) : Math.min(round2(discount.value), base);
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status}).`);
  return payload;
}

export function PosTerminal(props: Props) {
  const router = useRouter();
  const [outletId, setOutletId] = useState(props.initialOutletId);
  const [catalog, setCatalog] = useState(props.initialCatalog);
  const [held, setHeld] = useState(props.initialHeld);
  const [lines, setLines] = useState<Line[]>([]);
  const [heldId, setHeldId] = useState<string | null>(null);
  const [heldRef, setHeldRef] = useState<string | null>(null);
  const [customerMode, setCustomerMode] = useState<"none" | "existing" | "walkin">("none");
  const [customerId, setCustomerId] = useState("");
  const [walkIn, setWalkIn] = useState({ name: "", phone: "" });
  const [customerKind, setCustomerKind] = useState<"Normal" | "Family">("Normal");
  const [globalDiscount, setGlobalDiscount] = useState<Discount>({ type: "percent", value: 0 });
  const [prescriptionRef, setPrescriptionRef] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [stockFilter, setStockFilter] = useState<"all" | "in" | "low" | "out">("in");
  const [scan, setScan] = useState("");
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [showHeld, setShowHeld] = useState(props.openHeld);
  const [paying, setPaying] = useState(false);
  const [completed, setCompleted] = useState<SaleInvoice | null>(null);
  const [nextInvoice, setNextInvoice] = useState(props.nextInvoice);
  const [mobileTab, setMobileTab] = useState<"products" | "cart">("products");
  const [camera, setCamera] = useState(false);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const [startedAt] = useState(() => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));

  const outlet = props.outlets.find((row) => row.id === outletId);
  const byId = useMemo(() => new Map(catalog.map((item) => [item.id, item])), [catalog]);

  // ---------------------------------------------------------------- derived cart
  const detailed = lines
    .map((line) => {
      const item = byId.get(line.productId);
      const pack = item?.packaging.find((row) => row.id === line.packagingId) ?? item?.packaging[item.packaging.length - 1];
      if (!item || !pack) return null;
      const gross = round2(pack.price * line.quantity);
      const lineDiscount = discountOf(line.discount, gross);
      return { ...line, item, pack, gross, lineDiscount, baseQuantity: line.quantity * pack.unitsPerPackage };
    })
    .filter((line) => line !== null);
  const unitsInCart = (productId: string) => detailed.filter((line) => line.productId === productId).reduce((sum, line) => sum + line.baseQuantity, 0);
  const subtotal = round2(detailed.reduce((sum, line) => sum + line.gross, 0));
  const itemDiscounts = round2(detailed.reduce((sum, line) => sum + line.lineDiscount, 0));
  const basketDiscount = discountOf(globalDiscount, subtotal - itemDiscounts);
  const totalDiscount = round2(itemDiscounts + basketDiscount);
  const vat = Math.round((subtotal - totalDiscount) * (props.settings.vatRate / 100));
  const total = round2(subtotal - totalDiscount + vat);
  const discountPct = subtotal > 0 ? (totalDiscount / subtotal) * 100 : 0;
  const discountLimit = props.canDiscount ? props.settings.approverMaxDiscountPct : props.settings.cashierMaxDiscountPct;
  const discountTooHigh = discountPct > discountLimit + 0.001;
  const needsRx = detailed.some((line) => line.item.rxOnly);
  const shortages = detailed.filter((line) => unitsInCart(line.productId) > line.item.available);
  const itemCount = detailed.reduce((sum, line) => sum + line.quantity, 0);
  const customer = props.customers.find((row) => row.id === customerId);

  // ---------------------------------------------------------------- effects
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "F2") {
        event.preventDefault();
        scanRef.current?.focus();
      }
      if (event.key === "F9") {
        event.preventDefault();
        setPaying(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const flash = useCallback((tone: "ok" | "error", text: string) => {
    setNotice({ tone, text });
    window.setTimeout(() => setNotice((current) => (current?.text === text ? null : current)), 3500);
  }, []);

  const refresh = useCallback(async (target = outletId) => {
    if (!target) return;
    const [nextCatalog, nextHeld] = await Promise.all([api<PosCatalogItem[]>(`/api/pos/catalog?outletId=${target}`), api<HeldSale[]>(`/api/pos/held?outletId=${target}`)]);
    setCatalog(nextCatalog);
    setHeld(nextHeld);
  }, [outletId]);

  // ---------------------------------------------------------------- cart actions
  function add(productId: string, packagingId?: string, quantity = 1) {
    const item = byId.get(productId);
    if (!item) return flash("error", "That item is not sold at this outlet.");
    const pack = item.packaging.find((row) => row.id === packagingId) ?? item.packaging[item.packaging.length - 1];
    if (!pack) return flash("error", `${item.name} has no sellable packaging.`);
    if (unitsInCart(productId) + pack.unitsPerPackage * quantity > item.available) {
      return flash("error", `Only ${item.available.toLocaleString()} ${item.baseUnit} of ${item.name} available (expired and quarantined batches are excluded).`);
    }
    setLines((current) => {
      const existing = current.find((line) => line.productId === productId && line.packagingId === pack.id);
      if (existing) return current.map((line) => (line === existing ? { ...line, quantity: line.quantity + quantity } : line));
      return [...current, { key: key(), productId, packagingId: pack.id, quantity }];
    });
    flash("ok", `Added ${item.name} · ${pack.name}`);
    if (item.rxOnly) flash("error", `${item.name} is prescription-only. Record the prescription reference before completing the sale.`);
  }

  function updateLine(lineKey: string, patch: Partial<Line>) {
    setLines((current) => current.map((line) => (line.key === lineKey ? { ...line, ...patch } : line)));
  }

  function scanCode(raw: string) {
    const code = raw.trim();
    if (!code) return;
    setScan("");
    for (const item of catalog) {
      const pack = item.packaging.find((row) => row.barcodes.includes(code));
      if (pack) return add(item.id, pack.id);
    }
    const byItem = catalog.find((item) => item.barcodes.includes(code) || item.sku.toUpperCase() === code.toUpperCase());
    if (byItem) return add(byItem.id);
    flash("error", `No sellable item with barcode ${code} at ${outlet?.name ?? "this outlet"}.`);
  }

  function clearCart() {
    setLines([]);
    setHeldId(null);
    setHeldRef(null);
    setCustomerMode("none");
    setCustomerId("");
    setWalkIn({ name: "", phone: "" });
    setCustomerKind("Normal");
    setGlobalDiscount({ type: "percent", value: 0 });
    setPrescriptionRef("");
  }

  function cartPayload() {
    return {
      lines: lines.map((line) => ({ productId: line.productId, packagingId: line.packagingId, quantity: line.quantity, discount: line.discount && line.discount.value > 0 ? line.discount : undefined })),
      customerId: customerMode === "existing" ? customerId || null : null,
      walkIn: customerMode === "walkin" ? walkIn : undefined,
      customerKind,
      globalDiscount: globalDiscount.value > 0 ? globalDiscount : undefined,
      prescriptionRef: prescriptionRef || undefined,
    };
  }

  async function park(kind: "HELD" | "DRAFT") {
    if (!outletId || lines.length === 0) return;
    setBusy(true);
    try {
      const saved = await api<HeldSale>("/api/pos/held", { method: "POST", body: JSON.stringify({ id: heldId ?? undefined, kind, outletId, label: customerMode === "walkin" ? walkIn.name : customer?.name, cart: cartPayload() }) });
      flash("ok", `${kind === "DRAFT" ? "Draft saved" : "Transaction held"} as ${saved.reference}.`);
      clearCart();
      await refresh();
    } catch (error) {
      flash("error", error instanceof Error ? error.message : "Could not save the basket.");
    } finally {
      setBusy(false);
    }
  }

  const resume = useCallback((basket: HeldSale) => {
    setLines(basket.cart.lines.map((line) => ({ key: key(), productId: line.productId, packagingId: line.packagingId ?? "", quantity: line.quantity, discount: line.discount })));
    setHeldId(basket.id);
    setHeldRef(basket.reference);
    setCustomerMode(basket.cart.customerId ? "existing" : basket.cart.walkIn?.name || basket.cart.walkIn?.phone ? "walkin" : "none");
    setCustomerId(basket.cart.customerId ?? "");
    setWalkIn({ name: basket.cart.walkIn?.name ?? "", phone: basket.cart.walkIn?.phone ?? "" });
    setCustomerKind(basket.cart.customerKind ?? "Normal");
    setGlobalDiscount(basket.cart.globalDiscount ?? { type: "percent", value: 0 });
    setPrescriptionRef(basket.cart.prescriptionRef ?? "");
    setShowHeld(false);
    setMobileTab("cart");
  }, []);

  // Resume a held basket named in the URL (from the dashboard).
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !props.resumeId) return;
    const basket = props.initialHeld.find((row) => row.id === props.resumeId);
    resumed.current = true;
    if (basket) queueMicrotask(() => resume(basket));
  }, [props.resumeId, props.initialHeld, resume]);

  async function discard(basket: HeldSale) {
    if (!confirm(`Discard ${basket.reference}? Nothing has been sold, so no stock is affected.`)) return;
    try {
      await api(`/api/pos/held/${basket.id}`, { method: "DELETE" });
      if (heldId === basket.id) clearCart();
      await refresh();
    } catch (error) {
      flash("error", error instanceof Error ? error.message : "Could not discard.");
    }
  }

  async function changeOutlet(next: string) {
    if (lines.length && !confirm("Changing outlet clears the current basket. Continue?")) return;
    clearCart();
    setOutletId(next);
    await refresh(next).catch((error) => flash("error", error instanceof Error ? error.message : "Could not load the outlet."));
  }

  async function complete(tenders: { method: TenderMethod; amount: number; reference?: string }[]) {
    if (!outletId) return;
    setBusy(true);
    try {
      const sale = await api<SaleInvoice>("/api/sales", {
        method: "POST",
        body: JSON.stringify({ outletId, ...cartPayload(), payments: tenders, heldId: heldId ?? undefined }),
      });
      setCompleted(sale);
      setPaying(false);
      setNextInvoice(`INV-${String(Number(sale.number.replace(/\D/g, "")) + 1).padStart(5, "0")}`);
      clearCart();
      await refresh();
      router.refresh();
    } catch (error) {
      flash("error", error instanceof Error ? error.message : "The sale could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------- catalogue filtering
  const categories = useMemo(() => Array.from(new Set(catalog.map((item) => item.category))).sort(), [catalog]);
  const needle = query.trim().toLowerCase();
  const shown = catalog.filter((item) => {
    if (category && item.category !== category) return false;
    if (stockFilter === "in" && item.available <= 0) return false;
    if (stockFilter === "low" && !(item.available > 0 && item.available <= item.minStock)) return false;
    if (stockFilter === "out" && item.available > 0) return false;
    if (!needle) return true;
    return `${item.name} ${item.genericName} ${item.sku} ${item.category} ${item.barcodes.join(" ")} ${item.packaging.flatMap((row) => row.barcodes).join(" ")}`.toLowerCase().includes(needle);
  });

  if (!outletId) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-100 p-6 text-center">
        <div className="max-w-md rounded-2xl bg-white p-8 shadow">
          <p className="text-lg font-semibold text-slate-900">No outlet to sell from</p>
          <p className="mt-2 text-sm text-slate-600">Sales are recorded against a retail outlet. Select an outlet in the header, or ask an administrator to assign you to one.</p>
          <Link href="/dashboard" className="mt-4 inline-flex rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white">Back to dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-slate-100 text-slate-900">
      <ImpersonationBanner />
      {/* A. Top bar */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 md:px-4">
        <Link href="/dashboard" className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100" aria-label="Back to dashboard">
          <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Dashboard</span>
        </Link>
        <div className="flex min-w-0 items-center gap-2 border-l border-slate-200 pl-3">
          <BrandWordmark className="hidden h-9 w-auto sm:block" />
          <BrandLogo className="h-8 w-8 shrink-0 sm:hidden" />
          <span className="rounded-md bg-blue-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white">Sales POS</span>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs md:gap-3">
          <span className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 font-medium sm:flex ${online ? "bg-green-50 text-green-700" : "bg-rose-50 text-rose-700"}`} title={`Session started ${startedAt}`}>
            {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />} {online ? `Terminal online · since ${startedAt}` : "Offline"}
          </span>
          {props.outlets.length > 1 ? (
            <select value={outletId} onChange={(event) => void changeOutlet(event.target.value)} className="h-8 max-w-44 rounded-lg border border-slate-200 bg-white px-2 font-medium" aria-label="Outlet">
              {props.outlets.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          ) : (
            <span className="max-w-44 truncate rounded-lg bg-blue-50 px-2.5 py-1.5 font-medium text-blue-800" title="Assigned outlet">{outlet?.name}</span>
          )}
          <button type="button" onClick={() => setShowHeld(true)} className="relative flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50">
            <PauseCircle className="h-4 w-4" /> <span className="hidden md:inline">Held</span>
            {held.length ? <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">{held.length}</span> : null}
          </button>
          <span className="hidden items-center gap-1.5 text-slate-600 lg:flex"><User className="h-4 w-4" /> {props.cashier.name}</span>
        </div>
      </header>

      {/* Mobile tab switch */}
      <div className="grid grid-cols-2 border-b border-slate-200 bg-white text-sm font-medium lg:hidden">
        <button type="button" onClick={() => setMobileTab("products")} className={`py-2.5 ${mobileTab === "products" ? "border-b-2 border-blue-600 text-blue-700" : "text-slate-500"}`}>Products</button>
        <button type="button" onClick={() => setMobileTab("cart")} className={`py-2.5 ${mobileTab === "cart" ? "border-b-2 border-blue-600 text-blue-700" : "text-slate-500"}`}>Cart ({itemCount}) · {money(total)}</button>
      </div>

      {notice ? (
        <div className={`pointer-events-none fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-2 text-sm font-medium shadow-lg ${notice.tone === "ok" ? "bg-slate-900 text-white" : "bg-rose-600 text-white"}`} role="status">{notice.text}</div>
      ) : null}

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(380px,42%)_1fr]">
        {/* B. Cart */}
        <section className={`min-h-0 flex-col border-r border-slate-200 bg-white ${mobileTab === "cart" ? "flex" : "hidden"} lg:flex`} aria-label="Cart">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div>
              <p className="flex items-center gap-2 text-base font-bold"><ShoppingCart className="h-5 w-5 text-blue-600" /> Cart <span className="rounded-full bg-slate-100 px-2 text-xs font-semibold text-slate-600">{itemCount} item{itemCount === 1 ? "" : "s"}</span></p>
              <p className="text-[11px] text-slate-500">{heldRef ? `Resumed ${heldRef}` : "New transaction"} · {nextInvoice} <span className="text-slate-400">(assigned on completion)</span></p>
            </div>
            <div className="flex gap-1.5">
              <button type="button" disabled={busy || lines.length === 0} onClick={() => void park("DRAFT")} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"><Save className="h-3.5 w-3.5" /> Save draft</button>
              <button type="button" disabled={busy || lines.length === 0} onClick={() => void park("HELD")} className="flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-40"><PauseCircle className="h-3.5 w-3.5" /> Hold</button>
            </div>
          </div>

          {/* C. Customer */}
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 text-xs font-medium">
              {([["none", "No customer", User], ["existing", "Existing", Users], ["walkin", "Walk-in details", UserPlus]] as const).map(([mode, label, Icon]) => (
                <button key={mode} type="button" onClick={() => setCustomerMode(mode)} className={`flex items-center justify-center gap-1 rounded-md py-1.5 ${customerMode === mode ? "bg-white text-blue-700 shadow-sm" : "text-slate-600"}`}><Icon className="h-3.5 w-3.5" /> {label}</button>
              ))}
            </div>
            {customerMode === "existing" ? (
              <select value={customerId} onChange={(event) => setCustomerId(event.target.value)} className="mt-2 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm" aria-label="Customer">
                <option value="">Select customer…</option>
                {props.customers.filter((row) => row.type !== "Walk-in").map((row) => (
                  <option key={row.id} value={row.id} disabled={row.status === "On hold"}>{row.name} · {row.type}{row.status === "On hold" ? " (on hold)" : row.available ? ` · credit ${money(row.available)}` : ""}</option>
                ))}
              </select>
            ) : null}
            {customerMode === "walkin" ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input value={walkIn.name} onChange={(event) => setWalkIn((current) => ({ ...current, name: event.target.value }))} placeholder="Customer name" className="h-9 rounded-lg border border-slate-200 px-2 text-sm" />
                <input value={walkIn.phone} onChange={(event) => setWalkIn((current) => ({ ...current, phone: event.target.value }))} placeholder="Phone (optional)" inputMode="tel" className="h-9 rounded-lg border border-slate-200 px-2 text-sm" />
              </div>
            ) : null}
            {customerMode !== "none" ? (
              <div className="mt-2 flex items-center gap-3 text-xs text-slate-600">
                Customer type:
                {(["Normal", "Family"] as const).map((kind) => (
                  <label key={kind} className="flex items-center gap-1"><input type="radio" name="kind" checked={customerKind === kind} onChange={() => setCustomerKind(kind)} className="accent-blue-600" /> {kind}</label>
                ))}
              </div>
            ) : null}
          </div>

          {/* Lines */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
            {detailed.length === 0 ? (
              <div className="grid h-full place-items-center py-10 text-center text-sm text-slate-400">
                <div><ScanBarcode className="mx-auto mb-2 h-10 w-10 text-slate-300" />Scan a barcode or tap a product to start.</div>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {detailed.map((line) => {
                  const short = unitsInCart(line.productId) > line.item.available;
                  const batch = line.item.batches[0];
                  return (
                    <li key={line.key} className="py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-900">{line.item.name}</p>
                          <p className="text-[11px] text-slate-500">
                            {batch ? `FEFO batch ${batch.batchNumber} · exp ${shortDate(batch.expiryDate)}` : "No usable batch"}
                            {line.item.rxOnly ? <span className="ml-1.5 rounded bg-sky-100 px-1 font-semibold text-sky-700">Rx</span> : null}
                            {line.item.controlled ? <span className="ml-1 rounded bg-rose-100 px-1 font-semibold text-rose-700">CD</span> : null}
                          </p>
                        </div>
                        <button type="button" onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Remove ${line.item.name}`}><Trash2 className="h-4 w-4" /></button>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {line.item.packaging.length > 1 ? (
                          <select value={line.pack.id} onChange={(event) => updateLine(line.key, { packagingId: event.target.value })} className="h-8 rounded-lg border border-slate-200 px-1.5 text-xs" aria-label="Selling unit">
                            {line.item.packaging.map((pack) => <option key={pack.id} value={pack.id}>{pack.name}{pack.unitsPerPackage > 1 ? ` ×${pack.unitsPerPackage}` : ""}</option>)}
                          </select>
                        ) : <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-600">{line.pack.name}</span>}
                        <div className={`flex items-center rounded-lg border ${short ? "border-rose-400" : "border-slate-200"}`}>
                          <button type="button" onClick={() => updateLine(line.key, { quantity: Math.max(1, line.quantity - 1) })} className="p-1.5 text-slate-600 hover:bg-slate-50" aria-label="Decrease quantity"><Minus className="h-3.5 w-3.5" /></button>
                          <input type="number" min={1} value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: Math.max(1, Math.floor(Number(event.target.value) || 1)) })} className="h-7 w-12 border-x border-slate-200 text-center text-sm tabular-nums outline-none" aria-label={`Quantity of ${line.item.name}`} />
                          <button type="button" onClick={() => updateLine(line.key, { quantity: line.quantity + 1 })} className="p-1.5 text-slate-600 hover:bg-slate-50" aria-label="Increase quantity"><Plus className="h-3.5 w-3.5" /></button>
                        </div>
                        <span className="text-xs text-slate-500">× {money(line.pack.price)}</span>
                        <DiscountInput value={line.discount} onChange={(discount) => updateLine(line.key, { discount })} />
                        <span className="ml-auto text-right">
                          {line.lineDiscount ? <span className="block text-[11px] text-slate-400 line-through">{money(line.gross)}</span> : null}
                          <span className="font-semibold tabular-nums">{money(line.gross - line.lineDiscount)}</span>
                        </span>
                      </div>
                      {short ? <p className="mt-1 text-[11px] text-rose-600">Only {line.item.available.toLocaleString()} {line.item.baseUnit} available.</p> : line.pack.unitsPerPackage > 1 ? <p className="mt-1 text-[11px] text-slate-400">= {line.baseQuantity.toLocaleString()} {line.item.baseUnit}</p> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Totals */}
          <div className="border-t border-slate-200 bg-slate-50 px-4 py-3">
            {needsRx ? (
              <div className="mb-2 rounded-lg border border-sky-200 bg-sky-50 p-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-sky-800"><AlertTriangle className="h-3.5 w-3.5" /> Prescription required</p>
                <input value={prescriptionRef} onChange={(event) => setPrescriptionRef(event.target.value)} placeholder="Prescription reference / prescriber" className="mt-1.5 h-8 w-full rounded-md border border-sky-200 bg-white px-2 text-sm" />
              </div>
            ) : null}
            <div className="mb-2 flex items-center justify-between gap-2 text-sm">
              <span className="text-slate-600">Basket discount</span>
              <DiscountInput value={globalDiscount.value ? globalDiscount : undefined} onChange={(discount) => setGlobalDiscount(discount ?? { type: "percent", value: 0 })} wide />
            </div>
            <dl className="space-y-1 text-sm">
              <Row label="Subtotal" value={money(subtotal)} />
              <Row label="Item discounts" value={itemDiscounts ? `−${money(itemDiscounts)}` : money(0)} muted />
              <Row label="Basket discount" value={basketDiscount ? `−${money(basketDiscount)}` : money(0)} muted />
              <Row label={`Total discount${discountPct ? ` (${discountPct.toFixed(1)}%)` : ""}`} value={totalDiscount ? `−${money(totalDiscount)}` : money(0)} tone={discountTooHigh ? "error" : undefined} />
              <Row label={`VAT ${props.settings.vatRate}%`} value={money(vat)} muted />
              <div className="flex items-baseline justify-between border-t border-slate-200 pt-2"><dt className="text-base font-bold">Grand total</dt><dd className="text-2xl font-extrabold tabular-nums text-slate-900">{money(total)}</dd></div>
            </dl>
            {discountTooHigh ? <p className="mt-1 text-xs text-rose-600">Discount is above your {discountLimit}% limit{props.canDiscount ? "" : `; a supervisor with discount authority must complete this sale`}.</p> : null}
            <div className="mt-3 grid grid-cols-[auto_1fr] gap-2">
              <button type="button" onClick={() => lines.length && confirm("Clear the basket?") && clearCart()} disabled={lines.length === 0} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40">Clear</button>
              <button
                type="button"
                disabled={busy || detailed.length === 0 || shortages.length > 0 || discountTooHigh || (needsRx && !prescriptionRef.trim())}
                onClick={() => setPaying(true)}
                className="rounded-xl bg-blue-600 px-4 py-3 text-base font-bold text-white shadow-sm hover:bg-blue-700 disabled:bg-slate-300"
              >
                Charge {money(total)} <span className="ml-1 text-xs font-normal opacity-75">F9</span>
              </button>
            </div>
          </div>
        </section>

        {/* E. Catalogue */}
        <section className={`min-h-0 flex-col ${mobileTab === "products" ? "flex" : "hidden"} lg:flex`} aria-label="Products">
          <div className="space-y-2 border-b border-slate-200 bg-white p-3">
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                scanCode(scan);
              }}
            >
              <div className="relative flex-1">
                <ScanBarcode className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-blue-600" />
                <input
                  ref={scanRef}
                  autoFocus
                  value={scan}
                  onChange={(event) => setScan(event.target.value)}
                  placeholder="Scan barcode (USB, Bluetooth or type + Enter) — F2"
                  aria-label="Scan barcode"
                  className="h-11 w-full rounded-xl border-2 border-blue-200 bg-blue-50/40 pl-11 pr-3 text-base outline-none focus:border-blue-500 focus:bg-white"
                />
              </div>
              <button type="button" onClick={() => {
                if (!isNativeApp()) return setCamera(true);
                // In the Android app, Google's native scanner opens full-screen and returns the code.
                nativeScan().then((code) => code && scanCode(code)).catch((error: unknown) => flash("error", error instanceof Error ? error.message : "Camera scan failed."));
              }} className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50" title="Scan with camera"><Camera className="h-5 w-5" /><span className="hidden sm:inline">Camera</span></button>
            </form>
            <div className="flex flex-wrap gap-2">
              <div className="relative min-w-48 flex-1">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, generic, SKU, barcode or category" aria-label="Search products" className="h-9 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-blue-400" />
              </div>
              <select value={category} onChange={(event) => setCategory(event.target.value)} className="h-9 rounded-lg border border-slate-200 px-2 text-sm" aria-label="Category">
                <option value="">All categories</option>
                {categories.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
              <select value={stockFilter} onChange={(event) => setStockFilter(event.target.value as typeof stockFilter)} className="h-9 rounded-lg border border-slate-200 px-2 text-sm" aria-label="Stock status">
                <option value="in">In stock</option>
                <option value="low">Low stock</option>
                <option value="out">Out of stock</option>
                <option value="all">All statuses</option>
              </select>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {shown.length === 0 ? <p className="py-16 text-center text-sm text-slate-400">No products match.</p> : null}
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {shown.map((item) => (
                <ProductCard key={item.id} item={item} inCart={unitsInCart(item.id)} onAdd={(packId) => add(item.id, packId)} />
              ))}
            </div>
          </div>
        </section>
      </div>

      {showHeld ? <HeldDrawer held={held} cashierId={props.cashier.id} onClose={() => setShowHeld(false)} onResume={resume} onDiscard={(basket) => void discard(basket)} /> : null}
      {paying ? <PaymentDialog total={total} customer={customerMode === "existing" ? customer : undefined} busy={busy} onCancel={() => setPaying(false)} onComplete={(tenders) => void complete(tenders)} /> : null}
      {completed ? <CompletedDialog sale={completed} onClose={() => { setCompleted(null); scanRef.current?.focus(); }} /> : null}
      {camera ? <CameraScanner onClose={() => setCamera(false)} onCode={(code) => { setCamera(false); scanCode(code); }} /> : null}
    </div>
  );
}

function Row({ label, value, muted, tone }: { label: string; value: string; muted?: boolean; tone?: "error" }) {
  return (
    <div className={`flex justify-between ${tone === "error" ? "text-rose-600" : muted ? "text-slate-500" : "text-slate-700"}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/** % or ₦ discount picker used per line and for the whole basket. */
function DiscountInput({ value, onChange, wide }: { value?: Discount; onChange: (value: Discount | undefined) => void; wide?: boolean }) {
  const [open, setOpen] = useState(Boolean(value?.value));
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1 rounded-lg border border-dashed border-slate-300 px-2 py-1 text-xs text-slate-500 hover:border-blue-400 hover:text-blue-600">
        <Percent className="h-3 w-3" /> Discount
      </button>
    );
  }
  const type = value?.type ?? "percent";
  return (
    <span className={`flex items-center overflow-hidden rounded-lg border border-blue-200 ${wide ? "" : "text-xs"}`}>
      <button type="button" onClick={() => onChange({ type: type === "percent" ? "amount" : "percent", value: value?.value ?? 0 })} className="bg-blue-50 px-2 py-1 font-semibold text-blue-700" aria-label="Switch between percentage and amount">{type === "percent" ? "%" : "₦"}</button>
      <input type="number" min={0} step="any" value={value?.value || ""} onChange={(event) => onChange({ type, value: Math.max(0, Number(event.target.value) || 0) })} placeholder="0" className={`h-7 px-1.5 text-right tabular-nums outline-none ${wide ? "w-20" : "w-14"}`} aria-label="Discount value" />
      <button type="button" onClick={() => { onChange(undefined); setOpen(false); }} className="px-1.5 text-slate-400 hover:text-rose-600" aria-label="Remove discount"><X className="h-3 w-3" /></button>
    </span>
  );
}

function ProductCard({ item, inCart, onAdd }: { item: PosCatalogItem; inCart: number; onAdd: (packagingId: string) => void }) {
  const levels = item.packaging.map((pack) => ({ ...pack, isBase: pack.unitsPerPackage === 1, contains: 1, sellable: true }));
  const left = item.available - inCart;
  const low = item.available > 0 && item.available <= item.minStock;
  return (
    <article className={`flex flex-col rounded-2xl border bg-white p-3 shadow-sm ${item.available <= 0 ? "border-slate-200 opacity-60" : "border-slate-200 hover:border-blue-300"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900" title={item.name}>{item.name}</p>
          <p className="truncate text-[11px] text-slate-500">{[item.genericName !== item.name ? item.genericName : "", item.strength !== "-" ? item.strength : "", item.category, item.sku].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          {item.rxOnly ? <span className="rounded bg-sky-100 px-1.5 text-[10px] font-bold text-sky-700">Rx</span> : null}
          {item.controlled ? <span className="rounded bg-rose-100 px-1.5 text-[10px] font-bold text-rose-700">CD</span> : null}
        </div>
      </div>
      <p className={`mt-1.5 text-xs font-medium ${item.available <= 0 ? "text-rose-600" : low ? "text-amber-600" : "text-green-700"}`}>
        {item.available <= 0 ? "Out of stock" : `${item.available.toLocaleString()} ${item.baseUnit} available${levels.length > 1 ? ` · ${describeBreakdown(item.available, levels as never)}` : ""}`}
        {inCart ? <span className="ml-1 text-slate-500">({left.toLocaleString()} after cart)</span> : null}
      </p>
      {item.batches.length ? (
        <p className="mt-1 truncate text-[11px] text-slate-500" title={item.batches.map((batch) => `${batch.batchNumber}: ${batch.quantity} exp ${batch.expiryDate}`).join("\n")}>
          {item.batches.slice(0, 2).map((batch) => `${batch.batchNumber} · exp ${shortDate(batch.expiryDate)}${batch.days <= 90 ? " ⚠" : ""}`).join("  |  ")}
          {item.batches.length > 2 ? `  +${item.batches.length - 2}` : ""}
        </p>
      ) : null}
      <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
        {item.packaging.map((pack) => (
          <button
            key={pack.id}
            type="button"
            disabled={left < pack.unitsPerPackage}
            onClick={() => onAdd(pack.id)}
            className="flex min-h-10 flex-1 flex-col items-center justify-center rounded-xl bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 transition hover:bg-blue-600 hover:text-white disabled:bg-slate-50 disabled:text-slate-300"
          >
            <span>+ {pack.name}</span>
            <span className="font-normal">{money(pack.price)}</span>
          </button>
        ))}
      </div>
    </article>
  );
}

function Dialog({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl ${wide ? "sm:max-w-2xl" : "sm:max-w-lg"}`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/** G. Payment: cash (with change), bank transfer, POS terminal, or split across several. */
function PaymentDialog({ total, customer, busy, onCancel, onComplete }: { total: number; customer?: Customer; busy: boolean; onCancel: () => void; onComplete: (tenders: { method: TenderMethod; amount: number; reference?: string }[]) => void }) {
  const [mode, setMode] = useState<TenderMethod | "Split">("Cash");
  const [cash, setCash] = useState(String(total));
  const [reference, setReference] = useState("");
  const [split, setSplit] = useState<Tender[]>([{ key: key(), method: "Cash", amount: "", reference: "" }, { key: key(), method: "Card", amount: "", reference: "" }]);

  const tenders: { method: TenderMethod; amount: number; reference?: string }[] =
    mode === "Split"
      ? split.filter((row) => Number(row.amount) > 0).map((row) => ({ method: row.method, amount: round2(Number(row.amount)), reference: row.reference || undefined }))
      : mode === "Cash"
        ? [{ method: "Cash", amount: round2(Number(cash) || 0) }]
        : [{ method: mode, amount: total, reference: reference || undefined }];
  const paid = round2(tenders.reduce((sum, row) => sum + row.amount, 0));
  const cashPaid = tenders.filter((row) => row.method === "Cash").reduce((sum, row) => sum + row.amount, 0);
  const change = paid > total ? round2(Math.min(paid - total, cashPaid)) : 0;
  const nonCashOver = paid - total > cashPaid + 0.001;
  const outstanding = round2(Math.max(0, total - paid));
  const creditOk = customer && customer.type !== "Walk-in" && outstanding <= customer.available;
  const canComplete = !busy && paid > 0 && !nonCashOver && (outstanding <= 0.001 || Boolean(creditOk));
  const quick = Array.from(new Set([total, Math.ceil(total / 500) * 500, Math.ceil(total / 1000) * 1000, Math.ceil(total / 5000) * 5000, Math.ceil(total / 10000) * 10000])).filter((value) => value >= total).slice(0, 4);

  return (
    <Dialog title="Payment" onClose={onCancel}>
      <div className="mb-4 rounded-xl bg-blue-50 px-4 py-3 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">Total due</p>
        <p className="text-3xl font-extrabold tabular-nums text-slate-900">{money(total)}</p>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {([["Cash", Banknote], ["Transfer", Landmark], ["Card", CreditCard], ["Split", Split]] as const).map(([value, Icon]) => (
          <button key={value} type="button" onClick={() => setMode(value)} className={`flex flex-col items-center gap-1 rounded-xl border py-3 text-xs font-semibold ${mode === value ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-slate-700 hover:border-blue-300"}`}>
            <Icon className="h-5 w-5" /> {value === "Card" ? "POS terminal" : value === "Transfer" ? "Transfer" : value}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {mode === "Cash" ? (
          <>
            <label className="grid gap-1 text-sm font-medium text-slate-700">Cash received
              <input type="number" min={0} step="any" autoFocus value={cash} onChange={(event) => setCash(event.target.value)} className="h-12 rounded-xl border border-slate-300 px-3 text-right text-xl font-semibold tabular-nums outline-none focus:border-blue-500" />
            </label>
            <div className="flex flex-wrap gap-2">
              {quick.map((value) => <button key={value} type="button" onClick={() => setCash(String(value))} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium hover:bg-slate-50">{money(value)}</button>)}
            </div>
          </>
        ) : null}
        {mode === "Transfer" || mode === "Card" ? (
          <label className="grid gap-1 text-sm font-medium text-slate-700">{mode === "Card" ? "Terminal approval / RRN" : "Transfer reference"} (optional)
            <input value={reference} onChange={(event) => setReference(event.target.value)} className="h-10 rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-blue-500" />
          </label>
        ) : null}
        {mode === "Split" ? (
          <div className="space-y-2">
            {split.map((row, index) => (
              <div key={row.key} className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
                <select value={row.method} onChange={(event) => setSplit((current) => current.map((item) => (item.key === row.key ? { ...item, method: event.target.value as TenderMethod } : item)))} className="h-10 w-full min-w-0 rounded-lg border border-slate-300 px-2 text-sm" aria-label={`Method ${index + 1}`}>
                  {(Object.keys(METHOD_LABEL) as TenderMethod[]).map((method) => <option key={method} value={method}>{METHOD_LABEL[method]}</option>)}
                </select>
                <input type="number" min={0} step="any" value={row.amount} placeholder={index === split.length - 1 ? String(round2(Math.max(0, total - split.slice(0, -1).reduce((sum, item) => sum + (Number(item.amount) || 0), 0)))) : "0"} onChange={(event) => setSplit((current) => current.map((item) => (item.key === row.key ? { ...item, amount: event.target.value } : item)))} className="h-10 w-full min-w-0 rounded-lg border border-slate-300 px-2 text-right text-sm tabular-nums" aria-label={`Amount ${index + 1}`} />
                <input value={row.reference} onChange={(event) => setSplit((current) => current.map((item) => (item.key === row.key ? { ...item, reference: event.target.value } : item)))} placeholder="Ref (optional)" className="h-10 w-full min-w-0 rounded-lg border border-slate-300 px-2 text-sm" />
                <button type="button" disabled={split.length <= 2} onClick={() => setSplit((current) => current.filter((item) => item.key !== row.key))} className="rounded-lg p-2 text-slate-400 hover:text-rose-600 disabled:opacity-30" aria-label="Remove payment"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            <div className="flex gap-2">
              <button type="button" onClick={() => setSplit((current) => [...current, { key: key(), method: "Transfer", amount: "", reference: "" }])} className="flex items-center gap-1 text-sm font-medium text-blue-600"><Plus className="h-4 w-4" /> Add payment</button>
              <button type="button" onClick={() => setSplit((current) => current.map((item, index) => (index === current.length - 1 ? { ...item, amount: String(round2(Math.max(0, total - current.slice(0, -1).reduce((sum, row) => sum + (Number(row.amount) || 0), 0)))) } : item)))} className="ml-auto text-sm font-medium text-slate-600 hover:text-blue-600">Fill remaining</button>
            </div>
          </div>
        ) : null}
      </div>

      <dl className="mt-4 space-y-1 rounded-xl bg-slate-50 p-3 text-sm">
        <Row label="Total due" value={money(total)} />
        <Row label="Amount paid" value={money(paid)} />
        <Row label="Outstanding balance" value={money(outstanding)} tone={outstanding > 0 && !creditOk ? "error" : undefined} />
        {change ? <div className="flex justify-between text-base font-bold text-green-700"><dt>Change due</dt><dd className="tabular-nums">{money(change)}</dd></div> : null}
      </dl>
      {nonCashOver ? <p className="mt-2 text-sm text-rose-600">Card and transfer amounts cannot exceed the total; only cash can be over-tendered.</p> : null}
      {outstanding > 0.001 ? <p className="mt-2 text-sm text-slate-600">{creditOk ? `${money(outstanding)} will be charged to ${customer!.name}'s account.` : "The sale cannot be completed until the full amount is paid (or select a customer account with enough credit)."}</p> : null}
      <div className="mt-4 grid grid-cols-[auto_1fr] gap-2">
        <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700">Back</button>
        <button type="button" disabled={!canComplete} onClick={() => onComplete(tenders)} className="flex items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-3 text-base font-bold text-white hover:bg-green-700 disabled:bg-slate-300">
          <CheckCircle2 className="h-5 w-5" /> {busy ? "Completing…" : "Complete sale"}
        </button>
      </div>
    </Dialog>
  );
}

/** I. Receipt options after a completed sale. */
function CompletedDialog({ sale, onClose }: { sale: SaleInvoice; onClose: () => void }) {
  const receipt = `/api/sales/${sale.id}/receipt?format=pdf`;
  return (
    <Dialog title="Sale completed" onClose={onClose}>
      <div className="text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-green-600" />
        <p className="mt-2 font-mono text-sm text-slate-500">{sale.number}</p>
        <p className="text-3xl font-extrabold tabular-nums">{money(sale.total)}</p>
        <p className="text-sm text-slate-600">{sale.payments?.map((row) => `${METHOD_LABEL[row.method]} ${money(row.amount)}`).join(" + ") ?? sale.paymentMethod}{sale.status !== "Paid" ? ` · ${sale.status}` : ""}</p>
        {sale.change ? <p className="mt-3 rounded-xl bg-green-50 py-3 text-2xl font-bold text-green-700">Change {money(sale.change)}</p> : null}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <a href={`${receipt}&print=1`} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Printer className="h-4 w-4" /> Print receipt</a>
        <a href={receipt} download={`${sale.number}.pdf`} className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><FileDown className="h-4 w-4" /> PDF receipt</a>
        <button type="button" autoFocus onClick={onClose} className="col-span-2 rounded-xl bg-blue-600 py-3 text-base font-bold text-white hover:bg-blue-700">New sale</button>
      </div>
    </Dialog>
  );
}

function HeldDrawer({ held, cashierId, onClose, onResume, onDiscard }: { held: HeldSale[]; cashierId: string; onClose: () => void; onResume: (basket: HeldSale) => void; onDiscard: (basket: HeldSale) => void }) {
  return (
    <Dialog title={`Held & draft transactions (${held.length})`} onClose={onClose} wide>
      {held.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No held or draft baskets. Use Hold to park a sale while a customer waits.</p> : (
        <ul className="divide-y divide-slate-100">
          {held.map((basket) => (
            <li key={basket.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-semibold text-slate-900"><span className="font-mono text-sm">{basket.reference}</span> <span className={`ml-1 rounded px-1.5 text-[10px] font-bold ${basket.kind === "DRAFT" ? "bg-slate-100 text-slate-600" : "bg-amber-100 text-amber-800"}`}>{basket.kind === "DRAFT" ? "Draft" : "Held"}</span></p>
                <p className="text-xs text-slate-500">{basket.label ? `${basket.label} · ` : ""}{basket.cart.lines.length} line(s) · {basket.cashierId === cashierId ? "you" : basket.cashierName} · {new Date(basket.updatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => onDiscard(basket)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-rose-50 hover:text-rose-700">Discard</button>
                <button type="button" onClick={() => onResume(basket)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700">Resume</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

type Detector = { detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]> };

/** Optional camera scanning using the browser's BarcodeDetector (Chrome/Edge/Android). */
function CameraScanner({ onClose, onCode }: { onClose: () => void; onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const Ctor = (window as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => Detector }).BarcodeDetector;
    if (!Ctor || !navigator.mediaDevices?.getUserMedia) {
      queueMicrotask(() => setError("Camera scanning is not supported in this browser. Use a USB/Bluetooth scanner or type the code."));
      return;
    }
    const detector = new Ctor({ formats: ["ean_13", "upc_a", "code_128", "ean_8"] });
    let stream: MediaStream | null = null;
    let stopped = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then(async (media) => {
        stream = media;
        if (!video.current) return;
        video.current.srcObject = media;
        await video.current.play();
        while (!stopped) {
          const codes = await detector.detect(video.current).catch(() => []);
          if (codes[0]?.rawValue) {
            onCode(codes[0].rawValue);
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      })
      .catch(() => setError("Camera permission was denied."));
    return () => {
      stopped = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onCode]);
  return (
    <Dialog title="Scan with camera" onClose={onClose}>
      {error ? <p className="text-sm text-slate-600">{error}</p> : <video ref={video} className="aspect-video w-full rounded-xl bg-black object-cover" muted playsInline />}
    </Dialog>
  );
}
