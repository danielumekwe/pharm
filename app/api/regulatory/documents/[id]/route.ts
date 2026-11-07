import { NextResponse } from "next/server";

import { deleteDocument, readDocument } from "@/lib/erp/regulatory";
import { DomainError } from "@/lib/erp/services";
import { can } from "@/lib/rbac";
import { getActor, guarded } from "@/lib/session";
import { withDatabaseTransaction } from "@/lib/db/database";
import { subscriptionAccessProblem } from "@/lib/saas/subscriptions";

/** Streams a regulatory file. Runs in the pharmacy's transaction: only its own documents can be found. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withDatabaseTransaction(() => download(id));
}

async function download(id: string) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!can(actor, "regulatory.view")) return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  if (!actor.support) {
    const problem = await subscriptionAccessProblem();
    if (problem) return NextResponse.json({ error: problem }, { status: 402 });
  }
  try {
    const { document, bytes } = await readDocument(id);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": document.mimeType,
        "Content-Disposition": `inline; filename="${document.fileName.replace(/"/g, "")}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const status = error instanceof DomainError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error" }, { status });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("regulatory.manage", (actor) => deleteDocument(actor, id));
}
