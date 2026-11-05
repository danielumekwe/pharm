"use client";

import { AlertTriangle, Boxes, PackageX } from "lucide-react";

import { DataTable, type Column } from "@/components/erp/data-table";
import { PageHeader } from "@/components/erp/page-header";
import { Panel, StatGrid } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import type { StockLevelRow } from "@/lib/erp/pos";
import { shortDate } from "@/lib/format";

const tone = (status: string) => (status === "In stock" ? "emerald" : status === "Low stock" ? "amber" : status === "Out of stock" ? "rose" : "slate");

export function StockLevelsView({ rows, scope, initialQuery }: { rows: StockLevelRow[]; scope?: string; initialQuery: string }) {
  const outlets = Array.from(new Set(rows.map((row) => row.outlet)));
  const columns: Column<StockLevelRow>[] = [
    { key: "name", header: "Item", value: (row) => row.name, render: (row) => <div><p className="text-white">{row.name}{row.rxOnly ? <span className="ml-2 rounded bg-sky-500/15 px-1 text-[10px] font-semibold text-sky-300">Rx</span> : null}</p><p className="text-[11px] text-slate-500">{[row.strength !== "-" ? row.strength : "", row.category].filter(Boolean).join(" · ")}</p></div> },
    ...(outlets.length > 1 ? [{ key: "outlet", header: "Outlet", value: (row: StockLevelRow) => row.outlet, render: (row: StockLevelRow) => row.outlet }] : []),
    { key: "qty", header: "Quantity left", align: "right", value: (row) => row.available, render: (row) => <div><p className="font-semibold tabular-nums text-white">{row.available.toLocaleString()} <span className="text-xs font-normal text-slate-400">{row.unit}</span></p>{row.packs ? <p className="text-[11px] text-slate-500">{row.packs}</p> : null}</div> },
    { key: "expiry", header: "Next expiry", value: (row) => row.nextExpiry ?? "9999", render: (row) => <span className="text-xs text-slate-400">{row.nextExpiry ? shortDate(row.nextExpiry) : "—"}</span> },
    { key: "status", header: "Status", value: (row) => row.status, render: (row) => <StatusBadge status={row.status} tone={tone(row.status)} /> },
  ];
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Main" title="Stock levels" description="How much of each item is left to sell. Read-only: stock is received, adjusted and transferred by the inventory team." scope={scope} />
      <StatGrid
        stats={[
          { label: "Items in stock", value: String(rows.filter((row) => row.status === "In stock").length), note: `${rows.length} items listed`, icon: Boxes, tone: "emerald" },
          { label: "Low stock", value: String(rows.filter((row) => row.status === "Low stock").length), note: "Tell the inventory team before they run out", icon: AlertTriangle, tone: "amber" },
          { label: "Out of stock", value: String(rows.filter((row) => row.status === "Out of stock").length), note: "Cannot be sold until restocked", icon: PackageX, tone: "rose" },
        ]}
      />
      <Panel title="Items">
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          initialQuery={initialQuery}
          search={(row) => `${row.name} ${row.category}`}
          filters={[
            { key: "status", label: "Statuses", options: ["In stock", "Low stock", "Out of stock", "Not for sale"].map((value) => ({ value, label: value })), get: (row) => row.status },
            ...(outlets.length > 1 ? [{ key: "outlet", label: "Outlets", options: outlets.map((value) => ({ value, label: value })), get: (row: StockLevelRow) => row.outlet }] : []),
          ]}
          pageSize={20}
        />
      </Panel>
    </div>
  );
}
