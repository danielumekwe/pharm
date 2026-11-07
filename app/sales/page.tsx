import { DashboardShell } from "@/components/dashboard-shell";
import { outlets, users } from "@/lib/data";
import { defaultHistoryRange, salesHistory } from "@/lib/erp/pos";
import { returnedQuantities } from "@/lib/erp/returns";
import { outletName, scopeByOutlet } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import { can } from "@/lib/rbac";
import { pageData } from "@/lib/session";

import { SalesWorkspace } from "./sales-workspace";

type Search = Promise<Record<string, string | string[] | undefined>>;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function SalesPage({ searchParams }: { searchParams: Search }) {
  return pageData("sales.view", "/sales", async (actor) => {
    const params = await searchParams;
    const read = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");
    const range = defaultHistoryRange();
    const filters = {
      from: DATE.test(read("from")) ? read("from") : range.from,
      to: DATE.test(read("to")) ? read("to") : range.to,
      outletId: read("outletId"),
      cashierId: read("cashierId"),
      method: read("method"),
      status: read("status"),
    };
    const history = salesHistory(actor, {
      from: filters.from,
      to: filters.to,
      outletId: filters.outletId || undefined,
      cashierId: filters.cashierId || undefined,
      method: filters.method || undefined,
      status: filters.status || undefined,
    });
    const rows = history.rows.slice(0, 1000);
    const store = getStore();
    const sales = Object.fromEntries(store.sales.filter((sale) => rows.some((row) => row.id === sale.id)).map((sale) => [sale.id, sale]));
    const retail = scopeByOutlet(actor, outlets.filter((outlet) => outlet.type !== "WAREHOUSE"), (outlet) => outlet.id);
    const ownOnly = !can(actor, "sales.supervise");
    const cashierIds = new Set(history.rows.map((row) => row.cashierId).filter(Boolean));

    return (
      <DashboardShell>
        <SalesWorkspace
          rows={rows}
          sales={sales}
          totals={history.totals}
          filters={filters}
          returned={Object.fromEntries(store.saleReturns.filter((row) => sales[row.saleId]).map((row) => [row.saleId, returnedQuantities(row.saleId)]))}
          outlets={retail.map((outlet) => ({ id: outlet.id, name: outlet.name }))}
          cashiers={users.filter((user) => cashierIds.has(user.id)).map((user) => ({ id: user.id, name: user.name }))}
          initialQuery={read("q")}
          scope={actor.outletId ? outletName(actor.outletId) : undefined}
          ownOnly={ownOnly}
          canCreate={can(actor, "sales.create")}
          canVoid={can(actor, "sales.void")}
        />
      </DashboardShell>
    );
  });
}
