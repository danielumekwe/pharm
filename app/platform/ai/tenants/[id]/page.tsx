import { notFound } from "next/navigation";

import { PlatformShell } from "@/components/platform/platform-shell";
import { tenantDetail } from "@/lib/ai/admin";
import { DomainError } from "@/lib/erp/services";
import { requirePlatformPage } from "@/lib/platform/pages";
import { platformCan } from "@/lib/platform/session";

import { TenantAiDetail } from "./tenant-ai-detail";

export const metadata = { title: "Pharmacy AI usage · Web365 platform" };

export default async function TenantAiPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePlatformPage("ai.view");
  const { id } = await params;
  let detail;
  try {
    detail = await tenantDetail(id);
  } catch (error) {
    if (error instanceof DomainError && error.status === 404) notFound();
    throw error;
  }
  return (
    <PlatformShell actor={actor}>
      <TenantAiDetail initial={JSON.parse(JSON.stringify(detail))} canManage={platformCan(actor, "ai.manage")} />
    </PlatformShell>
  );
}
