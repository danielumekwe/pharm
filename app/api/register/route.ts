import { NextResponse } from "next/server";

import { DomainError } from "@/lib/erp/services";
import { DEFAULT_MAINTENANCE_MESSAGE, systemConfig } from "@/lib/platform/system";
import { isCaptchaError, verifyRecaptcha } from "@/lib/recaptcha";
import { clientAddress } from "@/lib/saas/rate-limit";
import { registerPharmacy, registrationSchema } from "@/lib/saas/registration";

/** Public: registers a new pharmacy. Safe to retry with the same requestId. */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = registrationSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return NextResponse.json({ error: issue?.message ?? "Some fields are missing or invalid.", field: issue?.path?.join(".") }, { status: 422 });
    }
    const config = await systemConfig();
    if (config.maintenance) return NextResponse.json({ error: config.maintenanceMessage || DEFAULT_MAINTENANCE_MESSAGE }, { status: 503 });
    if (!config.registrationOpen) return NextResponse.json({ error: "New registrations are closed at the moment. Contact Web365 to open an account." }, { status: 403 });
    await verifyRecaptcha((body as { recaptchaToken?: unknown }).recaptchaToken, "register", await clientAddress());
    const result = await registerPharmacy(parsed.data);
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (isCaptchaError(error)) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof DomainError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[register]", error);
    return NextResponse.json({ error: "Registration is unavailable right now. Please try again." }, { status: 503 });
  }
}
