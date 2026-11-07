import { listTemplates } from "@/lib/notify/templates";
import { platformGuarded } from "@/lib/platform/session";

export async function GET() {
  return platformGuarded("settings.manage", async () => ({ templates: await listTemplates() }));
}
