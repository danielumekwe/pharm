"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Ban,
  Copy,
  KeyRound,
  MailPlus,
  Pencil,
  RotateCcw,
  ShieldCheck,
  Store,
  UserCheck,
  UserPlus,
  Users,
  UserX,
  UserCog,
  Search,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState } from "react";

import { DataTable, type Column } from "@/components/erp/data-table";
import { ActionButton, Field, FormError, SelectInput, TextInput } from "@/components/erp/fields";
import { Modal } from "@/components/erp/modal";
import { PageHeader } from "@/components/erp/page-header";
import { Panel, StatGrid } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { useAction } from "@/components/erp/use-action";
import { dateTime, isoDaysFromNow } from "@/lib/format";

type StaffRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  staffId: string;
  role: string;
  outletId: string | null;
  outletIds: string[];
  status: string;
  grants: string[];
  lastLogin: string | null;
  createdAt: string | null;
  invitePending: boolean;
  manageable: boolean;
};
type RoleOption = { value: string; label: string; scoped: boolean };
type OutletOption = { id: string; name: string; closed: boolean };
type Grantable = { key: string; label: string; group: string };
type CredentialResult = { user: { name: string; email: string; staffId: string }; invitePath: string | null; temporaryPassword: string | null };

const STATUS_LABELS: Record<string, string> = { ACTIVE: "Active", SUSPENDED: "Suspended", DEACTIVATED: "Deactivated", INVITED: "Invited" };
const STATUS_TONES: Record<string, "emerald" | "amber" | "rose" | "slate" | "sky"> = { ACTIVE: "emerald", SUSPENDED: "amber", DEACTIVATED: "slate", INVITED: "sky" };

