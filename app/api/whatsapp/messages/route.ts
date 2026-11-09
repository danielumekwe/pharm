import { sessionTenant } from "@/lib/notify/whatsapp/pharmacy-scope";
import { listMessages } from "@/lib/notify/whatsapp/service";
import { guarded } from "@/lib/session";

/** This pharmacy's WhatsApp message history only (any tenant filter in the request is ignored). */
export async function GET(request: Request) {
  return guarded("settings.manage", async () => {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    return { messages: await listMessages(params, sessionTenant(), 100) };
  });
}
