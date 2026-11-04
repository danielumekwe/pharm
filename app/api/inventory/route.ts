import { addStockMovement, getStockMovementsServer, products } from "@/lib/data";
import { recordAudit, scopeByOutlet } from "@/lib/erp/services";
import { guarded } from "@/lib/session";

const TYPES = ["Receive", "Issue", "Transfer", "Adjustment", "Return"] as const;

export async function GET() {
  return guarded("stock.view", async (actor) => scopeByOutlet(actor, await getStockMovementsServer(), (movement) => movement.outletId));
}

/** Legacy free-form movement request used by the Batches & GRN page. Always created as Pending. */
export async function POST(request: Request) {
  return guarded(
    "stock.request",
    async (actor) => {
      const payload = (await request.json()) as Record<string, unknown>;
      const type = TYPES.find((value) => value === payload.type) ?? "Transfer";
      const productName = typeof payload.productName === "string" && payload.productName.trim() ? payload.productName.trim() : "New product";
      const outletId = actor.outletId ?? (typeof payload.outletId === "string" ? payload.outletId : "outlet-1");
      const quantity = Math.max(0, Math.floor(Number(payload.quantity ?? 0)));

      const movement = addStockMovement({
        reference: typeof payload.reference === "string" ? payload.reference : undefined,
        date: typeof payload.date === "string" ? payload.date : undefined,
        type,
        outletId,
        productName,
        quantity,
        status: "Pending",
        reason: typeof payload.reason === "string" ? payload.reason : "Raised from Batches & GRN",
        requestedBy: actor.name,
      });

      const controlled = products.some((product) => product.name === productName && product.controlled);
      recordAudit(actor, {
        action: "stock.request",
        entity: "StockMovement",
        entityId: movement.id,
        summary: `${movement.reference}: ${type} ${quantity} × ${productName}`,
        outletId,
        severity: controlled ? "warning" : "info",
      });
      return movement;
    },
    201,
  );
}
