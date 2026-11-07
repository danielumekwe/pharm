import { DashboardShell } from "@/components/dashboard-shell";
import { outlets } from "@/lib/data";
import { outletName, scopeByOutlet } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import { can, isOutletScoped } from "@/lib/rbac";
import { pageData } from "@/lib/session";

import { FinanceWorkspace } from "./finance-workspace";

export default async function FinancePage() {
  return pageData("finance.view", "/finance", async (actor) => {
    const store = getStore();
    const scoped = isOutletScoped(actor.role);

    return (
      <DashboardShell>
        <FinanceWorkspace
          expenses={scopeByOutlet(actor, store.expenses, (expense) => expense.outletId)}
          // Outlet-scoped users see expense vouchers only; the company-wide ledger is for finance roles.
          payments={scoped ? [] : store.payments}
          customers={store.customers.filter((row) => row.balance > 0).map((row) => ({ id: row.id, name: row.name, balance: row.balance }))}
          suppliers={store.suppliers.filter((row) => row.balance > 0).map((row) => ({ id: row.id, name: row.name, balance: row.balance }))}
          locations={scopeByOutlet(actor, outlets, (outlet) => outlet.id).map((outlet) => ({ id: outlet.id, name: outlet.name }))}
          actorId={actor.id}
          scope={scoped ? outletName(actor.outletId) : undefined}
          permissions={{ create: can(actor, "finance.create"), approve: can(actor, "finance.approve"), superAdmin: actor.role === "SUPER_ADMIN", ledger: !scoped }}
        />
      </DashboardShell>
    );
  });
}
