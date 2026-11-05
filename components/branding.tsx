"use client";

import Image from "next/image";
import { createContext, useContext, type ReactNode } from "react";
import type { Branding } from "@/lib/erp/branding";

const BrandingContext = createContext<Branding>({ name: "Pharmacy ERP", logoFile: null });

export function BrandingProvider({ value, children }: { value: Branding; children: ReactNode }) {
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding() {
  return useContext(BrandingContext);
}

export function BrandName({ className }: { className?: string }) {
  return <span className={className}>{useBranding().name}</span>;
}

function UploadedLogo({ className, name, logoFile }: { className: string; name: string; logoFile: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- small user-uploaded image served by our own route
  return <img src={`/api/branding/logo?v=${encodeURIComponent(logoFile)}`} alt={`${name} logo`} className={`${className} object-contain`} />;
}

/** Square logo icon (cross, mortar and Rx) for tight spaces such as the collapsed sidebar. An uploaded logo replaces it. */
export function BrandLogo({ className = "h-14 w-14" }: { id?: string; className?: string }) {
  const { name, logoFile } = useBranding();
  if (logoFile) return <UploadedLogo className={className} name={name} logoFile={logoFile} />;
  return <Image src="/pharma-erp-icon.png" alt={`${name} logo`} width={232} height={232} className={`${className} object-contain`} priority />;
}

/** Full logo with the PharmaERP wordmark, used wherever the brand appears (no typed name next to it). */
export function BrandWordmark({ className = "h-12 w-auto" }: { className?: string }) {
  const { name, logoFile } = useBranding();
  if (logoFile) return <UploadedLogo className={className} name={name} logoFile={logoFile} />;
  return <Image src="/pharma-erp-logo.png" alt={`${name} — Pharmacy Management System`} width={681} height={224} className={`${className} object-contain`} priority />;
}
