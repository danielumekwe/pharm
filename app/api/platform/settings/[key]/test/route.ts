import { billingProvider } from "@/lib/billing/paystack";
import { DomainError } from "@/lib/erp/services";
import { platformActorRef, recordPlatformAudit } from "@/lib/platform/audit";
import { platformCan, platformGuarded } from "@/lib/platform/session";
import { lastChecks, recordIntegrationCheck, SETTINGS } from "@/lib/platform/settings";

/** Runs a real connection test for an integration and records the result. */
export async function POST(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return platformGuarded("dashboard.view", async (actor) => {
    if (key !== "payments.paystack") throw new DomainError("This integration has no connection test.", 404);
    if (!platformCan(actor, SETTINGS[key].permission)) throw new DomainError("Your platform role does not allow this.", 403);
    const result = await billingProvider().testConnection();
    await recordIntegrationCheck("paystack", result.ok, result.detail, actor.id);
    await recordPlatformAudit(platformActorRef(actor), { action: "settings.test", targetType: "Setting", targetId: key, summary: `Paystack connection test: ${result.ok ? "succeeded" : "failed"} (${result.detail})`, severity: result.ok ? "info" : "warning" });
    return { ...result, checks: await lastChecks("paystack") };
  });
}
