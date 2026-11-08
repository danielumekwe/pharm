import { z } from "zod";

import { schedulerTick } from "@/lib/erp/alert-jobs";
import { platformActorRef, recordPlatformAudit } from "@/lib/platform/audit";
import { platformGuarded } from "@/lib/platform/session";
import { forEachTenant, runPlatformJobs } from "@/lib/saas/jobs";

const schema = z.object({ job: z.enum(["alert-jobs", "email-queue"]) });

/** Runs a background job now (even when its schedule is switched off). */
export async function POST(request: Request) {
  return platformGuarded("settings.manage", async (actor) => {
    const { job } = schema.parse(await request.json());
    await recordPlatformAudit(platformActorRef(actor), { action: "system.job-run", targetType: "Job", targetId: job, summary: `Started ${job} by hand` });
    if (job === "email-queue") return { job, result: await runPlatformJobs("manual") };
    const results = await forEachTenant(() => schedulerTick(), undefined, { name: "alert-jobs", trigger: "manual" });
    return { job, result: { pharmacies: results.length, failed: results.filter((entry) => !entry.ok).length } };
  });
}
