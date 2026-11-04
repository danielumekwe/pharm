import { NextResponse } from "next/server";
import { z } from "zod";

import { timingSafeEqual } from "node:crypto";

import { runDailySummary, runMonthlyReport, schedulerTick } from "@/lib/erp/alert-jobs";
import { scanAlerts } from "@/lib/erp/alerts";
import { withDatabaseTransaction } from "@/lib/db/database";
import { guarded } from "@/lib/session";

const schema = z.object({ job: z.enum(["scan", "daily", "monthly"]) });

async function run(job: "scan" | "daily" | "monthly", trigger?: { id: string; name: string; role: "SUPER_ADMIN" | "PHARMACY_MANAGER" | "REGULATORY_OFFICER" | "SALES_MANAGER" | "STOCK_MANAGER" | "STAFF" }) {
  if (job === "scan") return { job, created: scanAlerts().length };
  return job === "daily" ? runDailySummary(trigger) : runMonthlyReport(trigger);
}

function secretMatches(provided: string | null) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Scheduled run for hosts with HTTP cron (e.g. Vercel Cron), which call GET with
 * `Authorization: Bearer $CRON_SECRET`: scan alerts, retry failed emails, and send any due daily/monthly summary.
 */
export async function GET(request: Request) {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!secretMatches(bearer)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  return withDatabaseTransaction(async () => {
    await schedulerTick();
    return NextResponse.json({ ok: true, ranAt: new Date().toISOString() });
  });
}

/**
 * Runs an alert job now. Callable by central managers from the UI, or by an external scheduler
 * with the header `x-cron-secret: $CRON_SECRET` (for deployments that disable the in-process scheduler).
 */
export async function POST(request: Request) {
  if (secretMatches(request.headers.get("x-cron-secret"))) {
    return withDatabaseTransaction(async () => {
      const body = schema.safeParse(await request.json().catch(() => ({})));
      if (!body.success) return NextResponse.json({ error: "Invalid job." }, { status: 400 });
      return NextResponse.json(await run(body.data.job));
    });
  }
  return guarded("reports.consolidated", async (actor) => run(schema.parse(await request.json()).job, actor));
}
