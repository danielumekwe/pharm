import { articleSchema, listArticles, saveArticle } from "@/lib/platform/content";
import { platformGuarded } from "@/lib/platform/session";

export async function GET() {
  return platformGuarded("content.manage", async () => ({ articles: await listArticles({ publishedOnly: false }) }));
}

export async function POST(request: Request) {
  return platformGuarded("content.manage", async (actor) => saveArticle(actor, null, articleSchema.parse(await request.json())), 201);
}
