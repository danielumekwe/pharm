"use client";

import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";
import type { ReactNode } from "react";

import { BrandingProvider } from "@/components/branding";
import { NativeBridge } from "@/components/native-bridge";
import type { Branding } from "@/lib/erp/branding";

/** The server passes the session it already resolved, so permission-based menus render correctly on first paint. */
export function Providers({ branding, session, children }: { branding: Branding; session?: Session | null; children: ReactNode }) {
  return (
    <SessionProvider session={session ?? undefined}>
      <BrandingProvider value={branding}>
        <NativeBridge />
        {children}
      </BrandingProvider>
    </SessionProvider>
  );
}
