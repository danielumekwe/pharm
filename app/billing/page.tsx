import { Banknote, Building2, CreditCard, Landmark } from "lucide-react";

import { DashboardShell } from "@/components/dashboard-shell";
import { PageHeader } from "@/components/erp/page-header";
import { PaymentsLedger } from "@/components/erp/payments-ledger";
import { Panel, StatGrid } from "@/components/erp/stat-card";
import { getStore } from "@/lib/erp/store";
import { BANK_ACCOUNTS } from "@/lib/erp/types";
import { compactMoney, money } from "@/lib/format";
import { isOutletScoped } from "@/lib/rbac";
import { requirePage } from "@/lib/session";

// Opening balances at the start of the period, before the movements in the ledger.
const OPENING: Record<string, number> = {
  "Cash till": 450000,
  "GTBank ••2231": 6200000,
  "Access ••7710": 2100000,
  "POS settlement ••0912": 380000,
};

const ICONS = [Banknote, Landmark, Building2, CreditCard];

export default async function BillingPage() {
  const actor = await requirePage("finance.view", "/billing");
  const payments = isOutletScoped(actor.role) ? [] : getStore().payments;

  const accounts = BANK_ACCOUNTS.map((account, index) => {
    const rows = payments.filter((row) => row.account === account);
    const inflow = rows.filter((row) => row.direction === "IN").reduce((sum, row) => sum + row.amount, 0);
    const outflow = rows.filter((row) => row.direction === "OUT").reduce((sum, row) => sum + row.amount, 0);
    return { account, inflow, outflow, balance: OPENING[account] + inflow - outflow, count: rows.length, icon: ICONS[index] };
  });

  return (
    <DashboardShell>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Treasury"
          title="Cash & bank"
          description="Running balances per till and bank account, derived from every receipt, refund, supplier payment and expense voucher."
        />
        {isOutletScoped(actor.role) ? (
          <p className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 text-sm text-slate-400">Bank balances are restricted to head-office finance roles.</p>
        ) : (
          <>
            <StatGrid
              stats={accounts.map((row) => ({
                label: row.account,
                value: compactMoney(row.balance),
                note: `+${compactMoney(row.inflow)} / −${compactMoney(row.outflow)} · ${row.count} entries`,
                icon: row.icon,
                tone: row.balance < 500000 ? "amber" : "emerald",
              }))}
            />
            <Panel title="Account ledger" description={`Consolidated balance ${money(accounts.reduce((sum, row) => sum + row.balance, 0))}`}>
              <PaymentsLedger payments={payments} accounts={BANK_ACCOUNTS} />
            </Panel>
          </>
        )}
      </div>
    </DashboardShell>
  );
}
