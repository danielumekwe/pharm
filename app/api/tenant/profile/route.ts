import { currentTenant, platformQuery } from "@/lib/db/database";
import { DomainError, recordAudit } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import { guarded } from "@/lib/session";
import { tenantProfileSchema } from "@/lib/saas/onboarding";

/** The signed-in pharmacy's business profile (its tenant record). Super Admin only. */
export async function PATCH(request: Request) {
  return guarded("settings.manage", async (actor) => {
    const input = tenantProfileSchema.parse(await request.json());
    const tenantId = currentTenant()?.id;
    if (!tenantId) throw new DomainError("No pharmacy selected.", 401);
    await platformQuery((query) =>
      query(
        `UPDATE tenants SET name = $1, business_email = $2, business_phone = $3, address = $4, country = $5, state = $6, currency = $7, time_zone = $8, updated_at = now() WHERE id = $9`,
        [input.businessName, input.businessEmail, input.businessPhone, input.address, input.country, input.state, input.currency, input.timeZone, tenantId],
      ),
    );
    getStore().settings.businessName = input.businessName;
    recordAudit(actor, { action: "settings.business-profile", entity: "Tenant", entityId: tenantId, summary: `Business profile updated (${input.businessName}, ${input.state})` });
    return { ok: true, profile: input };
  });
}