export function UsersWorkspace(props: {
  users: StaffRow[];
  teamOutlets: { id: string; name: string; type: string }[];
  outlets: OutletOption[];
  roles: RoleOption[];
  assignableRoles: string[];
  assignableOutlets: string[];
  grantable: Grantable[];
  nextStaffId: string;
  passwordMinLength: number;
  actorId: string;
  actorIsSuperAdmin: boolean;
  scope?: string;
  canManage: boolean;
  impersonation: { enabled: boolean; canStart: boolean; maxMinutes: number; sessions: ImpersonationRow[] };
}) {
  const { users, teamOutlets, outlets, roles, actorId, canManage } = props;
  const [switching, setSwitching] = useState<StaffRow | "pick" | null>(null);
  const canSwitch = props.impersonation.enabled && props.impersonation.canStart;
  const eligible = users.filter((user) => user.id !== actorId && user.role !== "SUPER_ADMIN" && user.status === "ACTIVE");
  const [modal, setModal] = useState<{ kind: "add" } | { kind: "edit"; user: StaffRow } | { kind: "status"; user: StaffRow; status: "SUSPENDED" | "DEACTIVATED" | "ACTIVE" } | null>(null);
  const [credential, setCredential] = useState<CredentialResult | null>(null);
  const { run, error } = useAction();
  const roleLabel = (role: string) => roles.find((row) => row.value === role)?.label ?? role;
  const outletLabel = (id: string) => outlets.find((outlet) => outlet.id === id)?.name.replace(/^Outlet \d - /, "") ?? id;
  const dormantSince = isoDaysFromNow(-30);
  const dormant = users.filter((user) => user.status === "ACTIVE" && (!user.lastLogin || user.lastLogin < dormantSince));

  async function credentialAction(user: StaffRow, action: "reset-password" | "resend-invite") {
    const prompt = action === "reset-password" ? `Reset the password for ${user.name}? Their current password stops working immediately.` : `Issue a new invitation link to ${user.name}? Earlier links stop working.`;
    if (!window.confirm(prompt)) return;
    const result = await run<CredentialResult>(`/api/users/${user.id}`, "PATCH", { action });
    if (result) setCredential(result);
  }

  const columns: Column<StaffRow>[] = [
    {
      key: "name",
      header: "Staff member",
      value: (row) => row.name,
      render: (row) => (
        <div>
          <p className="text-white">
            {row.name}
            {row.id === actorId ? <span className="ml-2 text-[11px] text-emerald-300">you</span> : null}
          </p>
          <p className="text-[11px] text-slate-500">{row.email} · {row.phone || "no phone"}</p>
        </div>
      ),
    },
    { key: "staffId", header: "Staff ID", value: (row) => row.staffId, render: (row) => <span className="whitespace-nowrap font-mono text-xs">{row.staffId}</span> },
    {
      key: "role",
      header: "Role",
      value: (row) => roleLabel(row.role),
      render: (row) => (
        <div>
          <p>{roleLabel(row.role)}</p>
          {row.grants.length ? <p className="text-[11px] text-sky-300">+{row.grants.length} extra permission{row.grants.length > 1 ? "s" : ""}</p> : null}
        </div>
      ),
    },
    {
      key: "outlets",
      header: "Assigned outlets",
      value: (row) => row.outletIds.map(outletLabel).join(", ") || "All",
      render: (row) =>
        row.outletIds.length === 0 ? (
          <span className="text-slate-400">All outlets</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.outletIds.map((id) => (
              <span key={id} className={`rounded-md border px-1.5 py-0.5 text-[11px] ${id === row.outletId ? "border-green-600/40 bg-green-50 font-semibold text-green-800" : "border-slate-700 text-slate-300"}`}>
                {outletLabel(id)}
              </span>
            ))}
          </div>
        ),
    },
    { key: "status", header: "Status", value: (row) => row.status, render: (row) => <StatusBadge status={STATUS_LABELS[row.status] ?? row.status} tone={STATUS_TONES[row.status]} /> },
    {
      key: "login",
      header: "Last login",
      value: (row) => row.lastLogin ?? "",
      render: (row) =>
        row.lastLogin ? (
          <span className={row.lastLogin < dormantSince ? "text-amber-300" : "text-slate-400"}>{dateTime(row.lastLogin)}</span>
        ) : (
          <span className="text-slate-500">{row.status === "INVITED" ? (row.invitePending ? "Invitation sent" : "Invitation expired") : "Never"}</span>
        ),
    },
    {
      key: "actions",
      header: "",
      render: (row) =>
        row.manageable || (canSwitch && eligible.some((user) => user.id === row.id)) ? (
          <div className="flex justify-end gap-0.5">
            {canSwitch && eligible.some((user) => user.id === row.id) ? (
              <IconButton label="Switch to this user" onClick={() => setSwitching(row)}><UserCog className="h-4 w-4" /></IconButton>
            ) : null}
            {row.manageable ? (<>
            <IconButton label="Edit" onClick={() => setModal({ kind: "edit", user: row })}><Pencil className="h-4 w-4" /></IconButton>
            {row.status === "INVITED" ? (
              <IconButton label="Resend invitation" onClick={() => void credentialAction(row, "resend-invite")}><MailPlus className="h-4 w-4" /></IconButton>
            ) : row.status !== "DEACTIVATED" ? (
              <IconButton label="Reset password" onClick={() => void credentialAction(row, "reset-password")}><RotateCcw className="h-4 w-4" /></IconButton>
            ) : null}
            {row.status === "ACTIVE" ? (
              <IconButton label="Suspend" tone="amber" onClick={() => setModal({ kind: "status", user: row, status: "SUSPENDED" })}><UserX className="h-4 w-4" /></IconButton>
            ) : row.status === "SUSPENDED" || (row.status === "DEACTIVATED" && props.actorIsSuperAdmin) ? (
              <IconButton label="Reactivate" tone="emerald" onClick={() => setModal({ kind: "status", user: row, status: "ACTIVE" })}><UserCheck className="h-4 w-4" /></IconButton>
            ) : null}
            {row.status !== "DEACTIVATED" ? (
              <IconButton label="Deactivate" tone="rose" onClick={() => setModal({ kind: "status", user: row, status: "DEACTIVATED" })}><Ban className="h-4 w-4" /></IconButton>
            ) : null}
            </>) : null}
          </div>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Staff & users"
        description="Each outlet manages its own team. Staff are restricted to their assigned outlet(s); central roles see the whole network. All changes are recorded in the audit trail."
        scope={props.scope}
        actions={
          <>
            <Link href="/permissions" className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm font-medium text-slate-100 hover:bg-slate-800">
              <KeyRound className="h-4 w-4" /> Roles & permissions
            </Link>
            {canSwitch ? (
              <ActionButton tone="secondary" onClick={() => setSwitching("pick")}>
                <UserCog className="h-4 w-4" /> Switch user
              </ActionButton>
            ) : null}
            {canManage && props.assignableRoles.length ? (
              <ActionButton onClick={() => setModal({ kind: "add" })}>
                <UserPlus className="h-4 w-4" /> Add staff
              </ActionButton>
            ) : null}
          </>
        }
      />

      <StatGrid
        stats={[
          { label: "Staff accounts", value: String(users.length), note: `${users.filter((row) => row.status === "ACTIVE").length} active`, icon: Users, tone: "emerald" },
          { label: "Suspended / deactivated", value: String(users.filter((row) => row.status === "SUSPENDED" || row.status === "DEACTIVATED").length), note: "Cannot sign in", icon: UserX, tone: "rose" },
          { label: "Pending invitations", value: String(users.filter((row) => row.status === "INVITED").length), note: `${users.filter((row) => row.status === "INVITED" && !row.invitePending).length} expired`, icon: MailPlus, tone: "sky" },
          { label: "Dormant accounts", value: String(dormant.length), note: "Active but no login for 30+ days — review access", icon: AlertTriangle, tone: "amber" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {teamOutlets.map((outlet) => {
          const team = users.filter((user) => user.outletIds.includes(outlet.id) && user.status !== "DEACTIVATED");
          const count = (role: string) => team.filter((user) => user.role === role).length;
          const retail = outlet.type !== "WAREHOUSE";
          const gaps = [retail && count("SALES_MANAGER") === 0 ? "No sales manager" : null, count("STOCK_MANAGER") === 0 ? "No stock manager" : null].filter(Boolean);
          return (
            <div key={outlet.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-sm">
              <p className="flex items-center gap-2 font-semibold text-white"><Store className="h-4 w-4 text-emerald-300" />{outlet.name}</p>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg bg-slate-950/60 p-2"><dt className="text-slate-500">Sales mgr</dt><dd className="text-base font-semibold text-white">{count("SALES_MANAGER")}</dd></div>
                <div className="rounded-lg bg-slate-950/60 p-2"><dt className="text-slate-500">Stock mgr</dt><dd className="text-base font-semibold text-white">{count("STOCK_MANAGER")}</dd></div>
                <div className="rounded-lg bg-slate-950/60 p-2"><dt className="text-slate-500">Staff</dt><dd className="text-base font-semibold text-white">{count("STAFF")}</dd></div>
              </dl>
              <p className={`mt-2 text-xs ${gaps.length ? "text-amber-300" : "text-slate-500"}`}>{gaps.length ? gaps.join(" · ") : `${team.length} people assigned`}</p>
            </div>
          );
        })}
      </div>

      {!canManage ? <p className="text-xs text-slate-500">Read-only: your role can view staff but not change accounts.</p> : null}
      <FormError message={error} />

      <Panel title="Staff directory">
        <DataTable
          rows={users}
          columns={columns}
          rowKey={(row) => row.id}
          search={(row) => `${row.name} ${row.email} ${row.phone} ${row.staffId} ${roleLabel(row.role)}`}
          filters={[
            { key: "role", label: "Roles", options: roles.map((role) => ({ value: role.value, label: role.label })), get: (row) => row.role },
            { key: "outlet", label: "Outlets", options: outlets.map((outlet) => ({ value: outlet.id, label: outlet.name })), get: (row) => row.outletIds },
            { key: "status", label: "Statuses", options: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })), get: (row) => row.status },
          ]}
          exportName="staff"
          pageSize={12}
        />
      </Panel>

      {modal?.kind === "add" ? (
        <UserFormModal
          mode="add"
          {...props}
          onClose={() => setModal(null)}
          onDone={(result) => {
            setModal(null);
            if (result) setCredential(result as CredentialResult);
          }}
        />
      ) : null}
      {modal?.kind === "edit" ? <UserFormModal key={modal.user.id} mode="edit" user={modal.user} {...props} onClose={() => setModal(null)} onDone={() => setModal(null)} /> : null}
      {modal?.kind === "status" ? <StatusModal user={modal.user} status={modal.status} onClose={() => setModal(null)} /> : null}
      {credential ? <CredentialModal credential={credential} onClose={() => setCredential(null)} /> : null}
      {switching ? <SwitchUserModal users={eligible} initial={switching === "pick" ? null : switching} roleLabel={roleLabel} outletLabel={outletLabel} maxMinutes={props.impersonation.maxMinutes} onClose={() => setSwitching(null)} /> : null}

      {props.impersonation.canStart ? (
        <Panel
          title="Switch-user sessions"
          description={props.impersonation.enabled ? `Enabled · sessions end automatically after ${props.impersonation.maxMinutes} minutes. Every action is audited under both accounts.` : "Disabled in System settings — no new sessions can start."}
        >
          <DataTable
            rows={props.impersonation.sessions}
            columns={[
              { key: "admin", header: "Administrator", value: (row) => row.adminName, render: (row) => row.adminName },
              { key: "target", header: "Acted as", value: (row) => row.targetName, render: (row) => <div><p className="text-white">{row.targetName}</p><p className="text-[11px] text-slate-500">{roleLabel(row.targetRole)} · {row.targetStaffId}</p></div> },
              { key: "reason", header: "Reason", value: (row) => row.reason, render: (row) => <span className="text-slate-300">{row.reason}</span> },
              { key: "start", header: "Started", value: (row) => row.startedAt, render: (row) => <span className="whitespace-nowrap text-xs text-slate-400">{dateTime(row.startedAt)}</span> },
              { key: "end", header: "Ended", value: (row) => row.endedAt ?? "", render: (row) => (row.endedAt ? <div><p className="whitespace-nowrap text-xs text-slate-400">{dateTime(row.endedAt)}</p><p className="text-[11px] text-slate-500">{row.endReason}</p></div> : <StatusBadge status="Active" tone="amber" />) },
              { key: "actions", header: "Actions", value: (row) => row.actions, align: "right", render: (row) => row.actions },
            ]}
            rowKey={(row) => row.id}
            emptyMessage="No switch-user sessions yet."
            exportName="impersonation-sessions"
            dense
          />
        </Panel>
      ) : null}
    </div>
  );
}

function IconButton({ label, tone, onClick, children }: { label: string; tone?: "amber" | "rose" | "emerald"; onClick: () => void; children: React.ReactNode }) {
  const tones = { amber: "hover:text-amber-300", rose: "hover:text-rose-300", emerald: "hover:text-emerald-300" };
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className={`rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 ${tone ? tones[tone] : "hover:text-white"}`}>
      {children}
    </button>
  );
}

function UserFormModal(
  props: {
    mode: "add" | "edit";
    user?: StaffRow;
    outlets: OutletOption[];
    roles: RoleOption[];
    assignableRoles: string[];
    assignableOutlets: string[];
    grantable: Grantable[];
    nextStaffId: string;
    passwordMinLength: number;
    onClose: () => void;
    onDone: (result?: unknown) => void;
  },
) {
  const { mode, user, outlets, roles } = props;
  const { run, error, busy } = useAction();
  const roleOptions = roles.filter((role) => props.assignableRoles.includes(role.value) || role.value === user?.role);
  const [form, setForm] = useState(() => ({
    name: user?.name ?? "",
    email: user?.email ?? "",
    phone: user?.phone ?? "",
    staffId: user?.staffId ?? "",
    role: user?.role ?? props.assignableRoles[props.assignableRoles.length - 1] ?? "STAFF",
    outletIds: user?.outletIds ?? (props.assignableOutlets.length === 1 ? [props.assignableOutlets[0]] : []),
    primaryOutletId: user?.outletId ?? props.assignableOutlets[0] ?? null,
    status: "ACTIVE" as "ACTIVE" | "SUSPENDED",
    credentialMode: "invite" as "invite" | "password",
    password: "",
    grants: user?.grants ?? [],
  }));
  const selectedRole = roles.find((role) => role.value === form.role);
  const scoped = selectedRole?.scoped ?? true;
  const set = (key: "name" | "email" | "phone" | "staffId" | "password") => (event: React.ChangeEvent<HTMLInputElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const toggleOutlet = (id: string) =>
    setForm((current) => {
      const outletIds = current.outletIds.includes(id) ? current.outletIds.filter((value) => value !== id) : [...current.outletIds, id];
      return { ...current, outletIds, primaryOutletId: outletIds.includes(current.primaryOutletId ?? "") ? current.primaryOutletId : outletIds[0] ?? null };
    });
  const groups = Array.from(new Set(props.grantable.map((grant) => grant.group)));

  async function submit() {
    const common = {
      name: form.name,
      email: form.email,
      phone: form.phone,
      role: form.role,
      outletIds: scoped ? form.outletIds : [],
      primaryOutletId: scoped ? form.primaryOutletId : null,
      grants: form.grants,
    };
    const result =
      mode === "add"
        ? await run("/api/users", "POST", {
            ...common,
            staffId: form.staffId || undefined,
            status: form.status,
            credential: form.credentialMode === "invite" ? { mode: "invite" } : { mode: "password", password: form.password },
          })
        : await run(`/api/users/${user!.id}`, "PATCH", { action: "update", ...common });
    if (result) props.onDone(mode === "add" ? result : undefined);
  }

  return (
    <Modal open title={mode === "add" ? "Add staff member" : `Edit ${user?.name}`} description={mode === "add" ? "Staff can only sign in to the outlets you assign." : `Staff ID ${user?.staffId}`} onClose={props.onClose} wide>
      <div className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Full name"><TextInput value={form.name} onChange={set("name")} /></Field>
          <Field label="Staff ID" hint={mode === "add" ? `Leave blank to use ${props.nextStaffId}` : "Cannot be changed"}>
            <TextInput value={form.staffId} onChange={set("staffId")} placeholder={props.nextStaffId} disabled={mode === "edit"} />
          </Field>
          <Field label="Email address"><TextInput type="email" value={form.email} onChange={set("email")} /></Field>
          <Field label="Phone number"><TextInput type="tel" value={form.phone} onChange={set("phone")} placeholder="0803 000 0000" /></Field>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Role" hint={roleOptions.length < roles.length ? "You can only assign roles below your own." : undefined}>
            <SelectInput
              value={form.role}
              onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))}
              options={roleOptions.map((role) => ({ value: role.value, label: role.label }))}
            />
          </Field>
          {mode === "add" ? (
            <Field label="Initial status">
              <SelectInput value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as "ACTIVE" | "SUSPENDED" }))} options={[{ value: "ACTIVE", label: "Active" }, { value: "SUSPENDED", label: "Suspended (prepare account only)" }]} />
            </Field>
          ) : null}
        </div>

        {scoped ? (
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">Assigned outlets</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {outlets.filter((outlet) => !outlet.closed).map((outlet) => {
                const allowed = props.assignableOutlets.includes(outlet.id);
                return (
                  <label key={outlet.id} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${form.outletIds.includes(outlet.id) ? "border-green-600 bg-green-50 text-green-900" : "border-slate-700"} ${allowed ? "cursor-pointer" : "opacity-40"}`}>
                    <input type="checkbox" className="h-4 w-4 accent-green-700" disabled={!allowed} checked={form.outletIds.includes(outlet.id)} onChange={() => toggleOutlet(outlet.id)} />
                    {outlet.name}
                  </label>
                );
              })}
            </div>
            {form.outletIds.length > 1 ? (
              <div className="mt-3 max-w-xs">
                <Field label="Primary outlet" hint="Default outlet at sign-in; the user can switch between assigned outlets.">
                  <SelectInput value={form.primaryOutletId ?? ""} onChange={(event) => setForm((current) => ({ ...current, primaryOutletId: event.target.value }))} options={form.outletIds.map((id) => ({ value: id, label: outlets.find((outlet) => outlet.id === id)?.name ?? id }))} />
                </Field>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">{selectedRole?.label} is a central role with access to every outlet.</p>
        )}

        {mode === "add" ? (
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">Login credentials</p>
            <div className="mt-2 flex flex-wrap gap-4">
              <label className="flex items-center gap-2"><input type="radio" className="accent-green-700" checked={form.credentialMode === "invite"} onChange={() => setForm((current) => ({ ...current, credentialMode: "invite" }))} />Send an invitation link (user sets their own password)</label>
              <label className="flex items-center gap-2"><input type="radio" className="accent-green-700" checked={form.credentialMode === "password"} onChange={() => setForm((current) => ({ ...current, credentialMode: "password" }))} />Set an initial password now</label>
            </div>
            {form.credentialMode === "password" ? (
              <div className="mt-3 max-w-sm">
                <Field label="Initial password" hint={`At least ${props.passwordMinLength} characters with upper-case, lower-case and a number.`}>
                  <TextInput type="text" autoComplete="new-password" value={form.password} onChange={set("password")} />
                </Field>
              </div>
            ) : null}
          </div>
        ) : null}

        {props.grantable.length ? (
          <details className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm">
            <summary className="cursor-pointer select-none font-medium text-slate-200">Additional permissions ({form.grants.length}) <span className="font-normal text-slate-500">— explicit exceptions on top of the role</span></summary>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {groups.map((group) => (
                <div key={group}>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{group}</p>
                  {props.grantable.filter((grant) => grant.group === group).map((grant) => (
                    <label key={grant.key} className="mt-1 flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-green-700"
                        checked={form.grants.includes(grant.key)}
                        onChange={(event) => setForm((current) => ({ ...current, grants: event.target.checked ? [...current.grants, grant.key] : current.grants.filter((value) => value !== grant.key) }))}
                      />
                      {grant.label}
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">You can only grant permissions you hold. Central-only permissions are blocked for outlet staff by the server.</p>
          </details>
        ) : null}

        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <ActionButton tone="secondary" onClick={props.onClose}>Cancel</ActionButton>
          <ActionButton disabled={busy || form.name.trim().length < 3 || !form.email.includes("@") || (scoped && form.outletIds.length === 0)} onClick={() => void submit()}>
            {mode === "add" ? (form.credentialMode === "invite" ? "Create & invite" : "Create account") : "Save changes"}
          </ActionButton>
        </div>
      </div>
    </Modal>
  );
}

function StatusModal({ user, status, onClose }: { user: StaffRow; status: "SUSPENDED" | "DEACTIVATED" | "ACTIVE"; onClose: () => void }) {
  const { run, error, busy } = useAction();
  const [reason, setReason] = useState("");
  const copy = {
    SUSPENDED: { title: `Suspend ${user.name}`, body: "They are signed out on their next request and cannot sign in until reactivated.", button: "Suspend account" },
    DEACTIVATED: { title: `Deactivate ${user.name}`, body: "Use when someone leaves. The account and its history are kept, but it cannot be used. Only a Super Administrator can reactivate it.", button: "Deactivate account" },
    ACTIVE: { title: `Reactivate ${user.name}`, body: "The user can sign in again with their existing password.", button: "Reactivate" },
  }[status];
  return (
    <Modal open title={copy.title} description={copy.body} onClose={onClose}>
      <div className="grid gap-3">
        <Field label={status === "ACTIVE" ? "Note (optional)" : "Reason (required)"}>
          <TextInput value={reason} onChange={(event) => setReason(event.target.value)} placeholder={status === "DEACTIVATED" ? "e.g. Resigned 31 Oct 2026" : status === "SUSPENDED" ? "e.g. Under investigation — till variance" : ""} />
        </Field>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <ActionButton tone="secondary" onClick={onClose}>Cancel</ActionButton>
          <ActionButton tone={status === "ACTIVE" ? "primary" : "danger"} disabled={busy || (status !== "ACTIVE" && reason.trim().length < 3)} onClick={async () => (await run(`/api/users/${user.id}`, "PATCH", { action: "status", status, reason })) && onClose()}>
            {copy.button}
          </ActionButton>
        </div>
      </div>
    </Modal>
  );
}

function CredentialModal({ credential, onClose }: { credential: CredentialResult; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const link = credential.invitePath ? `${window.location.origin}${credential.invitePath}` : null;
  const text = link
    ? `Welcome to Pharmacy ERP, ${credential.user.name}.\nActivate your account and set a password: ${link}\nStaff ID: ${credential.user.staffId}`
    : `Pharmacy ERP sign-in\nEmail: ${credential.user.email}\nStaff ID: ${credential.user.staffId}${credential.temporaryPassword ? `\nTemporary password: ${credential.temporaryPassword}` : ""}`;
  return (
    <Modal
      open
      title={link ? "Invitation ready" : credential.temporaryPassword ? "Temporary password" : "Account created"}
      description={link ? "Email is not configured, so share this link with the user privately. It works once and expires." : credential.temporaryPassword ? "Shown once. Share it privately." : "The user can sign in with the password you set."}
      onClose={onClose}
    >
      <div className="grid gap-3 text-sm">
        <dl className="grid grid-cols-[110px_1fr] gap-y-2 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <dt className="text-slate-400">User</dt><dd className="text-white">{credential.user.name}</dd>
          <dt className="text-slate-400">Email</dt><dd>{credential.user.email}</dd>
          <dt className="text-slate-400">Staff ID</dt><dd className="font-mono">{credential.user.staffId}</dd>
          {credential.temporaryPassword ? (<><dt className="text-slate-400">Password</dt><dd className="font-mono text-base font-semibold text-emerald-300">{credential.temporaryPassword}</dd></>) : null}
          {link ? (<><dt className="text-slate-400">Invite link</dt><dd className="break-all font-mono text-xs text-emerald-300">{link}</dd></>) : null}
        </dl>
        <div className="flex justify-end gap-2">
          <ActionButton tone="secondary" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); } }}>
            <Copy className="h-4 w-4" /> {copied ? "Copied" : "Copy message"}
          </ActionButton>
          <ActionButton onClick={onClose}><ShieldCheck className="h-4 w-4" /> Done</ActionButton>
        </div>
      </div>
    </Modal>
  );
}

type ImpersonationRow = { id: string; adminName: string; targetName: string; targetRole: string; targetStaffId?: string; reason: string; startedAt: string; endedAt?: string; endReason?: string; actions: number };

function SwitchUserModal({
  users,
  initial,
  roleLabel,
  outletLabel,
  maxMinutes,
  onClose,
}: {
  users: StaffRow[];
  initial: StaffRow | null;
  roleLabel: (role: string) => string;
  outletLabel: (id: string) => string;
  maxMinutes: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const { update } = useSession();
  const [target, setTarget] = useState<StaffRow | null>(initial);
  const [query, setQuery] = useState("");
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needle = query.trim().toLowerCase();
  const matches = users.filter((user) => !needle || `${user.name} ${user.email} ${user.staffId} ${user.outletIds.map(outletLabel).join(" ")}`.toLowerCase().includes(needle)).slice(0, 12);

  async function start() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/impersonation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetUserId: target.id, password, reason }) });
      const payload = (await response.json().catch(() => ({}))) as { sessionId?: string; error?: string };
      if (!response.ok || !payload.sessionId) throw new Error(payload.error ?? "Could not switch user.");
      const session = await update({ impersonate: payload.sessionId });
      if (session?.user.impersonation?.sessionId !== payload.sessionId) throw new Error("The server did not accept the switch. Try again.");
      router.push("/dashboard");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not switch user.");
      setBusy(false);
    }
  }

  return (
    <Modal open title="Switch user" description={`Act as another user with exactly their role, outlets and permissions, for up to ${maxMinutes} minutes. Their password is never shown or changed.`} onClose={onClose} wide>
      {!target ? (
        <div className="grid gap-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <TextInput autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, staff ID or outlet…" className="pl-9" />
          </label>
          <ul className="max-h-80 divide-y divide-slate-800 overflow-y-auto rounded-xl border border-slate-800">
            {matches.length === 0 ? <li className="px-4 py-6 text-center text-sm text-slate-500">No active users match.</li> : null}
            {matches.map((user) => (
              <li key={user.id}>
                <button type="button" onClick={() => setTarget(user)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-800/40">
                  <span>
                    <span className="block text-white">{user.name} <span className="font-mono text-xs text-slate-500">{user.staffId}</span></span>
                    <span className="block text-[11px] text-slate-500">{user.email} · {roleLabel(user.role)} · {user.outletIds.map(outletLabel).join(", ") || "All outlets"}</span>
                  </span>
                  <UserCog className="h-4 w-4 text-slate-500" />
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500">Super Administrator accounts and inactive accounts cannot be impersonated.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="rounded-xl border border-amber-400/60 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            You will act as <strong>{target.name}</strong> ({roleLabel(target.role)} · {target.outletIds.map(outletLabel).join(", ") || "all outlets"}). You will only be able to do what they can do. A banner stays visible and every action is recorded under your name too.
          </div>
          <Field label="Reason (recorded in the audit trail)"><TextInput value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Reproducing a POS issue reported by the cashier" /></Field>
          <Field label="Confirm your password"><TextInput type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
          <FormError message={error} />
          <div className="flex justify-between gap-2">
            <ActionButton tone="ghost" onClick={() => setTarget(null)} disabled={busy}>Choose someone else</ActionButton>
            <div className="flex gap-2">
              <ActionButton tone="secondary" onClick={onClose}>Cancel</ActionButton>
              <ActionButton disabled={busy || !password || reason.trim().length < 5} onClick={() => void start()}>
                <UserCog className="h-4 w-4" /> {busy ? "Switching…" : `Switch to ${target.name.split(" ")[0]}`}
              </ActionButton>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
