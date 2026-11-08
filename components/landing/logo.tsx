import Image from "next/image";

/** PharmaERP mark (cross, mortar and Rx) with the typed wordmark. Always the product brand, never a pharmacy's logo. */
export function LandingLogo({ inverted = false, tagline = true }: { inverted?: boolean; tagline?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Image src="/pharma-erp-icon.png" alt="" width={232} height={232} className="h-9 w-9 shrink-0" priority />
      <span className="flex flex-col leading-none">
        <span className={`text-[1.3rem] font-bold tracking-tight ${inverted ? "text-white" : "text-brand-navy"}`}>
          Pharma<span className={inverted ? "text-emerald-300" : "text-brand-green"}>ERP</span>
        </span>
        {tagline ? (
          <span className={`mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${inverted ? "text-slate-300" : "text-brand-muted"}`}>
            Smart Pharmacy Management
          </span>
        ) : null}
      </span>
    </span>
  );
}
