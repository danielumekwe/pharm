"use client";

import { DataTable, type Column } from "@/components/erp/data-table";
import type { Payment } from "@/lib/erp/types";
import { dateTime, money } from "@/lib/format";

const columns: Column<Payment>[] = [
  { key: "ref", header: "Voucher", value: (row) => row.reference, render: (row) => <span className="font-mono text-xs text-white">{row.reference}</span> },
  { key: "date", header: "Date", value: (row) => row.date, render: (row) => <span className="text-slate-400">{dateTime(row.date)}</span> },
  { key: "party", header: "Party", value: (row) => row.partyName, render: (row) => <div><p className="text-white">{row.partyName}</p><p className="text-[11px] text-slate-500">{row.partyType}</p></div> },
  { key: "doc", header: "Document", value: (row) => row.documentRef, render: (row) => <span className="font-mono text-xs text-slate-400">{row.documentRef}</span> },
  { key: "account", header: "Account", value: (row) => row.account, render: (row) => row.account },
  { key: "method", header: "Method", value: (row) => row.method, render: (row) => row.method },
  {
    key: "amount",
    header: "Amount",
    value: (row) => (row.direction === "IN" ? row.amount : -row.amount),
    align: "right",
    render: (row) => <span className={row.direction === "IN" ? "text-emerald-300" : "text-rose-300"}>{row.direction === "IN" ? "+" : "−"}{money(row.amount)}</span>,
  },
  { key: "by", header: "Recorded by", value: (row) => row.recordedBy, render: (row) => <span className="text-slate-400">{row.recordedBy}</span> },
];

export function PaymentsLedger({ payments, accounts }: { payments: Payment[]; accounts: readonly string[] }) {
  return (
    <DataTable
      rows={payments}
      columns={columns}
      rowKey={(row) => row.id}
      search={(row) => `${row.reference} ${row.partyName} ${row.documentRef} ${row.recordedBy}`}
      filters={[
        { key: "direction", label: "Directions", options: [{ value: "IN", label: "Money in" }, { value: "OUT", label: "Money out" }], get: (row) => row.direction },
        { key: "party", label: "Party types", options: ["Customer", "Supplier", "Expense"].map((value) => ({ value, label: value })), get: (row) => row.partyType },
        { key: "account", label: "Accounts", options: accounts.map((value) => ({ value, label: value })), get: (row) => row.account },
      ]}
      exportName="payments-ledger"
      dense
    />
  );
}
