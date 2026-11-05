import { salesFeed } from "@/lib/erp/sales-feed";
import { guarded } from "@/lib/session";

/** Polled by the dashboard so sales reps see new sales without reloading. */
export async function GET() {
  return guarded("sales.view", (actor) => salesFeed(actor));
}
