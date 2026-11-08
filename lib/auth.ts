import NextAuth, { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { AUTH_SECRET } from "@/lib/auth-secret";
import { currentTenant, withDatabaseTransaction } from "@/lib/db/database";
import { getOutletById, users } from "@/lib/data";
import { allowedOutletIds, canSwitchTo, HEAD_OFFICE, resolveActiveOutlet } from "@/lib/erp/access";
import { activeImpersonation } from "@/lib/erp/impersonation";
import { recordSignInAttempt } from "@/lib/platform/security";
import { maintenanceMessage } from "@/lib/platform/system";
import { activeSupportGrant, supportActor } from "@/lib/platform/support";
import { recordAudit } from "@/lib/erp/services";
import { effectivePermissions, isOutletScoped } from "@/lib/rbac";
import { accountIdsFor, activeMembership, pharmaciesFor, pharmacyNames, suspendedMessage, suspendedPharmaciesFor, verifiedAccountIds } from "@/lib/saas/identity";
import { limitSignIn, recordSignInFailure } from "@/lib/saas/rate-limit";
import { runInTenant } from "@/lib/saas/tenant";

function outletLabel(id: string | null) {
  return id ? getOutletById(id)?.name ?? id : "Head Office (all outlets)";
}

const credentialsSchema = z.object({
  identifier: z.string().trim().min(3).max(120),
  password: z.string().min(6),
  /** The pharmacy chosen on the sign-in form. Only accepted if the account holds a membership of it. */
  tenantId: z.string().max(80).optional(),
  outletId: z.string().max(40).optional().default(HEAD_OFFICE),
});

export type SignedInUser = { id: string; name: string; email: string; role: string; outletId: string | null; tenantId: string };

/**
 * Shared by the web sign-in and the mobile app's token login.
 * 1. The password is checked against the global account (rate limited).
 * 2. The pharmacy must be one the account belongs to (the only one, or the one chosen).
 * 3. Inside that pharmacy: status, outlet access, last sign-in and the audit entry, as before.
 * Returns null on bad credentials; throws with a user-facing message otherwise.
 */
export async function authorizeCredentials(credentials: unknown): Promise<SignedInUser | null> {
  const parsed = credentialsSchema.safeParse(credentials);
  if (!parsed.success) return null;
  const { identifier, password, tenantId, outletId } = parsed.data;
  const paused = await maintenanceMessage();
  if (paused) {
    await recordSignInAttempt({ surface: "pharmacy", identifier, outcome: "refused", tenantId, detail: "maintenance" });
    throw new Error(paused);
  }
  try {
    await limitSignIn(identifier);
  } catch (error) {
    await recordSignInAttempt({ surface: "pharmacy", identifier, outcome: "rate_limited", tenantId });
    throw error;
  }

  const accountIds = await verifiedAccountIds(identifier, password);
  if (!accountIds.length) {
    recordSignInFailure(identifier);
    await recordSignInAttempt({ surface: "pharmacy", identifier, outcome: "bad_password", tenantId });
    await recordFailedSignIn(identifier, tenantId);
    return null;
  }

  const choices = await pharmaciesFor(accountIds);
  const choice = tenantId ? choices.find((entry) => entry.tenantId === tenantId) : choices.length === 1 ? choices[0] : undefined;
  if (!choice) {
    if (!choices.length) {
      const suspended = await suspendedPharmaciesFor(accountIds);
      throw new Error(suspended.length ? suspendedMessage(suspended) : "This account does not have access to an active pharmacy. Contact your administrator.");
    }
    throw new Error(tenantId ? "This account does not have access to that pharmacy." : "Choose the pharmacy you are signing in to.");
  }

  const user = await runInTenant(choice.tenantId, () => withDatabaseTransaction(() => signInWithinTenant(choice.userId, identifier, outletId)));
  if (user) await recordSignInAttempt({ surface: "pharmacy", identifier, outcome: "success", userId: user.id, tenantId: choice.tenantId });
  return user ? { ...user, tenantId: choice.tenantId } : null;
}

/** Records "auth.failed" in the pharmacy the attempt was aimed at (the chosen one, or the account's only one). */
async function recordFailedSignIn(identifier: string, tenantId: string | undefined) {
  const choices = await pharmaciesFor(await accountIdsFor(identifier));
  if (choices.length && choices.every((entry) => entry.status === "INVITED")) {
    throw new Error("This account has not been activated yet. Use the invitation link you were sent.");
  }
  const target = tenantId ? choices.find((entry) => entry.tenantId === tenantId) : choices.length === 1 ? choices[0] : undefined;
  if (!target) return;
  await runInTenant(target.tenantId, () => withDatabaseTransaction(async () => {
    const account = users.find((user) => user.id === target.userId);
    if (!account) return;
    recordAudit(
      { id: account.id, name: account.name, role: account.role },
      { action: "auth.failed", entity: "User", entityId: account.id, summary: `Failed sign-in for ${account.name} (wrong password)`, outletId: account.outletId, severity: "warning" },
    );
  }));
}

/** Runs inside the chosen pharmacy's transaction: the user record carries that pharmacy's membership. */
function signInWithinTenant(userId: string, identifier: string, outletId: string) {
  const account = users.find((user) => user.id === userId);
  if (!account) return null;
  const status = account.status ?? "ACTIVE";
  if (status === "INVITED") throw new Error("This account has not been activated yet. Use the invitation link you were sent.");
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
}

/** True when the session (sign-in time, else token issue time) predates the account's last password change. */
export function signedInBefore(passwordChangedAt: string | undefined, token: { signedInAt?: unknown; iat?: unknown }) {
  if (!passwordChangedAt) return false;
  const changed = Date.parse(passwordChangedAt);
  if (typeof token.signedInAt === "number") return changed > token.signedInAt; // milliseconds
  return Math.floor(changed / 1000) > (typeof token.iat === "number" ? token.iat : 0); // older tokens: seconds
}

/** Pharmacy switch requested by a signed-in user: checked against their live memberships. */
async function switchPharmacy(token: Parameters<NonNullable<NonNullable<NextAuthOptions["callbacks"]>["jwt"]>>[0]["token"], requested: unknown) {
  if (typeof requested !== "string" || typeof token.id !== "string" || token.impersonationId) return; // not while impersonating
  if (requested === token.tenantId || !(await activeMembership(token.id, requested))) return;
  const userId = token.id;
  const fromName = currentTenant()?.name;
  await runInTenant(requested, () => withDatabaseTransaction(async () => {
    const record = users.find((row) => row.id === userId);
    if (!record) return;
    const outletId = resolveActiveOutlet(record, record.outletId ?? null);
    token.tenantId = requested;
    token.role = record.role;
    token.outletId = outletId;
    token.adminOutletId = undefined;
    recordAudit(
      { id: record.id, name: record.name, role: record.role },
      { action: "auth.switch-pharmacy", entity: "User", entityId: record.id, summary: `${record.name} switched to this pharmacy${fromName ? ` from ${fromName}` : ""}`, outletId },
    );
  }));
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
        tenantId: { label: "Pharmacy", type: "text" },
        outletId: { label: "Outlet", type: "text" },
      },
      authorize: (credentials) => authorizeCredentials(credentials),
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        const signedIn = user as unknown as SignedInUser;
        token.id = String(signedIn.id);
        token.role = String(signedIn.role ?? "");
        token.outletId = signedIn.outletId ? String(signedIn.outletId) : null;
        token.tenantId = signedIn.tenantId;
        token.signedInAt = Date.now();
      }
      if (trigger === "update" && session && typeof session === "object" && "tenantId" in session) {
        await switchPharmacy(token, (session as { tenantId: unknown }).tenantId);
      }
      // Everything below reads the token's own pharmacy (no pharmacy: an anonymous scope with no data).
      return runInTenant(token.tenantId ?? null, () => withDatabaseTransaction(async () => {
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
        // A password change signs out every session that signed in before it (all pharmacies, all devices).
        const account = users.find((row) => row.id === token.id);
        if (account && signedInBefore(account.passwordChangedAt, token)) token.revoked = true;

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
      }));
    },
    async session({ session, token }) {
      // Rebuilt from the live record of the token's pharmacy on every read, so role, outlet, permission and
      // membership changes apply immediately. While impersonating, the effective user is the target.
      return runInTenant(token.tenantId ?? null, () => withDatabaseTransaction(async () => {
        // Web365 support session: valid only while the pharmacy's approval stands; read-only permissions.
        if (typeof token.supportGrantId === "string") {
          const grant = await activeSupportGrant(token.supportGrantId, token.tenantId);
          const tenant = currentTenant();
          const actor = grant && tenant && typeof token.id === "string" ? supportActor({ id: token.id, name: token.name }, tenant.id, grant.id) : null;
          if (session.user) {
            Object.assign(session.user, {
              id: actor?.id ?? "", name: actor?.name ?? "", email: "", role: actor ? actor.role : "", outletId: null,
              outletIds: actor?.outletIds ?? [], permissions: actor?.permissions ?? [], staffId: null, impersonation: null,
              outlets: (actor?.outletIds ?? []).map((id) => ({ id, name: getOutletById(id)?.name ?? id })),
              tenantId: actor ? tenant!.id : null, tenantName: actor ? tenant!.name : null, pharmacies: [],
              support: grant ? { grantId: grant.id, expiresAt: grant.expiresAt, agent: grant.agent } : null,
            });
          }
          return session;
        }
        const impersonation = token.impersonationId ? activeImpersonation(token.impersonationId) : null;
        const own = users.find((row) => row.id === token.id);
        const revoked = token.revoked === true || Boolean(own && signedInBefore(own.passwordChangedAt, token));
        const record = revoked ? undefined : impersonation ? impersonation.target : own;
        if (session.user) {
          session.user.impersonation = impersonation
            ? { sessionId: impersonation.session.id, adminId: impersonation.admin.id, adminName: impersonation.admin.name, startedAt: impersonation.session.startedAt, expiresAt: impersonation.session.expiresAt }
            : null;
          session.user.email = record?.email ?? session.user.email;
          session.user.id = record?.id ?? "";
          session.user.role = record?.role ?? "";
          session.user.outletId = record ? resolveActiveOutlet(record, token.outletId ?? null) : null;
          session.user.outletIds = record ? allowedOutletIds(record) : [];
          session.user.permissions = record && (record.status ?? "ACTIVE") === "ACTIVE" ? effectivePermissions(record.role, record.grants ?? []) : [];
          session.user.staffId = record?.staffId ?? null;
          session.user.outlets = session.user.outletIds.map((id) => ({ id, name: getOutletById(id)?.name ?? id }));
          const tenant = currentTenant();
          session.user.tenantId = record && tenant ? tenant.id : null;
          session.user.tenantName = record && tenant ? tenant.name : null;
          // The real account's pharmacies (not the impersonated user's), for the pharmacy switcher.
          session.user.pharmacies = record && typeof token.id === "string" && !impersonation ? await pharmacyNames(token.id) : [];
          session.user.support = null;
          if (record) session.user.name = record.name;
        }
        return session;
      }));
    },
  },
};

export default NextAuth(authOptions);

export async function auth() {
  return withDatabaseTransaction(() => getServerSession(authOptions));
}
