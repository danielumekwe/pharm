import { createPlan, planCreateSchema } from "@/lib/platform/plans";
import { platformGuarded } from "@/lib/platform/session";

export async function POST(request: Request) {
  return platformGuarded("plans.manage", async (actor) => createPlan(actor, planCreateSchema.parse(await request.json())), 201);
}
