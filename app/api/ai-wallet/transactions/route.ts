import { walletTransactions } from "@/lib/ai/pharmacy";
import { guarded } from "@/lib/session";

/** Coin ledger of the signed-in pharmacy: ?type=&from=YYYY-MM-DD&to=YYYY-MM-DD&page=&pageSize= */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return guarded(["ai.wallet.view", "ai.wallet.manage"], (actor) =>
    walletTransactions(actor, { type: params.get("type"), from: params.get("from"), to: params.get("to"), page: Number(params.get("page") ?? 1), pageSize: Number(params.get("pageSize") ?? 25) }),
  );
}
