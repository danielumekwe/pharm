"use client";

import { Download, FileUp, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { DataTable, type Column } from "@/components/erp/data-table";
import { ActionButton, Field, FormError, TextInput } from "@/components/erp/fields";
import { Modal } from "@/components/erp/modal";
import { PageHeader } from "@/components/erp/page-header";
import { StatusBadge } from "@/components/erp/status-badge";
import { useAction } from "@/components/erp/use-action";

type ImportRow = {
  id: string;
  reference: string;
  kindLabel: string;
  status: string;
  fileName: string;
  rowCount: number;
  outletName: string | null;
  createdByName: string;
  createdAt: string;
  completedAt: string | null;
  rolledBackAt: string | null;
  rolledBackBy: string | null;
  rollbackReason: string | null;
  nextChunk: number;
  chunkCount: number;
  summary: Record<string, unknown>;
};

const STATUS: Record<string, { label: string; tone: "emerald" | "amber" | "rose" | "sky" | "slate" }> = {
  DRAFT: { label: "Uploaded", tone: "slate" },
  PREVIEWED: { label: "Previewed", tone: "sky" },
  IN_PROGRESS: { label: "Stopped part-way", tone: "amber" },
  COMPLETED: { label: "Completed", tone: "emerald" },
  ROLLED_BACK: { label: "Rolled back", tone: "rose" },
  CANCELLED: { label: "Discarded", tone: "slate" },
};

const number = (row: ImportRow, key: string) => Number(row.summary?.[key] ?? 0);

export function HistoryWorkspace({ imports, canRollback, scope }: { imports: ImportRow[]; canRollback: boolean; scope?: string }) {
  const [target, setTarget] = useState<ImportRow | null>(null);
  const [reason, setReason] = useState("");
  const { run, error, setError, busy } = useAction();

  const columns: Column<ImportRow>[] = [
    { key: "reference", header: "Import", render: (row) => <span className="font-medium text-white">{row.reference}</span>, value: (row) => row.reference },
    { key: "date", header: "Date", render: (row) => new Date(row.createdAt).toLocaleString("en-NG"), value: (row) => row.createdAt },
    { key: "file", header: "File", render: (row) => <span className="text-slate-300">{row.fileName}</span>, value: (row) => row.fileName },
    { key: "type", header: "Type", render: (row) => row.kindLabel, value: (row) => row.kindLabel },
    { key: "outlet", header: "Outlet", render: (row) => row.outletName ?? "—", value: (row) => row.outletName ?? "" },
    { key: "user", header: "User", render: (row) => row.createdByName, value: (row) => row.createdByName },
    {
      key: "products",
      header: "Products",
      render: (row) => (row.summary?.productsCreated !== undefined ? `${number(row, "productsCreated")} new · ${number(row, "productsMatched")} matched` : `${row.rowCount} rows`),
      value: (row) => number(row, "productsCreated"),
    },
    { key: "batches", header: "Batches", render: (row) => number(row, "batchesCreated").toLocaleString(), value: (row) => number(row, "batchesCreated") },
    { key: "quantity", header: "Quantity", render: (row) => number(row, "quantityImported").toLocaleString(), value: (row) => number(row, "quantityImported") },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <div>
          <StatusBadge status={STATUS[row.status]?.label ?? row.status} tone={STATUS[row.status]?.tone} />
          {row.status === "IN_PROGRESS" ? <p className="mt-1 text-xs text-slate-400">{row.nextChunk} of {row.chunkCount} parts</p> : null}
          {row.rolledBackAt ? <p className="mt-1 max-w-[220px] text-xs text-slate-400">by {row.rolledBackBy}: {row.rollbackReason}</p> : null}
        </div>
      ),
      value: (row) => row.status,
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex flex-wrap justify-end gap-2">
          {["DRAFT", "PREVIEWED", "IN_PROGRESS"].includes(row.status) ? (
            <Link href={`/inventory/import?id=${row.id}`} className="text-sm text-blue-400 hover:underline">
              {row.status === "IN_PROGRESS" ? "Resume" : "Open"}
            </Link>
          ) : null}
          {row.status !== "CANCELLED" ? (
            <a href={`/api/inventory-imports/${row.id}/report?type=all`} className="inline-flex items-center gap-1 text-sm text-blue-400 hover:underline" aria-label={`Report for ${row.reference}`}>
              <Download className="h-3.5 w-3.5" /> Report
            </a>
          ) : null}
          {canRollback && (row.status === "COMPLETED" || row.status === "IN_PROGRESS") ? (
            <ActionButton
              tone="danger"
              className="h-7 px-2 text-xs"
              onClick={() => {
                setTarget(row);
                setReason("");
                setError(null);
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Roll back
            </ActionButton>
          ) : null}
        </div>
      ),
    },
  ];

  async function rollback() {
    if (!target) return;
    const result = await run(`/api/inventory-imports/${target.id}/rollback`, "POST", { reason });
    if (result) setTarget(null);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Inventory"
        title="Import History"
        description="Every bulk import of products and opening stock, who ran it and what it created. An import can be rolled back while none of its stock has been sold, moved or adjusted."
        scope={scope}
        actions={
          <Link href="/inventory/import" className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-medium text-[#fff] hover:bg-blue-700">
            <FileUp className="h-4 w-4" /> New import
          </Link>
        }
      />
      <DataTable rows={imports} columns={columns} exportName="import-history" search={(row) => `${row.reference} ${row.fileName} ${row.createdByName} ${row.outletName ?? ""}`} rowKey={(row) => row.id} emptyMessage="No imports yet." />
      <Modal open={Boolean(target)} title={`Roll back ${target?.reference ?? ""}`} description={target?.fileName} onClose={() => setTarget(null)}>
        <div className="space-y-4 text-sm text-slate-300">
          <p>
            Products this import created are removed together with their batches. Stock it added to existing products is reversed with a stock adjustment, so their history stays. If any of the
            imported stock has been sold, transferred or adjusted, the rollback is refused and you will be told what to correct instead.
          </p>
          <Field label="Reason (recorded in the audit log)">
            <TextInput value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="e.g. Wrong outlet selected" />
          </Field>
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <ActionButton tone="secondary" onClick={() => setTarget(null)}>Cancel</ActionButton>
            <ActionButton tone="danger" disabled={busy || reason.trim().length < 5} onClick={rollback}>
              Roll back import
            </ActionButton>
          </div>
        </div>
      </Modal>
    </div>
  );
}
