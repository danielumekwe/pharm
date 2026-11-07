import { z } from "zod";

import { DomainError } from "@/lib/erp/services";
import { EMAIL_TEMPLATES, isTemplateKey, previewTemplate } from "@/lib/notify/templates";
import { platformGuarded } from "@/lib/platform/session";

const schema = z.object({ subject: z.string().max(200), body: z.string().max(10_000) });

/** Renders unsaved text with sample values (and checks its variables) without saving anything. */
export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return platformGuarded("settings.manage", async () => {
    if (!isTemplateKey(key)) throw new DomainError("Unknown template.", 404);
    return previewTemplate(key, schema.parse(await request.json()), EMAIL_TEMPLATES[key].variables);
  });
}
