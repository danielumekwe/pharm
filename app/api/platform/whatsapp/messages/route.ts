import { listMessages } from "@/lib/notify/whatsapp/service";
import { platformGuarded } from "@/lib/platform/session";

/** WhatsApp message history for all pharmacies. Filters: tenant, recipient, status, category, from, to. */
export async function GET(request: Request) {
  return platformGuarded("settings.manage", async () => {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    return { messages: await listMessages(params, null) };
  });
}
