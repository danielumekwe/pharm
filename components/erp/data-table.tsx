"use client";

import { ArrowDownUp, ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { inputClass } from "@/components/erp/fields";

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Value used for sorting and CSV export. */
  value?: (row: T) => string | number;
  align?: "left" | "right";
  className?: string;
};

export type Filter<T> = {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  /** Value(s) for the row; a list matches when any entry equals the selected option. */
  get: (row: T) => string | string[] | null | undefined;
};

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  search,
  filters = [],
  toolbar,
  pageSize = 10,
  emptyMessage = "No records match the current filters.",
  exportName,
  dense = false,
  initialQuery = "",
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Returns the text a row is searched against. Omit to hide the search box. */
  search?: (row: T) => string;
  filters?: Filter<T>[];
  toolbar?: ReactNode;
  pageSize?: number;
  emptyMessage?: string;
  /** File name for CSV export; omit to hide the export button. */
  exportName?: string;
  dense?: boolean;
  /** Pre-filled search text (e.g. from a link in an alert email). */
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let result = rows.filter((row) => {
      if (needle && search && !search(row).toLowerCase().includes(needle)) return false;
      return filters.every((filter) => {
        const selected = active[filter.key];
        if (!selected) return true;
        const value = filter.get(row);
        return Array.isArray(value) ? value.includes(selected) : value === selected;
      });
    });
    if (sort) {
      const column = columns.find((col) => col.key === sort.key);
      if (column?.value) {
        const read = column.value;
        result = [...result].sort((a, b) => {
          const left = read(a);
          const right = read(b);
          return (left < right ? -1 : left > right ? 1 : 0) * sort.dir;
        });
      }
    }
    return result;
  }, [rows, query, active, sort, filters, columns, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * pageSize, currentPage * pageSize + pageSize);

  function exportCsv() {
    const exportable = columns.filter((column) => column.value);
    const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const lines = [
      exportable.map((column) => escape(column.header)).join(","),
      ...filtered.map((row) => exportable.map((column) => escape(column.value!(row))).join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${exportName}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const cellPad = dense ? "px-3 py-2" : "px-4 py-3";

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {search ? (
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
                placeholder="Search…"
                className={`${inputClass} pl-9`}
              />
            </div>
          ) : null}
          {filters.map((filter) => (
            <select
              key={filter.key}
              value={active[filter.key] ?? ""}
              onChange={(event) => {
                setActive((current) => ({ ...current, [filter.key]: event.target.value }));
                setPage(0);
              }}
              className={`${inputClass.replace("w-full ", "")} w-auto min-w-36`}
              aria-label={filter.label}
            >
              <option value="">All {filter.label.toLowerCase()}</option>
              {filter.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {toolbar}
          {exportName ? (
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-200 hover:bg-slate-800"
            >
              <Download className="h-4 w-4" /> CSV
            </button>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-950/80 text-left text-[11px] uppercase tracking-[0.14em] text-slate-400">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={`${cellPad} font-medium ${column.align === "right" ? "text-right" : ""}`}>
                  {column.value ? (
                    <button
                      type="button"
                      className={`inline-flex items-center gap-1 hover:text-white ${sort?.key === column.key ? "text-emerald-300" : ""}`}
                      onClick={() =>
                        setSort((current) =>
                          current?.key === column.key ? (current.dir === 1 ? { key: column.key, dir: -1 } : null) : { key: column.key, dir: 1 },
                        )
                      }
                    >
                      {column.header}
                      <ArrowDownUp className="h-3 w-3 opacity-60" />
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {visible.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-slate-500">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr key={rowKey(row)} className="bg-slate-900/30 text-slate-200 hover:bg-slate-800/40">
                  {columns.map((column) => (
                    <td key={column.key} className={`${cellPad} align-middle ${column.align === "right" ? "text-right tabular-nums" : ""} ${column.className ?? ""}`}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>
          {filtered.length === 0 ? 0 : currentPage * pageSize + 1}–{Math.min(filtered.length, (currentPage + 1) * pageSize)} of {filtered.length}
          {filtered.length !== rows.length ? ` (filtered from ${rows.length})` : ""}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
            className="rounded-lg border border-slate-800 p-1.5 hover:bg-slate-800 disabled:opacity-40"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="px-2">
            Page {currentPage + 1} / {pageCount}
          </span>
          <button
            type="button"
            disabled={currentPage >= pageCount - 1}
            onClick={() => setPage(currentPage + 1)}
            className="rounded-lg border border-slate-800 p-1.5 hover:bg-slate-800 disabled:opacity-40"
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
