"use client";

import { ArrowDownLeft, ArrowUpRight, CheckCircle2, ClipboardList, PlusCircle, Wallet, XCircle } from "lucide-react";
import { useState } from "react";

import { DataTable, type Column } from "@/components/erp/data-table";
import { ActionButton, Field, FormError, SelectInput, TextInput } from "@/components/erp/fields";
import { Modal } from "@/components/erp/modal";
import { PageHeader } from "@/components/erp/page-header";
import { PaymentsLedger } from "@/components/erp/payments-ledger";
import { Panel, StatGrid } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { TabBar } from "@/components/erp/tabs";
import { useAction } from "@/components/erp/use-action";
import { BANK_ACCOUNTS, EXPENSE_CATEGORIES, type Expense, type Payment } from "@/lib/erp/types";
import { compactMoney, isoDaysFromNow, money, shortDate } from "@/lib/format";

type Party = { id: string; name: string; balance: number };
type Permissions = { create: boolean; approve: boolean; superAdmin: boolean; ledger: boolean };

export function FinanceWorkspace({
  expenses,
  payments,
  customers,
  suppliers,
  locations,
  actorId,
  scope,
  permissions,
}: {
  expenses: Expense[];
  payments: Payment[];
  customers: Party[];
  suppliers: Party[];
  locations: { id: string; name: string }[];
  actorId: string;
  scope?: string;
  permissions: Permissions;
}) {
  const [modal, setModal] = useState<"expense" | "payment" | null>(null);
  const { run, error } = useAction();
  const since = isoDaysFromNow(-30);
  const recent = payments.filter((row) => row.date >= since);
  const cashIn = recent.filter((row) => row.direction === "IN").reduce((sum, row) => sum + row.amount, 0);
  const cashOut = recent.filter((row) => row.direction === "OUT").reduce((sum, row) => sum + row.amount, 0);
  const submitted = expenses.filter((row) => row.status === "Submitted");
  const monthExpenses = expenses.filter((row) => row.date >= since.slice(0, 10) && row.status !== "Rejected").reduce((sum, row) => sum + row.amount, 0);
  const locationName = (id: string) => locations.find((row) => row.id === id)?.name ?? id;

  const expenseColumns: Column<Expense>[] = [
    { key: "ref", header: "Reference", value: (row) => row.reference, render: (row) => <span className="font-mono text-xs text-white">{row.reference}</span> },
    { key: "date", header: "Date", value: (row) => row.date, render: (row) => <span className="text-slate-400">{shortDate(row.date)}</span> },
    { key: "category", header: "Category", value: (row) => row.category, render: (row) => row.category },
    { key: "desc", header: "Description", value: (row) => row.description, render: (row) => <div><p className="text-white">{row.description}</p><p className="text-[11px] text-slate-500">{row.vendor}</p></div> },
    { key: "loc", header: "Cost centre", value: (row) => locationName(row.outletId), render: (row) => locationName(row.outletId).replace(/^Outlet \d - /, "") },
    { key: "amount", header: "Amount", value: (row) => row.amount, align: "right", render: (row) => <span className="font-medium text-white">{money(row.amount)}</span> },
    { key: "by", header: "Requested / approved", value: (row) => row.requestedBy, render: (row) => <span className="text-xs text-slate-400">{row.requestedBy}{row.approvedBy ? ` / ${row.approvedBy}` : ""}</span> },
    { key: "status", header: "Status", value: (row) => row.status, render: (row) => <StatusBadge status={row.status} /> },
    {
      key: "actions",
      header: "",
      render: (row) => {
        if (!permissions.approve) return null;
        const own = row.requestedById === actorId && !permissions.superAdmin;
        if (row.status === "Submitted" && !own) {
          return (
            <div className="flex justify-end gap-1">
              <button type="button" title="Approve" onClick={() => void run(`/api/expenses/${row.id}`, "PATCH", { action: "approve" })} className="rounded-lg p-1.5 text-emerald-300 hover:bg-emerald-500/10"><CheckCircle2 className="h-4 w-4" /></button>
              <button type="button" title="Reject" onClick={() => void run(`/api/expenses/${row.id}`, "PATCH", { action: "reject" })} className="rounded-lg p-1.5 text-rose-300 hover:bg-rose-500/10"><XCircle className="h-4 w-4" /></button>
            </div>
          );
        }
        if (row.status === "Approved") {
          return <ActionButton tone="secondary" className="h-7 text-xs" onClick={() => void run(`/api/expenses/${row.id}`, "PATCH", { action: "pay" })}>Pay</ActionButton>;
        }
        return null;
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses & payments"
        description="Expense vouchers follow submit → approve → pay with segregation of duties. Customer receipts and supplier payments settle the oldest open documents first."
        scope={scope}
        actions={
          permissions.create ? (
            <>
              {permissions.ledger ? <ActionButton tone="secondary" onClick={() => setModal("payment")}><Wallet className="h-4 w-4" /> Record payment</ActionButton> : null}
              <ActionButton onClick={() => setModal("expense")}><PlusCircle className="h-4 w-4" /> New expense</ActionButton>
            </>
          ) : null
        }
      />

      <StatGrid
        stats={[
          ...(permissions.ledger
            ? [
                { label: "Cash in (30d)", value: compactMoney(cashIn), note: "Customer receipts", icon: ArrowDownLeft, tone: "emerald" as const },
                { label: "Cash out (30d)", value: compactMoney(cashOut), note: `Net ${cashIn - cashOut >= 0 ? "+" : "−"}${compactMoney(Math.abs(cashIn - cashOut))}`, icon: ArrowUpRight, tone: "rose" as const },
              ]
            : []),
          { label: "Expenses (30d)", value: compactMoney(monthExpenses), note: "Excluding rejected", icon: Wallet, tone: "sky" },
          { label: "Awaiting approval", value: String(submitted.length), note: compactMoney(submitted.reduce((sum, row) => sum + row.amount, 0)), icon: ClipboardList, tone: "amber" },
        ]}
      />

      <FormError message={error} />

      <Panel title="Finance register">
        <TabBar
          tabs={[
            {
              key: "expenses",
              label: "Expense vouchers",
              count: expenses.length,
              content: (
                <DataTable
                  rows={expenses}
                  columns={expenseColumns}
                  rowKey={(row) => row.id}
                  search={(row) => `${row.reference} ${row.description} ${row.vendor} ${row.requestedBy}`}
                  filters={[
                    { key: "status", label: "Statuses", options: ["Submitted", "Approved", "Paid", "Rejected"].map((value) => ({ value, label: value })), get: (row) => row.status },
                    { key: "category", label: "Categories", options: EXPENSE_CATEGORIES.map((value) => ({ value, label: value })), get: (row) => row.category },
                    ...(locations.length > 1 ? [{ key: "loc", label: "Cost centres", options: locations.map((row) => ({ value: row.id, label: row.name })), get: (row: Expense) => row.outletId }] : []),
                  ]}
                  exportName="expenses"
                />
              ),
            },
            ...(permissions.ledger
              ? [{ key: "payments", label: "Receipts & payments", count: payments.length, content: <PaymentsLedger payments={payments} accounts={BANK_ACCOUNTS} /> }]
              : []),
          ]}
        />
      </Panel>

      {modal === "expense" ? <ExpenseModal locations={locations} onClose={() => setModal(null)} /> : null}
      {modal === "payment" ? <PaymentModal customers={customers} suppliers={suppliers} onClose={() => setModal(null)} /> : null}
    </div>
  );
}

function ExpenseModal({ locations, onClose }: { locations: { id: string; name: string }[]; onClose: () => void }) {
  const { run, error, busy } = useAction();
  const [form, setForm] = useState({ category: EXPENSE_CATEGORIES[0] as string, description: "", vendor: "", outletId: locations[0]?.id ?? "", amount: "", date: new Date().toISOString().slice(0, 10) });
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <Modal open title="New expense voucher" description="Submitted vouchers need approval by a pharmacy manager before payment." onClose={onClose}>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category"><SelectInput value={form.category} onChange={set("category")} options={EXPENSE_CATEGORIES.map((value) => ({ value, label: value }))} /></Field>
          <Field label="Date"><TextInput type="date" value={form.date} onChange={set("date")} /></Field>
        </div>
        <Field label="Description"><TextInput value={form.description} onChange={set("description")} placeholder="e.g. Diesel for generator — 200L" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vendor"><TextInput value={form.vendor} onChange={set("vendor")} /></Field>
          <Field label="Amount (₦)"><TextInput type="number" min={1} value={form.amount} onChange={set("amount")} /></Field>
        </div>
        <Field label="Cost centre"><SelectInput value={form.outletId} disabled={locations.length < 2} onChange={set("outletId")} options={locations.map((row) => ({ value: row.id, label: row.name }))} /></Field>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <ActionButton tone="secondary" onClick={onClose}>Cancel</ActionButton>
          <ActionButton disabled={busy || !form.description || !(Number(form.amount) > 0)} onClick={async () => (await run("/api/expenses", "POST", { ...form, amount: Number(form.amount) })) && onClose()}>
            Submit voucher
          </ActionButton>
        </div>
      </div>
    </Modal>
  );
}

function PaymentModal({ customers, suppliers, onClose }: { customers: Party[]; suppliers: Party[]; onClose: () => void }) {
  const { run, error, busy } = useAction();
  const [partyType, setPartyType] = useState<"Customer" | "Supplier">("Customer");
  const parties = partyType === "Customer" ? customers : suppliers;
  const [partyId, setPartyId] = useState(customers[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Payment["method"]>("Transfer");
  const [account, setAccount] = useState<string>(BANK_ACCOUNTS[1]);
  const party = parties.find((row) => row.id === partyId);

  return (
    <Modal open title="Record payment" description="Receipts from customers or payments to suppliers against their outstanding balance." onClose={onClose}>
      <div className="grid gap-3">
        <Field label="Type">
          <SelectInput
            value={partyType}
            onChange={(event) => {
              const next = event.target.value as "Customer" | "Supplier";
              setPartyType(next);
              setPartyId((next === "Customer" ? customers : suppliers)[0]?.id ?? "");
            }}
            options={[{ value: "Customer", label: "Customer receipt (money in)" }, { value: "Supplier", label: "Supplier payment (money out)" }]}
          />
        </Field>
        <Field label={partyType} hint={party ? `Outstanding ${money(party.balance)}` : "No open balances"}>
          <SelectInput value={partyId} onChange={(event) => setPartyId(event.target.value)} options={parties.map((row) => ({ value: row.id, label: `${row.name} · ${money(row.balance)}` }))} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (₦)"><TextInput type="number" min={1} value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
          <Field label="Method"><SelectInput value={method} onChange={(event) => setMethod(event.target.value as Payment["method"])} options={["Transfer", "Cash", "Card", "HMO"].map((value) => ({ value, label: value }))} /></Field>
        </div>
        <Field label="Account"><SelectInput value={account} onChange={(event) => setAccount(event.target.value)} options={BANK_ACCOUNTS.map((value) => ({ value, label: value }))} /></Field>
        {partyType === "Supplier" ? <p className="text-xs text-slate-500">Supplier payments of ₦1M or more require approval rights.</p> : null}
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <ActionButton tone="secondary" onClick={onClose}>Cancel</ActionButton>
          <ActionButton
            disabled={busy || !party || !(Number(amount) > 0)}
            onClick={async () => (await run("/api/payments", "POST", { direction: partyType === "Customer" ? "IN" : "OUT", partyType, partyId, method, account, amount: Number(amount) })) && onClose()}
          >
            Post {partyType === "Customer" ? "receipt" : "payment"}
          </ActionButton>
        </div>
      </div>
    </Modal>
  );
}
