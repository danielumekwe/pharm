// Latest sales for the dashboard's live feed, limited to the outlets the viewer may see.

import { outletName, scopeByOutlet } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import type { Actor, SaleStatus } from "@/lib/erp/types";

export type FeedSale = {
  id: string;
  number: string;
  date: string;
  outlet: string;
  customer: string;
  cashier: string;
  items: number;
  total: number;
  balance: number;
  status: SaleStatus;
};

export type SalesFeed = { sales: FeedSale[]; today: { count: number; total: number }; at: string };

export function salesFeed(actor: Actor, limit = 8): SalesFeed {
  const sales = scopeByOutlet(actor, getStore().sales, (sale) => sale.outletId);
  const today = new Date().toISOString().slice(0, 10);
  const todays = sales.filter((sale) => sale.status !== "Voided" && sale.date.slice(0, 10) === today);
  return {
    sales: [...sales]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, limit)
      .map((sale) => ({
        id: sale.id,
        number: sale.number,
        date: sale.date,
        outlet: outletName(sale.outletId),
        customer: sale.customerName,
        cashier: sale.cashier,
        items: sale.lines.reduce((sum, line) => sum + line.quantity, 0),
        total: sale.total,
        balance: sale.status === "Voided" ? 0 : sale.total - sale.amountPaid,
        status: sale.status,
      })),
    today: { count: todays.length, total: todays.reduce((sum, sale) => sum + sale.total, 0) },
    at: new Date().toISOString(),
  };
}
