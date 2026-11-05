import { lookupBarcode } from "@/lib/erp/products";
import { guarded } from "@/lib/session";

/** Scanner lookup used by POS and goods receipt: ?code=…&outletId=… */
export async function GET(request: Request) {
  const url = new URL(request.url);
  return guarded(["products.view", "sales.create", "purchase.receive"], async (actor) => lookupBarcode(actor, url.searchParams.get("code") ?? "", url.searchParams.get("outletId")));
}
