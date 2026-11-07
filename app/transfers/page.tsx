import { DashboardShell } from "@/components/dashboard-shell";
import { outlets, products } from "@/lib/data";
import { outletName, scopeByOutlet, sellableQuantity } from "@/lib/erp/services";
import { transfersFor } from "@/lib/erp/transfers";
import { can, isOutletScoped } from "@/lib/rbac";
import { pageData } from "@/lib/session";

import { TransfersWorkspace } from "./transfers-workspace";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function TransfersPage({ searchParams }: { searchParams: Search }) {
  return pageData("stock.view", "/transfers", async (actor) => {
    const params = await searchParams;
    // Outlets the actor may send from: their active outlet (outlet roles) or any (central roles).
    const sources = isOutletScoped(actor.role) ? outlets.filter((outlet) => outlet.id === actor.outletId) : scopeByOutlet(actor, outlets, (outlet) => outlet.id);
    return (
      <DashboardShell>
        <TransfersWorkspace
          transfers={transfersFor(actor).map((row) => ({ ...row, fromName: outletName(row.fromOutletId), toName: outletName(row.toOutletId) }))}
          sources={sources.map((outlet) => ({ id: outlet.id, name: outlet.name }))}
          destinations={outlets.filter((outlet) => (outlet.status ?? "ACTIVE") === "ACTIVE").map((outlet) => ({ id: outlet.id, name: outlet.name }))}
          items={products
            .filter((product) => sources.some((outlet) => outlet.id === product.outletId))
            .map((product) => ({ id: product.id, name: product.name, outletId: product.outletId, unit: product.baseUnit || product.uom, usable: sellableQuantity(product.id, product.outletId) }))
            .filter((row) => row.usable > 0)}
          actor={{ id: actor.id, outletIds: actor.outletId ? [actor.outletId] : isOutletScoped(actor.role) ? actor.outletIds : outlets.map((row) => row.id), superAdmin: actor.role === "SUPER_ADMIN", central: !isOutletScoped(actor.role) }}
          permissions={{ request: can(actor, "stock.request"), approve: can(actor, "stock.approve"), receive: can(actor, "stock.request") || can(actor, "purchase.receive") }}
          openNew={params.new === "1"}
          selectedId={typeof params.id === "string" ? params.id : null}
          scope={actor.outletId ? outletName(actor.outletId) : undefined}
        />
      </DashboardShell>
    );
  });
}
