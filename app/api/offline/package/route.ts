import { authenticateDevice, offlinePackage, proofFromHeaders } from "@/lib/erp/offline-devices";
import { guarded } from "@/lib/session";

/** The device's offline data. Needs the user's session and a signature from the device key. Never cached. */
export async function POST(request: Request) {
  return guarded("dashboard.view", async (actor) => {
    const device = await authenticateDevice(actor, proofFromHeaders(request.headers), "POST", "/api/offline/package");
    // Optional body { known: { productId: fingerprint } } asks for only what changed.
    const body = (await request.json().catch(() => ({}))) as { known?: unknown };
    const known = body.known && typeof body.known === "object" && !Array.isArray(body.known) && Object.keys(body.known).length <= 50_000 ? Object.fromEntries(Object.entries(body.known as Record<string, unknown>).filter(([, value]) => typeof value === "string")) as Record<string, string> : undefined;
    return new Response(JSON.stringify(await offlinePackage(actor, device, known)), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store, private" } });
  });
}
