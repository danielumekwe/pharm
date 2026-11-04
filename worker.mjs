import openNextWorker from "./.open-next/worker.js";
import { withDatabaseTransaction } from "./lib/db/database.ts";
import { schedulerTick } from "./lib/erp/alert-jobs.ts";

const worker = {
  fetch(request, env, ctx) {
    return openNextWorker.fetch(request, env, ctx);
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      withDatabaseTransaction(
        () => schedulerTick(),
        env.HYPERDRIVE.connectionString,
      ).catch((error) => {
        console.error("[alerts] scheduled job failed", error);
        throw error;
      }),
    );
  },
};

export default worker;
