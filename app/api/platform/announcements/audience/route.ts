import { audienceSchema, audienceSize } from "@/lib/platform/content";
import { platformGuarded } from "@/lib/platform/session";

/** How many active pharmacies an audience reaches now. */
export async function POST(request: Request) {
  return platformGuarded("content.manage", async () => ({ pharmacies: await audienceSize(audienceSchema.parse(await request.json())) }));
}
