import { NextResponse } from "next/server";
import { z } from "zod";

import { flushDatabase, withDatabaseTransaction } from "@/lib/db/database";
import { DomainError } from "@/lib/erp/services";
import { acceptInvite } from "@/lib/erp/users";

const schema = z.object({ token: z.string().min(20).max(100), password: z.string().min(1).max(128) });

/** Public endpoint: a staff member activates their account from an invitation link. */
export async function POST(request: Request) {
  return withDatabaseTransaction(async () => {
    try {
      const body = schema.parse(await request.json());
      const result = await acceptInvite(body.token, body.password);
      await flushDatabase();
      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof DomainError) return NextResponse.json({ error: error.message }, { status: error.status });
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }
  });
}
