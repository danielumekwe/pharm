// Node.js server startup: open the database, then start the alert scheduler.
import { flushDatabase, initDatabase } from "@/lib/db/database";
import { startScheduler } from "@/lib/erp/scheduler";

export async function startServer() {
  await initDatabase();

  // Safety net for changes made outside API requests; also flush on shutdown.
  const timer = setInterval(() => {
    void flushDatabase().catch((error) => console.error("[db] periodic flush failed", error));
  }, 10_000);
  timer.unref?.();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void flushDatabase().finally(() => process.exit(0));
    });
  }

  startScheduler();
}
