import { articleSchema, deleteArticle, saveArticle } from "@/lib/platform/content";
import { platformGuarded } from "@/lib/platform/session";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return platformGuarded("content.manage", async (actor) => saveArticle(actor, id, articleSchema.parse(await request.json())));
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return platformGuarded("content.manage", async (actor) => deleteArticle(actor, id));
}
