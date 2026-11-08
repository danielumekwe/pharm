import { z } from "zod";

import { platformGuarded } from "@/lib/platform/session";
import { backupHistory, recordProviderBackup } from "@/lib/platform/system";

const schema = z.object({ label: z.string().max(120), takenAt: z.string().max(40), location: z.string().max(300).default(""), note: z.string().max(500).default("") });

export async function GET() {
  return platformGuarded("settings.manage", async () => ({ backups: await backupHistory() }));
}

/** Notes a backup made at the hosting provider (e.g. a Neon branch) in the history. */
export async function POST(request: Request) {
  return platformGuarded("settings.manage", async (actor) => recordProviderBackup(actor, schema.parse(await request.json())), 201);
}
