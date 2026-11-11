import { NextResponse } from "next/server";

import { MAX_FILE_BYTES } from "@/lib/erp/import-file";
import { createImport, listImports } from "@/lib/erp/inventory-import";
import { DomainError } from "@/lib/erp/services";
import { guarded } from "@/lib/session";

/** Import history (this pharmacy only; outlet staff see their outlet's imports). */
export async function GET() {
  return guarded("inventory.import", (actor) => listImports(actor));
}

/** Upload a file: multipart form with `file` (.xlsx or .csv) and `kind` (catalogue | stock | both). */
export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_FILE_BYTES + 64 * 1024) return NextResponse.json({ error: "The file is larger than 4 MB. Split it into smaller files." }, { status: 413 });
  // The upload is received before the database transaction starts, so a slow upload holds no locks.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Upload the file as a form (multipart/form-data)." }, { status: 400 });
  }
  const file = form.get("file");
  const kind = String(form.get("kind") ?? "");
  const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : null;
  return guarded(
    "inventory.import",
    (actor) => {
      if (!(file instanceof File) || !bytes) throw new DomainError("Choose a file to upload.");
      return createImport(actor, { kind, fileName: file.name, bytes });
    },
    201,
  );
}
