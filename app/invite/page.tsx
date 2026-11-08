import Link from "next/link";
import { BrandWordmark } from "@/components/branding";
import { getOutletById } from "@/lib/data";
import { findInvite } from "@/lib/erp/users";
import { getStore } from "@/lib/erp/store";
import { currentTenant, withDatabaseTransaction } from "@/lib/db/database";
import { ROLE_LABELS } from "@/lib/rbac";
import { invitationTenant } from "@/lib/saas/identity";
import { runInTenant } from "@/lib/saas/tenant";

import { AcceptInviteForm } from "./accept-invite-form";

export const metadata = { title: "Activate account" };

type InviteView = { name: string; pharmacy: string; detail: string; staffId: string; email: string; minLength: number };

/** Reads the invitation inside the pharmacy that sent it. */
async function loadInvite(token: string): Promise<InviteView | null> {
  const tenantId = token ? await invitationTenant(token) : null;
  if (!tenantId) return null;
  return runInTenant(tenantId, () => withDatabaseTransaction(() => {
    const user = findInvite(token);
    if (!user) return null;
    return {
      name: user.name,
      pharmacy: currentTenant()?.name ?? "",
      detail: `${ROLE_LABELS[user.role]} · ${(user.outletIds ?? []).map((id) => getOutletById(id)?.name ?? id).join(", ") || "All outlets"}`,
      staffId: user.staffId ?? "",
      email: user.email,
      minLength: getStore().settings.passwordMinLength,
    };
  }));
}

export default async function InvitePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const invite = await loadInvite(token);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f2f6f3] px-4 py-10 text-slate-900">
      <div className="w-full max-w-md rounded-[28px] bg-white px-8 py-9 shadow-[0_30px_80px_-30px_rgba(15,81,50,0.35)]">
        <div className="flex flex-col items-center text-center">
          <BrandWordmark className="h-16 w-auto" />
        </div>
        {invite ? (
          <>
            <h1 className="mt-5 text-center text-xl font-bold">Welcome, {invite.name}</h1>
            <p className="mt-1 text-center text-sm text-slate-600">{invite.pharmacy}</p>
            <p className="mt-0.5 text-center text-sm text-slate-600">{invite.detail}</p>
            <AcceptInviteForm token={token} staffId={invite.staffId} email={invite.email} minLength={invite.minLength} />
          </>
        ) : (
          <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-center text-sm text-rose-700">
            This invitation link is invalid, already used, or expired. Ask your manager to send a new one.
            <Link href="/login" className="mt-3 block font-medium text-green-700 hover:underline">Go to sign in</Link>
          </div>
        )}
      </div>
    </main>
  );
}
