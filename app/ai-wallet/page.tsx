import { DashboardShell } from "@/components/dashboard-shell";
import { walletOverview } from "@/lib/ai/pharmacy";
import { pageData } from "@/lib/session";

import { WalletWorkspace } from "./wallet-workspace";

export const metadata = { title: "AI Wallet" };

export default async function AiWalletPage({ searchParams }: { searchParams: Promise<{ tab?: string; purchased?: string }> }) {
  const { tab, purchased } = await searchParams;
  return pageData(["ai.wallet.view", "ai.usage.view", "ai.coins.purchase", "ai.wallet.manage"], "/ai-wallet", async (actor) => {
    const overview = await walletOverview(actor);
    return (
      <DashboardShell>
        <WalletWorkspace initial={overview} initialTab={tab ?? "overview"} purchased={purchased === "1"} />
      </DashboardShell>
    );
  });
}
