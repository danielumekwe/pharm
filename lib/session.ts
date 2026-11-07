import { redirect } from "next/navigation";
import { connection, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { flushDatabase, withDatabaseTransaction } from "@/lib/db/database";
import { users } from "@/lib/data";
import { actorFor } from "@/lib/erp/access";
import { activeImpersonation } from "@/lib/erp/impersonation";
import { bearerToken } from "@/lib/mobile-token";
import { DomainError } from "@/lib/erp/services";
import type { Actor } from "@/lib/erp/types";
import { canAny, type Permission } from "@/lib/rbac";

/** The signed-in user, resolved from the live user record (role, status, outlets, permissions). */
export async function getActor(): Promise<Actor | null> {
  await connection();
  const bearer = await bearerToken();
  if (bearer !== undefined) {
    // Native app: a signed mobile token instead of the browser session cookie. No impersonation on mobile.
    if (!bearer) return null;
    return withDatabaseTransaction(async () => {
      const record = users.find((user) => user.id === bearer.id);
      return record ? actorFor(record, bearer.outletId) : null;
    });
  }
  return withDatabaseTransaction(async () => {
    const session = await auth();
    const id = session?.user?.id;
    if (!id) return null;
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
    return actor;
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

type Handler = (actor: Actor) => Promise<unknown> | unknown;

/** Carries an error response out of the database transaction so the transaction rolls back. */
class RolledBack extends Error {
  constructor(public response: NextResponse) {
    super("rolled back");
  }
}

function errorResponse(error: unknown) {
  if (error instanceof DomainError) return NextResponse.json({ error: error.message }, { status: error.status });
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
