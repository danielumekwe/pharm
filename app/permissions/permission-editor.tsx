"use client";

import { Check, History, Lock, RotateCcw, ShieldAlert, ShieldCheck, Undo2, UserSearch } from "lucide-react";
import { useMemo, useState } from "react";

import { ActionButton, Field, FormError, SelectInput, TextInput } from "@/components/erp/fields";
import { Modal } from "@/components/erp/modal";
import { PageHeader } from "@/components/erp/page-header";
import { Panel } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { useAction } from "@/components/erp/use-action";
import { dateTime } from "@/lib/format";

type RoleInfo = { value: string; label: string; description: string; scoped: boolean; activeUsers: number };
type PermissionInfo = { key: string; label: string; group: string; sensitive: boolean; locked: boolean; centralOnly: boolean; superAdminOnly: boolean };
type Person = { id: string; name: string; staffId: string; role: string; grants: string[]; status: string };
type Change = { role: string; permission: string; granted: boolean };

export function PermissionEditor({
  roles,
  permissions,
  matrix,
  defaults,
  people,
  history,
  editable,
}: {
  roles: RoleInfo[];
  permissions: PermissionInfo[];
  matrix: Record<string, string[]>;
  defaults: Record<string, string[]>;
  people: Person[];
  history: { id: string; at: string; actor: string; summary: string }[];
  editable: boolean;
}) {
  const [draft, setDraft] = useState<Record<string, string[]>>(() => structuredClone(matrix));
  const [reviewing, setReviewing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const groups = Array.from(new Set(permissions.map((permission) => permission.group)));
  const roleOf = (value: string) => roles.find((role) => role.value === value)!;
  const permissionOf = (key: string) => permissions.find((permission) => permission.key === key)!;

  const changes: Change[] = useMemo(() => {
    const list: Change[] = [];
    for (const role of roles) {
      for (const permission of permissions) {
        const before = matrix[role.value].includes(permission.key);
        const after = draft[role.value].includes(permission.key);
        if (before !== after) list.push({ role: role.value, permission: permission.key, granted: after });
      }
    }
    return list;
  }, [draft, matrix, roles, permissions]);

  /** Why a cell cannot be changed, or null if it can. */
  function lockReason(role: RoleInfo, permission: PermissionInfo) {
    if (!editable) return "Only the Pharmacy Super Admin can change permissions";
    if (role.value === "SUPER_ADMIN") return "Pharmacy Super Admin always has full access";
    if (permission.locked) return "Required by every role";
    if (permission.superAdminOnly) return "Reserved for the Pharmacy Super Admin";
    if (role.scoped && permission.centralOnly) return "Central permission — not allowed for outlet roles";
    return null;
  }

  function toggle(role: string, permission: string) {
    setDraft((current) => {
      const has = current[role].includes(permission);
      return { ...current, [role]: has ? current[role].filter((item) => item !== permission) : [...current[role], permission] };
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Roles & permissions"
        description="Review what each role can do. Changes are checked against safety rules on the server, require a reason, and are recorded in the audit trail. Individual exceptions are granted per user on the Staff page."
        actions={
          editable ? (
            <ActionButton tone="secondary" onClick={() => setResetting(true)}>
              <RotateCcw className="h-4 w-4" /> Reset a role
            </ActionButton>
          ) : (
            <StatusBadge status="Read-only" tone="slate" />
          )
        }
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {roles.map((role) => {
          const differs = [...new Set([...matrix[role.value], ...defaults[role.value]])].some((key) => matrix[role.value].includes(key) !== defaults[role.value].includes(key));
          return (
            <div key={role.value} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-white">{role.label}</p>
                <StatusBadge status={role.scoped ? "Outlet" : "All outlets"} tone={role.scoped ? "sky" : "emerald"} />
              </div>
              <p className="mt-1 text-xs text-slate-400">{role.description}</p>
              <p className="mt-3 text-xs text-slate-500">
                {draft[role.value].length} permissions · {role.activeUsers} active user{role.activeUsers === 1 ? "" : "s"}
                {differs ? <span className="ml-2 text-amber-300">customised</span> : null}
              </p>
            </div>
          );
        })}
      </div>

      <Panel title="Permission matrix" description="Shaded locks show combinations that are not allowed. A dot marks a value that differs from the default.">
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="sticky top-0 bg-slate-950 text-[11px] uppercase tracking-[0.1em] text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">Permission</th>
                {roles.map((role) => (
                  <th key={role.value} className="w-28 px-2 py-2 text-center">{role.label.replace(" Officer", "").replace("Inventory / ", "")}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <FragmentGroup key={group} label={group} colSpan={roles.length + 1}>
                  {permissions.filter((permission) => permission.group === group).map((permission) => (
                    <tr key={permission.key} className="border-t border-slate-800/80 hover:bg-slate-800/30">
                      <td className="px-3 py-2">
                        <p className="text-slate-200">
                          {permission.label}
                          {permission.sensitive ? <span className="ml-2 rounded bg-rose-500/15 px-1 text-[10px] font-semibold text-rose-300">SENSITIVE</span> : null}
                          {permission.superAdminOnly ? <span className="ml-1 rounded bg-slate-700/40 px-1 text-[10px] text-slate-300">SUPER ADMIN</span> : permission.centralOnly ? <span className="ml-1 rounded bg-sky-500/15 px-1 text-[10px] text-sky-300">CENTRAL</span> : null}
                        </p>
                        <p className="font-mono text-[10px] text-slate-500">{permission.key}</p>
                      </td>
                      {roles.map((role) => {
                        const reason = lockReason(role, permission);
                        const on = draft[role.value].includes(permission.key);
                        const changed = on !== matrix[role.value].includes(permission.key);
                        const custom = matrix[role.value].includes(permission.key) !== defaults[role.value].includes(permission.key);
                        return (
                          <td key={role.value} className="px-2 py-1.5 text-center">
                            <button
                              type="button"
                              title={reason ?? `${on ? "Revoke" : "Grant"} “${permission.label}” ${on ? "from" : "to"} ${role.label}`}
                              disabled={Boolean(reason)}
                              onClick={() => toggle(role.value, permission.key)}
                              className={`relative mx-auto flex h-7 w-7 items-center justify-center rounded-md border transition ${
                                on ? "border-green-700 bg-green-700 text-white" : "border-slate-700 bg-slate-900 text-transparent"
                              } ${reason ? "cursor-not-allowed opacity-50" : "hover:border-green-600"} ${changed ? "ring-2 ring-amber-400 ring-offset-1" : ""}`}
                            >
                              {reason && !on ? <Lock className="h-3 w-3 text-slate-500" /> : <Check className="h-4 w-4" />}
                              {custom && !changed ? <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-400" /> : null}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </FragmentGroup>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {editable && changes.length ? (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/60 bg-amber-50 px-5 py-3 text-sm text-amber-900 shadow-lg">
          <p className="flex items-center gap-2"><ShieldAlert className="h-4 w-4" />{changes.length} unsaved change{changes.length > 1 ? "s" : ""}</p>
          <div className="flex gap-2">
            <ActionButton tone="secondary" onClick={() => setDraft(structuredClone(matrix))}><Undo2 className="h-4 w-4" /> Discard</ActionButton>
            <ActionButton onClick={() => setReviewing(true)}>Review & apply</ActionButton>
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        <AccessChecker people={people} roles={roles} permissions={permissions} matrix={matrix} />
        <Panel title="Permission change history" description="From the audit trail">
          {history.length === 0 ? (
            <p className="text-sm text-slate-500">No permission changes recorded yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {history.map((event) => (
                <li key={event.id} className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                  <p className="text-slate-200">{event.summary}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500"><History className="h-3 w-3" />{dateTime(event.at)} · {event.actor}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {reviewing ? (
        <ReviewModal
          changes={changes}
          roleOf={roleOf}
          permissionOf={permissionOf}
          onClose={() => setReviewing(false)}
          onApplied={() => setReviewing(false)}
        />
      ) : null}
      {resetting ? <ResetModal roles={roles.filter((role) => role.value !== "SUPER_ADMIN")} onClose={() => setResetting(false)} onDone={() => setResetting(false)} /> : null}
    </div>
  );
}

function FragmentGroup({ label, colSpan, children }: { label: string; colSpan: number; children: React.ReactNode }) {
  return (
    <>
      <tr className="bg-slate-950/80">
        <td colSpan={colSpan} className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300">{label}</td>
      </tr>
      {children}
    </>
  );
}

function ReviewModal({
  changes,
  roleOf,
  permissionOf,
  onClose,
  onApplied,
}: {
  changes: Change[];
  roleOf: (value: string) => RoleInfo;
  permissionOf: (key: string) => PermissionInfo;
  onClose: () => void;
  onApplied: () => void;
}) {
  const { run, error, busy } = useAction();
  const [reason, setReason] = useState("");
  const affectedRoles = Array.from(new Set(changes.map((change) => change.role)));
  const affectedUsers = affectedRoles.reduce((sum, role) => sum + roleOf(role).activeUsers, 0);
  const sensitive = changes.filter((change) => change.granted && permissionOf(change.permission).sensitive);

  return (
    <Modal open title="Review permission changes" description={`Affects ${affectedRoles.length} role(s) and ${affectedUsers} active user(s) immediately.`} onClose={onClose} wide>
      <div className="grid gap-4 text-sm">
        <ul className="max-h-72 space-y-1.5 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          {changes.map((change) => (
            <li key={`${change.role}-${change.permission}`} className="flex items-center gap-2">
              <span className={`w-14 shrink-0 rounded px-1.5 py-0.5 text-center text-[11px] font-semibold ${change.granted ? "bg-green-700 text-white" : "bg-rose-500/15 text-rose-300"}`}>{change.granted ? "GRANT" : "REVOKE"}</span>
              <span className="text-white">{permissionOf(change.permission).label}</span>
              <span className="text-slate-500">{change.granted ? "to" : "from"}</span>
              <span>{roleOf(change.role).label}</span>
              {permissionOf(change.permission).sensitive ? <span className="text-[11px] text-rose-300">sensitive</span> : null}
            </li>
          ))}
        </ul>
        {sensitive.length ? (
          <p className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-rose-200">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> You are granting {sensitive.length} sensitive permission(s). Confirm this follows your access-control policy.
          </p>
        ) : null}
        <Field label="Reason for change (recorded in audit trail)">
          <TextInput value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Sales managers now approve outlet expenses per Nov 2026 policy" />
        </Field>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <ActionButton tone="secondary" onClick={onClose}>Back</ActionButton>
          <ActionButton disabled={busy || reason.trim().length < 10} onClick={async () => (await run("/api/permissions", "POST", { action: "apply", changes, reason })) && onApplied()}>
            <ShieldCheck className="h-4 w-4" /> Apply {changes.length} change{changes.length > 1 ? "s" : ""}
          </ActionButton>
        </div>
      </div>
    </Modal>
  );
}

function ResetModal({ roles, onClose, onDone }: { roles: RoleInfo[]; onClose: () => void; onDone: () => void }) {
  const { run, error, busy } = useAction();
  const [role, setRole] = useState(roles[0]?.value ?? "");
  const [reason, setReason] = useState("");
  return (
    <Modal open title="Reset role to defaults" description="Restores the shipped permission set for one role. Individual user grants are not affected." onClose={onClose}>
      <div className="grid gap-3">
        <Field label="Role"><SelectInput value={role} onChange={(event) => setRole(event.target.value)} options={roles.map((row) => ({ value: row.value, label: row.label }))} /></Field>
        <Field label="Reason"><TextInput value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <ActionButton tone="secondary" onClick={onClose}>Cancel</ActionButton>
          <ActionButton tone="danger" disabled={busy || reason.trim().length < 10} onClick={async () => (await run("/api/permissions", "POST", { action: "reset", role, reason })) && onDone()}>Reset role</ActionButton>
        </div>
      </div>
    </Modal>
  );
}

function AccessChecker({ people, roles, permissions, matrix }: { people: Person[]; roles: RoleInfo[]; permissions: PermissionInfo[]; matrix: Record<string, string[]> }) {
  const [personId, setPersonId] = useState(people[0]?.id ?? "");
  const person = people.find((row) => row.id === personId);
  const fromRole = person ? matrix[person.role] ?? [] : [];
  const groups = Array.from(new Set(permissions.map((permission) => permission.group)));
  return (
    <Panel title="Effective access checker" description="Everything a person can do: role permissions plus individual grants.">
      <Field label="Staff member">
        <SelectInput value={personId} onChange={(event) => setPersonId(event.target.value)} options={people.map((row) => ({ value: row.id, label: `${row.name} (${row.staffId}) — ${roles.find((role) => role.value === row.role)?.label}` }))} />
      </Field>
      {person ? (
        <div className="mt-4 space-y-3 text-sm">
          {person.status !== "ACTIVE" ? <p className="text-amber-300">Account is {person.status.toLowerCase()} — no access until active.</p> : null}
          {groups.map((group) => {
            const items = permissions.filter((permission) => permission.group === group && (fromRole.includes(permission.key) || person.grants.includes(permission.key)));
            if (!items.length) return null;
            return (
              <div key={group}>
                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{group}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {items.map((permission) => (
                    <span key={permission.key} className={`rounded-md border px-2 py-0.5 text-xs ${fromRole.includes(permission.key) ? "border-slate-700 text-slate-300" : "border-sky-500/40 bg-sky-500/10 text-sky-300"}`}>
                      {permission.label}{fromRole.includes(permission.key) ? "" : " · grant"}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
          <p className="flex items-center gap-1 text-[11px] text-slate-500"><UserSearch className="h-3 w-3" />Blue entries are individual grants.</p>
        </div>
      ) : null}
    </Panel>
  );
}
