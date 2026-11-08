import Link from "next/link";
import { notFound } from "next/navigation";

import { DashboardShell } from "@/components/dashboard-shell";
import { PageHeader } from "@/components/erp/page-header";
import { Panel } from "@/components/erp/stat-card";
import { articleBySlug } from "@/lib/platform/content";
import { pageData } from "@/lib/session";

export const metadata = { title: "Help article" };

/** Article text is plain: paragraphs and clickable links only (no HTML is rendered from it). */
function Paragraphs({ text }: { text: string }) {
  return text.split(/\n{2,}/).map((paragraph, index) => (
    <p key={index} className="whitespace-pre-wrap text-sm text-white">
      {paragraph.split(/(https?:\/\/[^\s]+)/g).map((part, partIndex) => (/^https?:\/\//.test(part) ? <a key={partIndex} href={part} target="_blank" rel="noopener noreferrer" className="text-green-600 underline">{part}</a> : part))}
    </p>
  ));
}

export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return pageData("dashboard.view", "/help", async () => {
    const article = await articleBySlug(slug, true);
    if (!article) notFound();
    return (
      <DashboardShell>
        <div className="space-y-6">
          <Link href="/help" className="text-sm text-green-700 hover:underline">← Help articles</Link>
          <PageHeader eyebrow={article.category} title={article.title} description={`Updated ${article.updatedAt.slice(0, 10)}`} />
          <Panel title="" ><div className="space-y-3" data-help-article><Paragraphs text={article.body} /></div></Panel>
        </div>
      </DashboardShell>
    );
  });
}
