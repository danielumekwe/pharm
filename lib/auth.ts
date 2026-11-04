import NextAuth, { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { AUTH_SECRET } from "@/lib/auth-secret";
import { withDatabaseTransaction } from "@/lib/db/database";
import { findUserByCredentials, getOutletById, users } from "@/lib/data";
import { allowedOutletIds, canSwitchTo, HEAD_OFFICE, resolveActiveOutlet } from "@/lib/erp/access";
import { activeImpersonation } from "@/lib/erp/impersonation";
import { recordAudit } from "@/lib/erp/services";
import { effectivePermissions, isOutletScoped } from "@/lib/rbac";

function outletLabel(id: string | null) {
  return id ? getOutletById(id)?.name ?? id : "Head Office (all outlets)";
}

export const authOptions: NextAuthOptions = {
  secret: AUTH_SECRET,
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 12, // one working shift
  },
  pages: {
    signIn: "/",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        identifier: { label: "Email or staff ID", type: "text" },
        password: { label: "Password", type: "password" },
        outletId: { label: "Outlet", type: "text" },
      },
      authorize: async (credentials) => {
        const parsed = z
          .object({
            identifier: z.string().trim().min(3).max(120),
            password: z.string().min(6),
            outletId: z.string().max(40).optional().default(HEAD_OFFICE),
          })
          .safeParse(credentials);

        if (!parsed.success) return null;

        // Staff badges carry the staff ID; resolve it to the account email.
        const { identifier, password, outletId } = parsed.data;
        const account =
          users.find((user) => user.staffId?.toLowerCase() === identifier.toLowerCase()) ??
          users.find((user) => user.email.toLowerCase() === identifier.toLowerCase());
        if (!account) return null;

        const status = account.status ?? "ACTIVE";
        if (status === "INVITED") throw new Error("This account has not been activated yet. Use the invitation link you were sent.");

        const result = await findUserByCredentials(account.email, password);
        if (!result) {
          recordAudit(
            { id: account.id, name: account.name, role: account.role },
            { action: "auth.failed", entity: "User", entityId: account.id, summary: `Failed sign-in for ${account.name} (wrong password)`, outletId: account.outletId, severity: "warning" },
          );
          return null;
        }
        if (status === "SUSPENDED") throw new Error("This account is suspended. Contact your manager.");
        if (status === "DEACTIVATED") return null;

        // The selected location must be one the account may work in.
        const allowed = allowedOutletIds(account);
        if (isOutletScoped(account.role)) {
          if (allowed.length === 0) throw new Error("No open outlet is assigned to this account. Contact your manager.");
          if (!allowed.includes(outletId)) {
            const names = allowed.map((id) => getOutletById(id)?.name ?? id).join(" or ");
            throw new Error(
              outletId === HEAD_OFFICE
                ? `Head Office sign-in is for central roles. Select ${names}.`
                : `This account is assigned to ${names}. Select one of those locations.`,
            );
          }
        } else if (outletId !== HEAD_OFFICE && !allowed.includes(outletId)) {
          throw new Error("That outlet is closed or does not exist.");
        }

        const active = resolveActiveOutlet(account, outletId);
        account.lastLogin = new Date().toISOString();
        recordAudit(
          { id: account.id, name: account.name, role: account.role },
          {
            action: "auth.login",
            entity: "User",
            entityId: account.id,
            summary: `${account.name} signed in at ${outletLabel(active)}${identifier.toLowerCase() === account.staffId?.toLowerCase() ? " with staff ID" : ""}`,
            outletId: active,
          },
        );

        return { id: account.id, name: account.name, email: account.email, role: account.role, outletId: active };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = String(user.id);
        token.role = String(user.role ?? "");
        token.outletId = user.outletId ? String(user.outletId) : null;
      }

      // Impersonation: only a session id is kept in the token; the session itself is validated server-side.
      if (trigger === "update" && session && typeof session === "object" && "impersonate" in session) {
        const requested = (session as { impersonate: unknown }).impersonate;
        if (requested === null) {
          token.impersonationId = undefined;
          token.outletId = token.adminOutletId ?? null;
          token.adminOutletId = undefined;
        } else if (typeof requested === "string") {
          const active = activeImpersonation(requested);
          if (active && active.session.adminId === token.id) {
            token.adminOutletId = token.outletId ?? null;
            token.impersonationId = requested;
            token.outletId = resolveActiveOutlet(active.target, null);
          }
        }
      }
      // A session that has ended (returned, expired, disabled, account changed) drops back to the administrator.
      if (token.impersonationId && !activeImpersonation(token.impersonationId)) {
        token.impersonationId = undefined;
        token.outletId = token.adminOutletId ?? null;
        token.adminOutletId = undefined;
      }

      // Outlet switching: the requested outlet is validated against the live record of the effective user.
      if (trigger === "update" && session && typeof session === "object" && "outletId" in session) {
        const effectiveId = token.impersonationId ? activeImpersonation(token.impersonationId)?.target.id : token.id;
        const record = users.find((row) => row.id === effectiveId);
        const requested = (session as { outletId: unknown }).outletId;
        const target = typeof requested === "string" && requested !== HEAD_OFFICE ? requested : null;
        if (record && (record.status ?? "ACTIVE") === "ACTIVE" && canSwitchTo(record, target)) {
          if (target !== token.outletId) {
            const impersonation = token.impersonationId ? activeImpersonation(token.impersonationId) : null;
            recordAudit(
              {
                id: record.id,
                name: record.name,
                role: record.role,
                impersonation: impersonation ? { sessionId: impersonation.session.id, adminId: impersonation.admin.id, adminName: impersonation.admin.name, expiresAt: impersonation.session.expiresAt } : undefined,
              },
              { action: "auth.switch-outlet", entity: "User", entityId: record.id, summary: `${record.name} switched to ${outletLabel(target)}`, outletId: target },
            );
          }
          token.outletId = target;
        }
      }
      return token;
    },
    async session({ session, token }) {
      // Rebuilt from the live record on every read, so role, outlet and permission changes apply immediately.
      // While impersonating, the effective user is the target; the administrator is reported separately.
      const impersonation = token.impersonationId ? activeImpersonation(token.impersonationId) : null;
      const record = impersonation ? impersonation.target : users.find((row) => row.id === token.id);
      if (session.user) {
        session.user.impersonation = impersonation
          ? { sessionId: impersonation.session.id, adminId: impersonation.admin.id, adminName: impersonation.admin.name, startedAt: impersonation.session.startedAt, expiresAt: impersonation.session.expiresAt }
          : null;
        session.user.email = record?.email ?? session.user.email;
        session.user.id = record?.id ?? (typeof token.id === "string" ? token.id : "");
        session.user.role = record?.role ?? (typeof token.role === "string" ? token.role : "");
        session.user.outletId = record ? resolveActiveOutlet(record, token.outletId ?? null) : null;
        session.user.outletIds = record ? allowedOutletIds(record) : [];
        session.user.permissions = record && (record.status ?? "ACTIVE") === "ACTIVE" ? effectivePermissions(record.role, record.grants ?? []) : [];
        session.user.staffId = record?.staffId ?? null;
        session.user.outlets = session.user.outletIds.map((id) => ({ id, name: getOutletById(id)?.name ?? id }));
        if (record) session.user.name = record.name;
      }
      return session;
    },
  },
};

export default NextAuth(authOptions);

export async function auth() {
  return withDatabaseTransaction(() => getServerSession(authOptions));
}
