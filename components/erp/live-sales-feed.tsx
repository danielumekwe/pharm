"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FeedSale, SalesFeed } from "@/lib/erp/sales-feed";
import { money } from "@/lib/format";

const POLL_MS = 15_000;
/** Sales this recent count as new even if they were already there when the page opened. */
const NEW_FOR_MS = 10 * 60_000;

function ago(date: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(date)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(date).toLocaleDateString("en-GB");
}

const STATUS_STYLE: Record<FeedSale["status"], string> = {
  Paid: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  "Partially paid": "border-amber-500/30 bg-amber-500/10 text-amber-300",
  Unpaid: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  Voided: "border-slate-600/40 bg-slate-700/20 text-slate-300",
};

/** Dashboard list of the latest sales that refreshes itself, so sales reps see new sales as they happen. */
export function LiveSalesFeed({ initial }: { initial: SalesFeed }) {
  const [feed, setFeed] = useState(initial);
  const [now, setNow] = useState(() => Date.parse(initial.at));
  const [arrived, setArrived] = useState<string[]>([]);
  const [offline, setOffline] = useState(false);
  const known = useRef(new Set(initial.sales.map((sale) => sale.id)));

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/sales/feed", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const next = (await response.json()) as SalesFeed;
      const fresh = next.sales.filter((sale) => !known.current.has(sale.id)).map((sale) => sale.id);
      for (const id of fresh) known.current.add(id);
      if (fresh.length) setArrived((current) => [...fresh, ...current]);
      setFeed(next);
      setNow(Date.parse(next.at));
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  const isNew = (sale: FeedSale) => arrived.includes(sale.id) || now - Date.parse(sale.date) < NEW_FOR_MS;
  const newCount = feed.sales.filter(isNew).length;

  return (
    <Card className="border-slate-800 bg-slate-900/70">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg text-white">
            Latest sales
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300" title={offline ? "Connection lost, retrying" : "Updates every 15 seconds"}>
              <span className={`h-1.5 w-1.5 rounded-full ${offline ? "bg-amber-400" : "animate-pulse bg-emerald-400"}`} />
              {offline ? "Reconnecting" : "Live"}
            </span>
            {newCount ? <span className="rounded-full bg-lime-400 px-2 py-0.5 text-[11px] font-bold text-green-950">{newCount} new</span> : null}
          </CardTitle>
          <p className="mt-1 text-xs text-slate-400">
            Today: {feed.today.count} sale{feed.today.count === 1 ? "" : "s"} · {money(feed.today.total)}
          </p>
        </div>
        <Link href="/sales" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800">
          View All
        </Link>
      </CardHeader>
      <CardContent>
        {feed.sales.length ? (
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800">
                <TableHead className="text-slate-300">When</TableHead>
                <TableHead className="text-slate-300">Invoice</TableHead>
                <TableHead className="text-slate-300">Customer</TableHead>
                <TableHead className="text-slate-300">Sold by</TableHead>
                <TableHead className="text-right text-slate-300">Total</TableHead>
                <TableHead className="text-slate-300">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {feed.sales.map((sale) => {
                const fresh = isNew(sale);
                return (
                  <TableRow key={sale.id} className={`border-slate-800 transition-colors ${fresh ? "bg-lime-400/10" : ""}`}>
                    <TableCell className="whitespace-nowrap text-slate-200">
                      {fresh ? <span className="mr-1.5 rounded bg-lime-400 px-1.5 py-0.5 text-[10px] font-bold text-green-950">NEW</span> : null}
                      <span title={new Date(sale.date).toLocaleString("en-GB")}>{ago(sale.date, now)}</span>
                    </TableCell>
                    <TableCell className="text-slate-200">
                      <span className="font-medium">{sale.number}</span>
                      <span className="block text-[11px] text-slate-500">{sale.outlet} · {sale.items} item{sale.items === 1 ? "" : "s"}</span>
                    </TableCell>
                    <TableCell className="text-slate-200">{sale.customer}</TableCell>
                    <TableCell className="text-slate-200">{sale.cashier}</TableCell>
                    <TableCell className="text-right tabular-nums text-slate-200">
                      {money(sale.total)}
                      {sale.balance > 0 ? <span className="block text-[11px] text-amber-300">{money(sale.balance)} due</span> : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={STATUS_STYLE[sale.status]}>{sale.status.toUpperCase()}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-slate-400">No sales yet. New sales will appear here automatically.</p>
        )}
      </CardContent>
    </Card>
  );
}
