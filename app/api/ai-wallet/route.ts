import { walletOverview } from "@/lib/ai/pharmacy";
import { guarded } from "@/lib/session";

/** The signed-in pharmacy's AI Wallet: balances, prices, packages on sale, recent purchases. */
export async function GET() {
  return guarded(["ai.wallet.view", "ai.usage.view", "ai.coins.purchase", "ai.wallet.manage"], (actor) => walletOverview(actor));
}
