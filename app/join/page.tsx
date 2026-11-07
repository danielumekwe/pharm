import { connection } from "next/server";

import { AuthCard, Notice } from "@/components/auth-card";
import { platformQuery } from "@/lib/db/database";
import { isRole, ROLE_LABELS } from "@/lib/rbac";
import { peekToken } from "@/lib/saas/auth-tokens";

import { JoinButton } from "./join-button";

export const metadata = { title: "Join a pharmacy" };

export default async function JoinPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const { token } = await searchParams;
  const value = typeof token === "string" ? token : "";
  const invitation = value ? await peekToken(value, "join_pharmacy") : null;
  const [details] = invitation?.tenantId
    ? await platformQuery<Array<{ pharmacy: string; role: string; name: string; email: string }>>((query) =>
        query(
          `SELECT t.name AS pharmacy, m.role, u.name, u.email FROM tenant_memberships m JOIN tenants t ON t.id = m.tenant_id JOIN users u ON u.id = m.user_id
           WHERE m.tenant_id = $1 AND m.user_id = $2 AND m.status = 'INVITED' AND t.status = 'ACTIVE'`,
          [invitation.tenantId, invitation.userId],
        ),
      )
    : [];
  return (
    <AuthCard title={details ? `Join ${details.pharmacy}` : "Join a pharmacy"}>
      {details ? (
        <div className="space-y-4">
          <p className="text-center text-slate-700">
            {details.name}, you are invited to work for <strong>{details.pharmacy}</strong> as <strong>{isRole(details.role) ? ROLE_LABELS[details.role] : details.role}</strong>.
            You keep your existing account ({details.email}) and password.
          </p>
          <JoinButton token={value} />
        </div>
      ) : (
        <Notice tone="error">This invitation is invalid, already used, or expired. Ask the pharmacy to send a new one.</Notice>
      )}
    </AuthCard>
  );
}
