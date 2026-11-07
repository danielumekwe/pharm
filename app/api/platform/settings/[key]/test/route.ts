import { billingProvider } from "@/lib/billing/paystack";
import { DomainError } from "@/lib/erp/services";
import { testEmailConnection } from "@/lib/notify/email";
import { platformActorRef, recordPlatformAudit } from "@/lib/platform/audit";
import { platformCan, platformGuarded } from "@/lib/platform/session";
import { lastChecks, recordIntegrationCheck, SETTINGS } from "@/lib/platform/settings";

/** Runs a real connection test for an integration and records the result. */
export async function POST(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return platformGuarded("dashboard.view", async (actor) => {
    const tests = {
      "payments.paystack": { integration: "paystack", label: "Paystack", run: () => billingProvider().testConnection() },
      "email.delivery": { integration: "email", label: "Email", run: () => testEmailConnection() },
    } as const;
    if (!(key in tests)) throw new DomainError("This integration has no connection test.", 404);
    const test = tests[key as keyof typeof tests];
    if (!platformCan(actor, SETTINGS[key as keyof typeof tests].permission)) throw new DomainError("Your platform role does not allow this.", 403);
    const result = await test.run();
    await recordIntegrationCheck(test.integration, result.ok, result.detail, actor.id);
    await recordPlatformAudit(platformActorRef(actor), { action: "settings.test", targetType: "Setting", targetId: key, summary: `${test.label} connection test: ${result.ok ? "succeeded" : "failed"} (${result.detail})`, severity: result.ok ? "info" : "warning" });
    return { ...result, checks: await lastChecks(test.integration) };
  });
}
