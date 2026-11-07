import openNextWorker from "./.open-next/worker.js";
import { schedulerTick } from "./lib/erp/alert-jobs.ts";
import { forEachTenant, runPlatformJobs } from "./lib/saas/jobs.ts";

const worker = {
  fetch(request, env, ctx) {
    return openNextWorker.fetch(request, env, ctx);
  },
  scheduled(_controller, env, ctx) {
    // Every active pharmacy in turn, each in its own tenant transaction.
    ctx.waitUntil(
      forEachTenant(() => schedulerTick(), env.HYPERDRIVE.connectionString, { name: "alert-jobs", trigger: "worker-cron" })
        .then(() => runPlatformJobs("worker-cron", env.HYPERDRIVE.connectionString))
        .catch((error) => {
        console.error("[alerts] scheduled job failed", error);
        throw error;
      }),
    );
  },
};

export default worker;
