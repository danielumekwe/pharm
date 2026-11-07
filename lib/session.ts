import { redirect } from "next/navigation";
import { connection, NextResponse } from "next/server";

import { auth, signedInBefore } from "@/lib/auth";
import { currentTenant, flushDatabase, withDatabaseTransaction } from "@/lib/db/database";
import { users } from "@/lib/data";
import { actorFor } from "@/lib/erp/access";
import { activeImpersonation } from "@/lib/erp/impersonation";
import { bearerToken } from "@/lib/mobile-token";
import { DomainError } from "@/lib/erp/services";
import type { Actor } from "@/lib/erp/types";
import { canAny, type Permission } from "@/lib/rbac";
import { runInTenant, TenantRequiredError } from "@/lib/saas/tenant";
import { RateLimitError } from "@/lib/saas/rate-limit";

/** The running transaction's pharmacy, if it is active. Suspended or closed pharmacies get no access. */
function activeTenantId() {
  const tenant = currentTenant();
  return tenant && tenant.status === "ACTIVE" ? tenant.id : null;
}

/**
 * The signed-in user, resolved from the live user record of the session's pharmacy (role, status, outlets,
 * permissions all come from that pharmacy's membership). No membership, or an inactive pharmacy: null.
 */
export async function getActor(): Promise<Actor | null> {
  await connection();
  const bearer = await bearerToken();
  if (bearer !== undefined) {
    // Native app: a signed mobile token instead of the browser session cookie. No impersonation on mobile.
    if (!bearer) return null;
    return runInTenant(bearer.tenantId, () => withDatabaseTransaction(async () => {
      const tenantId = activeTenantId();
      if (!tenantId) return null;
      const record = users.find((user) => user.id === bearer.id);
      if (record && signedInBefore(record.passwordChangedAt, { iat: bearer.iat, signedInAt: bearer.signedInAt })) return null; // password changed since
      const actor = record ? actorFor(record, bearer.outletId) : null;
      return actor ? { ...actor, tenantId } : null;
    }));
  }
  return withDatabaseTransaction(async () => {
    const session = await auth();
    const id = session?.user?.id;
    const tenantId = activeTenantId();
    if (!id || !tenantId || session.user.tenantId !== tenantId) return null;
    const record = users.find((user) => user.id === id);
    if (!record) return null;
    const actor = actorFor(record, session.user.outletId);
    // Impersonation is re-validated against the server-side session record on every request.
    const sessionId = session.user.impersonation?.sessionId;
    if (actor && sessionId) {
      const active = activeImpersonation(sessionId);
      if (!active || active.target.id !== record.id) return null;
      actor.impersonation = { sessionId, adminId: active.admin.id, adminName: active.admin.name, expiresAt: active.session.expiresAt };
    }
    return actor ? { ...actor, tenantId } : null;
  });
}

function asList(permission: Permission | Permission[]) {
  return Array.isArray(permission) ? permission : [permission];
}

/** Server-page guard: signs out anonymous users and bounces users without the permission. */
export async function requirePage(permission: Permission | Permission[], path: string): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/");
  if (!canAny(actor, asList(permission))) redirect(`/dashboard?denied=${encodeURIComponent(path)}`);
  return actor;
}

/**
 * Server pages: checks access like requirePage, then builds the page's data inside the same pharmacy
 * transaction. ERP data can only be read inside a transaction (lib/working-set.ts), so a page must compute
 * everything it renders here and pass plain values to its components.
 */
export async function pageData<T>(permission: Permission | Permission[], path: string, build: (actor: Actor) => T | Promise<T>): Promise<T> {
  return withDatabaseTransaction(async () => build(await requirePage(permission, path)));
}

type Handler = (actor: Actor) => Promise<unknown> | unknown;

/** Carries an error response out of the database transaction so the transaction rolls back. */
class RolledBack extends Error {
  constructor(public response: NextResponse) {
    super("rolled back");
  }
}

function errorResponse(error: unknown) {
  if (error instanceof DomainError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof RateLimitError) return NextResponse.json({ error: error.message }, { status: 429, headers: { "Retry-After": String(Math.ceil(error.retryAfterSeconds)) } });
  if (error instanceof TenantRequiredError) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  // A business code or number that already exists in this pharmacy (unique per pharmacy in the database).
  if (error && typeof error === "object" && "code" in error && error.code === "P2010" && /\b23505\b/.test(String((error as { message?: unknown }).message))) {
    return NextResponse.json({ error: "That code or number is already used in this pharmacy. Refresh and try again." }, { status: 409 });
  }
  if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  if (error && typeof error === "object" && "issues" in error) {
    const issue = (error as { issues?: { path?: PropertyKey[]; message?: string }[] }).issues?.[0];
    const field = issue?.path?.filter((part) => typeof part === "string").join(" › ");
    return NextResponse.json({ error: field ? `Check ${field}: ${issue?.message ?? "invalid value"}.` : "Some fields are missing or invalid." }, { status: 422 });
  }
  console.error(error);
  return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
}

/**
 * Route-handler wrapper: authenticates, checks the permission, runs the handler in one database transaction and
 * maps errors to HTTP. A failed request is rolled back as a whole (stock, payments, audit), unless the error
 * explicitly asks to keep its changes.
 */
export async function guarded(permission: Permission | Permission[], handler: Handler, successStatus = 200) {
  try {
    return await withDatabaseTransaction(async () => {
      const actor = await getActor();
      if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
      if (!canAny(actor, asList(permission))) {
        return NextResponse.json({ error: `Your role does not have the "${asList(permission).join(" / ")}" permission.` }, { status: 403 });
      }
      try {
        const result = await handler(actor);
        await flushDatabase();
        return NextResponse.json(result, { status: successStatus });
      } catch (error) {
        if (error instanceof DomainError && error.keepChanges) return errorResponse(error);
        throw new RolledBack(errorResponse(error));
      }
    });
  } catch (error) {
    if (error instanceof RolledBack) return error.response;
    console.error("[db] request transaction failed", error);
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }
}
