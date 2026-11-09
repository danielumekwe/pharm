import { PlatformShell } from "@/components/platform/platform-shell";
import { requirePlatformPage } from "@/lib/platform/pages";
import { rateLimitDashboard } from "@/lib/platform/rate-limits";

import { RateLimitsWorkspace } from "./rate-limits-workspace";

export const metadata = { title: "Rate Limits & API Protection · Web365 platform" };

export default async function RateLimitsPage({ searchParams }: {
  searchParams: Promise<{ tenant?: string; ip?: string; endpoint?: string; from?: string; to?: string; eventType?: string }>;
}) {
  const actor = await requirePlatformPage("rateLimits.manage");
  const filters = await searchParams;
  const data = await rateLimitDashboard(filters);
  return (
    <PlatformShell actor={actor}>
      <h1 className="text-2xl font-bold">Rate Limits &amp; API Protection</h1>
      <p className="mt-1 text-sm text-slate-600">Distributed API controls for sign-in, pharmacy operations, and platform endpoints.</p>
      <RateLimitsWorkspace initial={data} filters={filters} />
    </PlatformShell>
  );
}
