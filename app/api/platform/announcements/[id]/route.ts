import { z } from "zod";

import { announcementSchema, archiveAnnouncement, publishAnnouncement, saveAnnouncement } from "@/lib/platform/content";
import { platformGuarded } from "@/lib/platform/session";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return platformGuarded("content.manage", async (actor) => saveAnnouncement(actor, id, announcementSchema.parse(await request.json())));
}

/** {action: "publish"} shows it (and emails, if chosen); {action: "archive"} takes it down. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return platformGuarded("content.manage", async (actor) => {
    const { action } = z.object({ action: z.enum(["publish", "archive"]) }).parse(await request.json());
    return action === "publish" ? publishAnnouncement(actor, id) : archiveAnnouncement(actor, id);
  });
}
