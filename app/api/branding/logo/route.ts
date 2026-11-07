import { NextResponse } from "next/server";

import { withDatabaseTransaction } from "@/lib/db/database";
import { readLogo } from "@/lib/erp/branding";

/** Public: the uploaded logo, shown on the sign-in page and in the app chrome. */
export async function GET(request: Request) {
  const logo = await withDatabaseTransaction(() => readLogo());
  if (!logo) return NextResponse.json({ error: "No custom logo." }, { status: 404 });
  // Links carry ?v=<stored name>, which changes with every upload, so a matching request can be cached for good.
  const versioned = new URL(request.url).searchParams.get("v") === logo.name;
  return new NextResponse(new Uint8Array(logo.bytes), {
    headers: {
      "Content-Type": logo.mimeType,
      "Cache-Control": versioned ? "private, max-age=31536000, immutable" : "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
