import { stockLevels } from "@/lib/erp/pos";
import { guarded } from "@/lib/session";

/** Read-only stock levels for sales roles (stock.levels) and inventory roles (stock.view). */
export async function GET() {
  return guarded(["stock.levels", "stock.view"], (actor) => stockLevels(actor));
}
