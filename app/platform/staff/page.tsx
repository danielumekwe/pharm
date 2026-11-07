import { PlatformShell } from "@/components/platform/platform-shell";
import { requirePlatformPage } from "@/lib/platform/pages";
import { PLATFORM_ROLE_LABELS } from "@/lib/platform/session";
import { listStaff } from "@/lib/platform/staff";

import { StaffManager } from "./staff-manager";

export const metadata = { title: "Platform staff · Web365 platform" };

export default async function PlatformStaffPage() {
  const actor = await requirePlatformPage("staff.manage");
  const staff = await listStaff();
  return (
    <PlatformShell actor={actor}>
      <h1 className="text-2xl font-bold">Platform staff</h1>
      <p className="text-sm text-slate-600">Web365 accounts. They are separate from pharmacy accounts and give no access to pharmacy records.</p>
      <StaffManager staff={staff.map((member) => ({ ...member, roleLabel: PLATFORM_ROLE_LABELS[member.role as keyof typeof PLATFORM_ROLE_LABELS] ?? member.role }))} selfId={actor.id} />
    </PlatformShell>
  );
}
