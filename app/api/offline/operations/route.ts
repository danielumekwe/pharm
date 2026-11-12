import { listOfflineOperations, unverifiedPayments } from "@/lib/erp/offline-reconcile";
import { guarded } from "@/lib/session";

export async function GET() {
  return guarded(["stock.approve", "sales.supervise"], async (actor) => ({ operations: await listOfflineOperations(actor), payments: unverifiedPayments(actor) }));
}
