import { z } from "zod";

import { catalogLists, updateCatalog } from "@/lib/erp/products";
import { guarded } from "@/lib/session";

const list = z.array(z.string().max(60)).max(80).optional();
const schema = z.object({ categories: list, dosageForms: list, productTypes: list, packagingTypes: list });

export async function GET() {
  return guarded("products.view", () => catalogLists());
}

export async function PATCH(request: Request) {
  return guarded("catalog.manage", async (actor) => updateCatalog(actor, schema.parse(await request.json())));
}
