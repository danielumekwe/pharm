// Node.js server startup: open the database, then start the alert scheduler.
// There is no periodic flush: every change is saved by the tenant transaction that makes it.
import { initDatabase } from "@/lib/db/database";
import { startScheduler } from "@/lib/erp/scheduler";

export async function startServer() {
  await initDatabase();
  startScheduler();
}
