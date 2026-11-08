import { z } from "zod";

import { beginTwoFactorSetup, confirmTwoFactorSetup, disableTwoFactor, regenerateRecoveryCodes, twoFactorStatus } from "@/lib/platform/security";
import { platformGuarded } from "@/lib/platform/session";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("begin") }),
  z.object({ action: z.literal("confirm"), code: z.string().trim().max(20) }),
  z.object({ action: z.literal("disable"), password: z.string().min(1).max(128), code: z.string().trim().max(20) }),
  z.object({ action: z.literal("recovery-codes"), password: z.string().min(1).max(128), code: z.string().trim().max(20) }),
]);

export async function GET() {
  return platformGuarded("self", async (actor) => twoFactorStatus(actor.id));
}

/** The signed-in person's own two-factor sign-in: set up, confirm, turn off, or replace recovery codes. */
export async function POST(request: Request) {
  return platformGuarded("self", async (actor) => {
    const input = schema.parse(await request.json());
    if (input.action === "begin") return beginTwoFactorSetup(actor);
    if (input.action === "confirm") return confirmTwoFactorSetup(actor, input.code);
    if (input.action === "disable") return disableTwoFactor(actor, input.password, input.code);
    return regenerateRecoveryCodes(actor, input.password, input.code);
  });
}
