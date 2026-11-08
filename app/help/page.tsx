import Link from "next/link";

import { DashboardShell } from "@/components/dashboard-shell";
import { PageHeader } from "@/components/erp/page-header";
import { Panel } from "@/components/erp/stat-card";
import { listArticles } from "@/lib/platform/content";
import { pageData } from "@/lib/session";

export const metadata = { title: "Help articles" };

export default async function HelpPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  return pageData("dashboard.view", "/help", async () => {
    const articles = await listArticles({ publishedOnly: true, q: q?.slice(0, 100) });
    const categories = [...new Set(articles.map((article) => article.category))];
    return (
      <DashboardShell>
        <div className="space-y-6">
          <PageHeader eyebrow="System" title="Help articles" description="Guides from Web365. Can't find an answer? Open a support ticket." actions={<Link href="/support" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">Contact support</Link>} />
          <form method="get" className="flex gap-2"><input name="q" defaultValue={q ?? ""} placeholder="Search help" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /><button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Search</button></form>
          {articles.length === 0 ? <p className="text-sm text-slate-400" data-help-empty>{q ? "No article matches." : "No help articles yet."}</p> : categories.map((category) => (
            <Panel key={category} title={category}>
              <ul className="divide-y divide-slate-800" data-help-list>
                {articles.filter((article) => article.category === category).map((article) => <li key={article.id} className="py-2 text-sm"><Link href={`/help/${article.slug}`} className="font-medium text-white hover:underline">{article.title}</Link></li>)}
              </ul>
            </Panel>
          ))}
        </div>
      </DashboardShell>
    );
  });
}
