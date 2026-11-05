import type { Metadata } from "next";

import { posCatalog, posOutlets, heldSalesFor } from "@/lib/erp/pos";
import { scopeByOutlet } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import { can } from "@/lib/rbac";
import { requirePage } from "@/lib/session";

import { PosTerminal } from "./pos-terminal";

export const metadata: Metadata = { title: "Sales POS" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/** Dedicated full-screen point of sale (outside the dashboard layout). */
export default async function PosPage({ searchParams }: { searchParams: Search }) {
  const actor = await requirePage("sales.create", "/pos");
  const params = await searchParams;
  const store = getStore();
  const outlets = posOutlets(actor);
  const outletId = outlets[0]?.id ?? null;
  const counter = store.counters.sale ?? 1;
  return (
    <PosTerminal
      cashier={{ id: actor.id, name: actor.name, role: actor.role }}
      outlets={outlets.map((outlet) => ({ id: outlet.id, name: outlet.name, address: outlet.address }))}
      initialOutletId={outletId}
      initialCatalog={outletId ? posCatalog(actor, outletId) : []}
      initialHeld={heldSalesFor(actor, outletId)}
      customers={scopeByOutlet(actor, store.customers, (customer) => customer.outletId).map((customer) => ({
        id: customer.id,
        name: customer.name,
        type: customer.type,
        phone: customer.phone,
        status: customer.status,
        available: Math.max(0, customer.creditLimit - customer.balance),
      }))}
      settings={{ vatRate: store.settings.vatRate, cashierMaxDiscountPct: store.settings.pos.cashierMaxDiscountPct, approverMaxDiscountPct: store.settings.pos.approverMaxDiscountPct }}
      canDiscount={can(actor, "sales.discount")}
      nextInvoice={`INV-${String(counter).padStart(5, "0")}`}
      openHeld={params.held === "1"}
      resumeId={typeof params.resume === "string" ? params.resume : null}
    />
  );
}
