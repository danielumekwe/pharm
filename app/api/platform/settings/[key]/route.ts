import { z } from "zod";

import { DomainError } from "@/lib/erp/services";
import { ipAllowed } from "@/lib/platform/security";
import { platformCan, platformGuarded } from "@/lib/platform/session";
import { clientAddress } from "@/lib/saas/rate-limit";
import { describePlatformSetting, isSettingKey, SETTINGS, updatePlatformSetting } from "@/lib/platform/settings";

const schema = z.object({ value: z.record(z.string(), z.unknown()).optional(), secrets: z.record(z.string(), z.string().max(500).nullable()).optional() });

/** A platform setting with secrets masked. Needs the setting's own permission. */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return platformGuarded("dashboard.view", async (actor) => {
    if (!isSettingKey(key)) throw new DomainError("Unknown setting.", 404);
    if (!platformCan(actor, SETTINGS[key].permission)) throw new DomainError("Your platform role does not allow this.", 403);
    return describePlatformSetting(key);
  });
}

/** Validates and saves a platform setting; the answer never contains a secret. */
export async function PUT(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return platformGuarded("dashboard.view", async (actor) => {
    if (!isSettingKey(key)) throw new DomainError("Unknown setting.", 404);
    if (!platformCan(actor, SETTINGS[key].permission)) throw new DomainError("Your platform role does not allow this.", 403);
    const input = schema.parse(await request.json());
    // An allowlist that leaves out the address saving it would lock everyone here out at once.
    const allowlist = key === "security.policy" ? input.value?.ipAllowlist : undefined;
    if (Array.isArray(allowlist) && allowlist.length && allowlist.every((entry) => typeof entry === "string")) {
      const address = await clientAddress();
      let covered = true;
      try {
        covered = ipAllowed(address, allowlist as string[]);
      } catch {
        covered = true; // an invalid entry: the validation below reports it
      }
      if (!covered) throw new DomainError(`The allowlist must include the address you are using now (${address}), or you would be locked out.`, 400);
    }
    return updatePlatformSetting(actor, key, input as Parameters<typeof updatePlatformSetting>[2]);
  });
}
