import { posCatalog } from "@/lib/erp/pos";
import { DomainError } from "@/lib/erp/services";
import { guarded } from "@/lib/session";

/** Till catalogue for one outlet: prices, sellable stock, FEFO batches and packaging. ?outletId= */
export async function GET(request: Request) {
  const outletId = new URL(request.url).searchParams.get("outletId");
  return guarded("sales.create", (actor) => {
    const outlet = outletId ?? actor.outletId;
    if (!outlet) throw new DomainError("Choose the outlet to sell from.");
    return posCatalog(actor, outlet);
  });
}
