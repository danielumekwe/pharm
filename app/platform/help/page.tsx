import { PlatformShell } from "@/components/platform/platform-shell";
import { listArticles } from "@/lib/platform/content";
import { requirePlatformPage } from "@/lib/platform/pages";

import { ArticleEditor } from "./article-editor";

export const metadata = { title: "Help articles · Web365 platform" };

export default async function HelpArticlesPage() {
  const actor = await requirePlatformPage("content.manage");
  const articles = await listArticles({ publishedOnly: false });
  return (
    <PlatformShell actor={actor}>
      <h1 className="text-2xl font-bold">Help articles</h1>
      <p className="text-sm text-slate-600">The knowledge base pharmacies see under Help. Plain text; blank lines start new paragraphs and links become clickable.</p>
      <section className="mt-4 space-y-3" data-articles>
        <ArticleEditor article={null} />
        {articles.map((article) => <ArticleEditor key={article.id} article={article} />)}
      </section>
    </PlatformShell>
  );
}
