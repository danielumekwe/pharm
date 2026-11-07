import { z } from "zod";

import { DomainError } from "@/lib/erp/services";
import { platformCan, platformGuarded } from "@/lib/platform/session";
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
    return updatePlatformSetting(actor, key, input as Parameters<typeof updatePlatformSetting>[2]);
  });
}
