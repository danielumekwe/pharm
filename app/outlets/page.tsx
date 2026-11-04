import { Boxes, MapPinned, ShoppingBag, Store, Users, Warehouse } from "lucide-react";

import { DashboardShell } from "@/components/dashboard-shell";
import { PageHeader } from "@/components/erp/page-header";
import { StatGrid } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { batches, outlets, products, stockMovements, users } from "@/lib/data";
import { getSalesKpis, isExpired, scopeByOutlet } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import { compactMoney, isoDaysFromNow, money } from "@/lib/format";
import { can } from "@/lib/rbac";
import { requirePage } from "@/lib/session";

import { OutletManager } from "./outlet-manager";

export default async function OutletsPage() {
  const actor = await requirePage("outlets.view", "/outlets");
  const store = getStore();
  const since = isoDaysFromNow(-30);

  const locations = scopeByOutlet(actor, outlets, (outlet) => outlet.id).map((outlet) => {
    const items = products.filter((product) => product.outletId === outlet.id);
    const sales = store.sales.filter((sale) => sale.outletId === outlet.id && sale.status !== "Voided" && sale.date >= since);
    return {
      ...outlet,
      costValue: items.reduce((sum, product) => sum + product.stock * product.purchasePrice, 0),
      retailValue: items.reduce((sum, product) => sum + product.stock * product.sellingPrice, 0),
      skuCount: items.length,
      lowStock: items.filter((product) => product.status === "LOW_STOCK").length,
      expiredBatches: batches.filter((batch) => batch.assignedOutletId === outlet.id && isExpired(batch) && batch.availableQuantity > 0).length,
      revenue: sales.reduce((sum, sale) => sum + sale.total, 0),
      invoices: sales.length,
      staff: users.filter((user) => (user.outletIds ?? []).includes(outlet.id) && user.status !== "DEACTIVATED").length,
      pendingInbound: stockMovements.filter((movement) => movement.toOutletId === outlet.id && movement.status === "Pending").length,
    };
  });

  const kpis = getSalesKpis(scopeByOutlet(actor, store.sales, (sale) => sale.outletId));

  return (
    <DashboardShell>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Network"
          title="Outlets & warehouses"
          description="Retail outlets sell to patients; the central warehouse receives bulk deliveries and replenishes outlets through approved transfers."
        />
        <StatGrid
          stats={[
            { label: "Locations", value: String(locations.length), note: `${locations.filter((row) => row.type === "WAREHOUSE").length} warehouse`, icon: Store, tone: "sky" },
            { label: "Network stock (cost)", value: compactMoney(locations.reduce((sum, row) => sum + row.costValue, 0)), note: `Retail value ${compactMoney(locations.reduce((sum, row) => sum + row.retailValue, 0))}`, icon: Boxes, tone: "emerald" },
            { label: "30-day revenue", value: compactMoney(kpis.gross), note: `${kpis.count} invoices`, icon: ShoppingBag, tone: "amber" },
            { label: "Staff assigned", value: String(locations.reduce((sum, row) => sum + row.staff, 0)), note: "Excludes head office", icon: Users, tone: "slate" },
          ]}
        />

        <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-4">
          {locations.map((outlet) => (
            <div key={outlet.id} className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 text-sm text-slate-300">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2 text-emerald-300">
                    {outlet.type === "WAREHOUSE" ? <Warehouse className="h-5 w-5" /> : <Store className="h-5 w-5" />}
                  </div>
                  <div>
                    <p className="font-semibold text-white">{outlet.name}</p>
                    <p className="font-mono text-xs text-slate-500">{outlet.code}</p>
                  </div>
                </div>
                <StatusBadge status={outlet.type === "WAREHOUSE" ? "Warehouse" : "Retail"} tone={outlet.type === "WAREHOUSE" ? "sky" : "emerald"} />
              </div>
              <div className="space-y-1.5 text-xs">
                <p className="flex items-center gap-2"><MapPinned className="h-3.5 w-3.5 text-slate-500" />{outlet.address}</p>
                <p className="flex items-center gap-2"><Users className="h-3.5 w-3.5 text-slate-500" />Manager: {outlet.manager} · {outlet.staff} staff</p>
              </div>
              <dl className="grid grid-cols-2 gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs">
                <div><dt className="text-slate-500">Stock at cost</dt><dd className="text-sm font-medium text-white">{money(outlet.costValue)}</dd></div>
                <div><dt className="text-slate-500">SKUs</dt><dd className="text-sm font-medium text-white">{outlet.skuCount}</dd></div>
                {outlet.type !== "WAREHOUSE" ? (
                  <>
                    <div><dt className="text-slate-500">30-day sales</dt><dd className="text-sm font-medium text-white">{compactMoney(outlet.revenue)}</dd></div>
                    <div><dt className="text-slate-500">Invoices</dt><dd className="text-sm font-medium text-white">{outlet.invoices}</dd></div>
                  </>
                ) : (
                  <div className="col-span-2"><dt className="text-slate-500">Role</dt><dd className="text-sm text-white">Bulk receiving & replenishment</dd></div>
                )}
              </dl>
              <div className="mt-auto flex flex-wrap gap-2">
                {outlet.lowStock ? <StatusBadge status={`${outlet.lowStock} low stock`} tone="amber" /> : <StatusBadge status="Stock healthy" tone="emerald" />}
                {outlet.expiredBatches ? <StatusBadge status={`${outlet.expiredBatches} expired batch`} tone="rose" /> : null}
                {outlet.pendingInbound ? <StatusBadge status={`${outlet.pendingInbound} inbound transfer`} tone="sky" /> : null}
              </div>
            </div>
          ))}
        </div>

        {can(actor, "outlets.manage") ? (
          <OutletManager
            outlets={outlets.map((outlet) => ({
              id: outlet.id,
              name: outlet.name,
              code: outlet.code,
              type: outlet.type ?? "RETAIL",
              address: outlet.address,
              manager: outlet.manager,
              phone: outlet.phone ?? "",
              pcnLicense: outlet.pcnLicense ?? "",
              licenceExpiry: outlet.licenceExpiry ?? "",
              status: outlet.status ?? "ACTIVE",
              staff: users.filter((user) => (user.outletIds ?? []).includes(outlet.id) && user.status !== "DEACTIVATED").length,
              units: products.filter((product) => product.outletId === outlet.id).reduce((sum, product) => sum + product.stock, 0),
            }))}
          />
        ) : null}
      </div>
    </DashboardShell>
  );
}
