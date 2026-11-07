import { z } from "zod";

import { sendEmail } from "@/lib/notify/email";
import { renderEmail } from "@/lib/notify/templates";
import { platformActorRef, recordPlatformAudit } from "@/lib/platform/audit";
import { platformGuarded } from "@/lib/platform/session";
import { recordIntegrationCheck } from "@/lib/platform/settings";

const schema = z.object({ to: z.string().trim().toLowerCase().email().max(160) });

/** Sends a real test email with the current settings; the result counts as an email check. */
export async function POST(request: Request) {
  return platformGuarded("settings.manage", async (actor) => {
    const { to } = schema.parse(await request.json());
    const email = await renderEmail("system_announcement", { name: actor.name, title: "Test email from Pharmacy ERP", message: `This is a test email sent by ${actor.name} from the Web365 Control Centre at ${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC. If you can read it, email delivery works.` });
    const result = await sendEmail({ to, ...email }, { category: "test", template: "system_announcement" });
    await recordIntegrationCheck("email", result.status === "SENT", result.status === "SENT" ? `Test email to ${to} accepted (${result.detail})` : `Test email to ${to} ${result.status.toLowerCase()}: ${result.detail}`, actor.id);
    await recordPlatformAudit(platformActorRef(actor), { action: "email.test-send", targetType: "Email", targetId: to, summary: `Test email to ${to}: ${result.status.toLowerCase()}`, severity: result.status === "SENT" ? "info" : "warning" });
    return result;
  });
}
