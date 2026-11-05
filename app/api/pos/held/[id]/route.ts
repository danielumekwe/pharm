import { discardHeldSale } from "@/lib/erp/pos";
import { guarded } from "@/lib/session";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("sales.create", (actor) => discardHeldSale(actor, id));
}
