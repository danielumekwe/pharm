import { redirect } from "next/navigation";
import { connection } from "next/server";

import { getPlatformActor, platformCan, type PlatformPermission } from "@/lib/platform/session";

/** Platform page guard: platform sign-in required (pharmacy sessions do not count), then the permission. */
export async function requirePlatformPage(permission: PlatformPermission) {
  await connection();
  const actor = await getPlatformActor();
  if (!actor) redirect("/platform/login");
  if (!platformCan(actor, permission)) redirect("/platform?denied=1");
  return actor;
}
