import { z } from "zod";

import { DomainError } from "@/lib/erp/services";
import { getTemplate, isTemplateKey, resetTemplate, saveTemplate, templateHistory } from "@/lib/notify/templates";
import { platformGuarded } from "@/lib/platform/session";

const schema = z.object({ subject: z.string().max(200), body: z.string().max(10_000) });
const known = (key: string) => {
  if (!isTemplateKey(key)) throw new DomainError("Unknown template.", 404);
  return key;
};

export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return platformGuarded("settings.manage", async () => ({ template: await getTemplate(known(key)), history: await templateHistory(known(key)) }));
}

export async function PUT(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return platformGuarded("settings.manage", async (actor) => ({ template: await saveTemplate(actor, known(key), schema.parse(await request.json())) }));
}

/** Back to the built-in default. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return platformGuarded("settings.manage", async (actor) => ({ template: await resetTemplate(actor, known(key)) }));
}
