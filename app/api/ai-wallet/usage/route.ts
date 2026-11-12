import { walletUsage } from "@/lib/ai/pharmacy";
import { guarded } from "@/lib/session";

/** AI usage of the signed-in pharmacy by staff, job and operation: ?from=&to= */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return guarded(["ai.usage.view", "ai.wallet.manage"], (actor) => walletUsage(actor, { from: params.get("from"), to: params.get("to") }));
}
