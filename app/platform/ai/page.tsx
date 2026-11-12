import { PlatformShell } from "@/components/platform/platform-shell";
import { aiDashboard } from "@/lib/ai/admin";
import { requirePlatformPage } from "@/lib/platform/pages";
import { platformCan } from "@/lib/platform/session";
import { providerStatus } from "@/lib/scanner/providers";

import { AiConsole } from "./ai-console";

export const metadata = { title: "AI Usage & Billing · Web365 platform" };

export default async function PlatformAiPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const actor = await requirePlatformPage("ai.view");
  const { tab } = await searchParams;
  const dashboard = await aiDashboard({});
  const provider = providerStatus();
  return (
    <PlatformShell actor={actor}>
      <div className="mb-5">
        <h1 className="text-2xl font-bold">AI Usage &amp; Billing</h1>
        <p className="mt-1 text-sm text-slate-600">
          AI coins, prices, coin packages, pharmacy usage, AI provider costs, spending limits and profitability. AI provider: {provider.configured ? `${provider.provider} (${provider.model})` : `not configured — ${provider.problem}`}. Keys stay on the server.
        </p>
      </div>
      <AiConsole initialTab={tab ?? "dashboard"} initialDashboard={dashboard} canManage={platformCan(actor, "ai.manage")} />
    </PlatformShell>
  );
}
