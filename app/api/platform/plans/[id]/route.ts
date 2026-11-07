import { planUpdateSchema, updatePlanConfiguration } from "@/lib/platform/plans";
import { platformGuarded } from "@/lib/platform/session";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return platformGuarded("plans.manage", async (actor) =>
    updatePlanConfiguration(actor, id, planUpdateSchema.parse(await request.json())),
  );
}
