import { getStockMovementsServer } from "@/lib/data";
import { scopeByOutlet } from "@/lib/erp/services";
import { guarded } from "@/lib/session";

// Movement requests are raised through /api/stock-movements (validated, linked to an item id and batch).
export async function GET() {
  return guarded("stock.view", async (actor) => scopeByOutlet(actor, await getStockMovementsServer(), (movement) => movement.outletId));
}
