// Drawn previews of PharmaERP screens for the landing page. They are illustrations with sample data, not
// screenshots, and each one says so. Decorative detail is hidden from screen readers; the frame names the screen.
import { AlertTriangle, BarChart3, Boxes, CalendarClock, LayoutDashboard, Plus, ScanBarcode, Search, ShoppingCart, Users } from "lucide-react";
import type { ReactNode } from "react";

const SAMPLE_NOTE = "Illustrative preview · sample data";

export function PreviewFrame({ title, children, className = "", note = true }: { title: string; children: ReactNode; className?: string; note?: boolean }) {
  return (
    <figure className={`overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_24px_60px_-28px_rgba(15,42,82,0.35)] ${className}`}>
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-3 py-2" aria-hidden="true">
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        <span className="ml-2 truncate rounded bg-white px-2 py-0.5 text-[10px] text-slate-400 ring-1 ring-slate-200">PharmaERP · {title}</span>
      </div>
      <div aria-hidden="true">{children}</div>
      <figcaption className={note ? "border-t border-slate-100 px-3 py-1.5 text-[10px] font-medium text-slate-400" : "sr-only"}>
        <span className="sr-only">{title}: </span>{SAMPLE_NOTE}
      </figcaption>
    </figure>
  );
}

const SALES = [42, 48, 45, 58, 54, 66, 61, 72, 69, 80, 76, 88];

