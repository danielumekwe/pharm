import { PlatformShell } from "@/components/platform/platform-shell";
import { listAnnouncements } from "@/lib/platform/content";
import { requirePlatformPage } from "@/lib/platform/pages";
import { listPlanConfigurations } from "@/lib/platform/plans";
import { listTenants } from "@/lib/platform/tenants";

import { AnnouncementEditor, AnnouncementRow } from "./announcement-editor";

export const metadata = { title: "Announcements · Web365 platform" };

export default async function AnnouncementsPage() {
  const actor = await requirePlatformPage("content.manage");
  const [announcements, plans, tenants] = await Promise.all([listAnnouncements(), listPlanConfigurations(), listTenants({ status: "ACTIVE" })]);
  return (
    <PlatformShell actor={actor}>
      <h1 className="text-2xl font-bold">Announcements</h1>
      <p className="text-sm text-slate-600">Messages shown as a banner inside the pharmacy app until each person dismisses them. Optionally emailed to each pharmacy&apos;s Super Admins when published.</p>
      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">New announcement</h2>
        <AnnouncementEditor plans={plans.map((plan) => ({ id: plan.id, name: plan.name }))} tenants={tenants.map((tenant) => ({ id: tenant.id, name: tenant.name }))} />
      </section>
      <section className="mt-6 space-y-3" data-announcements>
        {announcements.length === 0 ? <p className="text-sm text-slate-500">None yet.</p> : announcements.map((announcement) => <AnnouncementRow key={announcement.id} announcement={announcement} />)}
      </section>
    </PlatformShell>
  );
}
