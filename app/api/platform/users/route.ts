import { createStaff, listStaff, staffSchema } from "@/lib/platform/staff";
import { platformGuarded } from "@/lib/platform/session";

export async function GET() {
  return platformGuarded("staff.manage", async () => ({ staff: await listStaff() }));
}

export async function POST(request: Request) {
  return platformGuarded("staff.manage", async (actor) => createStaff(actor, staffSchema.parse(await request.json())), 201);
}