function SalesChart() {
  const width = 320;
  const height = 96;
  const max = 100;
  const step = width / (SALES.length - 1);
  const points = SALES.map((value, index) => `${(index * step).toFixed(1)},${(height - (value / max) * height).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-24 w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="lp-sales" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#1a5aa6" stopOpacity="0.18" />
          <stop offset="1" stopColor="#1a5aa6" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((line) => <line key={line} x1="0" x2={width} y1={height * line} y2={height * line} stroke="#eef2f7" strokeWidth="1" />)}
      <polygon points={`0,${height} ${points.join(" ")} ${width},${height}`} fill="url(#lp-sales)" />
      <polyline points={points.join(" ")} fill="none" stroke="#1a5aa6" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Kpi({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-white p-2.5">
      <p className="text-[10px] font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-bold text-brand-ink sm:text-base">{value}</p>
      <p className="mt-0.5 text-[10px] text-brand-green-dark">{note}</p>
    </div>
  );
}

/** The pharmacy dashboard: KPIs, a sales trend, recent activity and the New sale action. */
export function DashboardPreview({ className = "", note = true }: { className?: string; note?: boolean }) {
  const nav = [LayoutDashboard, ShoppingCart, Boxes, CalendarClock, BarChart3, Users];
  return (
    <PreviewFrame title="Dashboard" className={className} note={note}>
      <div className="flex bg-brand-sky/60">
        <div className="hidden w-11 shrink-0 flex-col items-center gap-3 bg-brand-navy py-3 sm:flex">
          {nav.map((Icon, index) => (
            <span key={index} className={`flex h-7 w-7 items-center justify-center rounded-md ${index === 0 ? "bg-white/15 text-white" : "text-slate-400"}`}><Icon className="h-3.5 w-3.5" /></span>
          ))}
        </div>
        <div className="min-w-0 flex-1 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] text-slate-500">Lekki outlet · Today</p>
              <p className="text-sm font-bold text-brand-ink">Good morning, Amaka</p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-md bg-brand-green px-2.5 py-1.5 text-[11px] font-bold tracking-wide text-white shadow-sm">
              <Plus className="h-3 w-3" strokeWidth={3} /> NEW SALE
            </span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Kpi label="Total sales" value="₦482,750" note="+12% vs yesterday" />
            <Kpi label="Inventory value" value="₦12.4m" note="1,284 items" />
            <Kpi label="Transactions" value="136" note="Avg ₦3,550" />
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1.5fr_1fr]">
            <div className="rounded-lg border border-slate-100 bg-white p-2.5">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-brand-ink">Sales this week</p>
                <p className="text-[10px] text-slate-400">₦ thousands</p>
              </div>
              <SalesChart />
            </div>
            <div className="rounded-lg border border-slate-100 bg-white p-2.5">
              <p className="text-[11px] font-semibold text-brand-ink">Recent activity</p>
              <ul className="mt-2 space-y-2 text-[10px]">
                <li className="flex justify-between gap-2"><span className="truncate text-slate-600">Sale INV-20418</span><span className="font-semibold text-brand-ink">₦8,400</span></li>
                <li className="flex justify-between gap-2"><span className="truncate text-slate-600">Stock received · GRN-311</span><span className="text-brand-green-dark">+240</span></li>
                <li className="flex justify-between gap-2"><span className="truncate text-slate-600">Transfer to Ikeja</span><span className="text-slate-500">36 units</span></li>
                <li className="flex justify-between gap-2"><span className="truncate text-amber-700">Low stock · Amoxicillin</span><span className="text-amber-700">12 left</span></li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </PreviewFrame>
  );
}

/** Point of sale: cart, barcode search and the tender buttons. */
export function PosPreview({ className = "", note = true }: { className?: string; note?: boolean }) {
  const lines = [
    ["Paracetamol 500mg × 2 packs", "₦1,600"],
    ["Vitamin C 1000mg × 1", "₦2,350"],
    ["Amoxicillin 500mg caps × 1", "₦3,200"],
  ];
  return (
    <PreviewFrame title="Point of sale" className={className} note={note}>
      <div className="p-3">
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2 text-[11px] text-slate-400">
          <ScanBarcode className="h-3.5 w-3.5 text-brand-blue" /> Scan barcode or search product
        </div>
        <ul className="mt-2 divide-y divide-slate-100 text-[11px]">
          {lines.map(([item, price]) => (
            <li key={item} className="flex justify-between gap-2 py-1.5"><span className="truncate text-slate-600">{item}</span><span className="font-semibold text-brand-ink">{price}</span></li>
          ))}
        </ul>
        <div className="mt-2 flex items-center justify-between rounded-lg bg-brand-sky px-2.5 py-2">
          <span className="text-[11px] font-medium text-slate-600">Total</span>
          <span className="text-sm font-bold text-brand-ink">₦7,150</span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5 text-center text-[10px] font-semibold">
          <span className="rounded-md border border-slate-200 py-1.5 text-slate-600">Cash</span>
          <span className="rounded-md border border-brand-blue bg-brand-blue/5 py-1.5 text-brand-blue">Card</span>
          <span className="rounded-md border border-slate-200 py-1.5 text-slate-600">Transfer</span>
        </div>
        <span className="mt-2 block rounded-md bg-brand-green py-2 text-center text-[11px] font-bold text-white">Complete sale</span>
      </div>
    </PreviewFrame>
  );
}

/** Inventory list with stock levels and value. */
export function InventoryPreview({ className = "", note = true }: { className?: string; note?: boolean }) {
  const rows: Array<[string, string, string, "ok" | "low"]> = [
    ["Artemether/Lumefantrine 80/480", "184", "₦331,200", "ok"],
    ["Metformin 500mg", "96", "₦86,400", "ok"],
    ["Amoxicillin 500mg caps", "12", "₦38,400", "low"],
    ["Ciprofloxacin 500mg", "142", "₦227,200", "ok"],
  ];
  return (
    <PreviewFrame title="Inventory" className={className} note={note}>
      <div className="p-3">
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-400"><Search className="h-3.5 w-3.5" /> Search inventory</div>
        <table className="mt-2 w-full text-left text-[10px]">
          <thead className="text-slate-400"><tr><th className="py-1 font-medium">Product</th><th className="py-1 text-right font-medium">Qty</th><th className="py-1 text-right font-medium">Value</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(([name, qty, value, state]) => (
              <tr key={name}>
                <td className="max-w-0 truncate py-1.5 pr-2 text-slate-600">{name}</td>
                <td className={`py-1.5 text-right font-semibold ${state === "low" ? "text-amber-700" : "text-brand-ink"}`}>{qty}</td>
                <td className="py-1.5 text-right text-slate-600">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PreviewFrame>
  );
}

/** Batches by expiry date, soonest first. */
export function ExpiryPreview({ className = "", note = true }: { className?: string; note?: boolean }) {
  const rows: Array<[string, string, string, "red" | "amber" | "green"]> = [
    ["Ibuprofen 400mg · B2291", "14 days", "Expires soon", "red"],
    ["Cetirizine 10mg · C1180", "48 days", "Within 90 days", "amber"],
    ["Omeprazole 20mg · A7713", "7 months", "Good", "green"],
  ];
  const tone = { red: "bg-red-50 text-red-700", amber: "bg-amber-50 text-amber-800", green: "bg-emerald-50 text-emerald-700" };
  return (
    <PreviewFrame title="Batches & expiry" className={className} note={note}>
      <div className="p-3">
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-800"><AlertTriangle className="h-3.5 w-3.5" /> 3 batches expire within 90 days</div>
        <ul className="mt-2 space-y-1.5 text-[10px]">
          {rows.map(([batch, left, label, state]) => (
            <li key={batch} className="flex items-center justify-between gap-2 rounded-md border border-slate-100 px-2 py-1.5">
              <span className="min-w-0 truncate text-slate-600">{batch}</span>
              <span className="flex shrink-0 items-center gap-1.5"><span className="text-slate-500">{left}</span><span className={`rounded px-1.5 py-0.5 font-semibold ${tone[state]}`}>{label}</span></span>
            </li>
          ))}
        </ul>
      </div>
    </PreviewFrame>
  );
}
