import { NextResponse } from "next/server";

import { DomainError } from "@/lib/erp/services";
import { DEFAULT_MAINTENANCE_MESSAGE, systemConfig } from "@/lib/platform/system";
import { clientAddress, hit, RateLimitError } from "@/lib/saas/rate-limit";
import { registerPharmacy, registrationSchema } from "@/lib/saas/registration";

/** Public: registers a new pharmacy. Safe to retry with the same requestId. */
export async function POST(request: Request) {
  try {
    const parsed = registrationSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return NextResponse.json({ error: issue?.message ?? "Some fields are missing or invalid.", field: issue?.path?.join(".") }, { status: 422 });
    }
    const config = await systemConfig();
    if (config.maintenance) return NextResponse.json({ error: config.maintenanceMessage || DEFAULT_MAINTENANCE_MESSAGE }, { status: 503 });
    if (!config.registrationOpen) return NextResponse.json({ error: "New registrations are closed at the moment. Contact Web365 to open an account." }, { status: 403 });
    hit(`register:ip:${await clientAddress()}`, 5, 60 * 60_000);
    const result = await registerPharmacy(parsed.data);
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof RateLimitError) return NextResponse.json({ error: error.message }, { status: 429 });
    if (error instanceof DomainError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[register]", error);
    return NextResponse.json({ error: "Registration is unavailable right now. Please try again." }, { status: 503 });
  }
}
