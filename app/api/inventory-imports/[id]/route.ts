import { cancelImport, importDetail } from "@/lib/erp/inventory-import";
import { guarded } from "@/lib/session";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("inventory.import", (actor) => importDetail(actor, id));
}

/** Discards an import that has not started. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("inventory.import", (actor) => cancelImport(actor, id));
}
