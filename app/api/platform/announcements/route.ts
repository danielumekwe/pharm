import { announcementSchema, listAnnouncements, saveAnnouncement } from "@/lib/platform/content";
import { platformGuarded } from "@/lib/platform/session";

export async function GET() {
  return platformGuarded("content.manage", async () => ({ announcements: await listAnnouncements() }));
}

/** A new announcement (a draft until published). */
export async function POST(request: Request) {
  return platformGuarded("content.manage", async (actor) => saveAnnouncement(actor, null, announcementSchema.parse(await request.json())), 201);
}
