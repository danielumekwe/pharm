import { PlatformShell } from "@/components/platform/platform-shell";
import { requirePlatformPage } from "@/lib/platform/pages";
import { describePlatformSetting } from "@/lib/platform/settings";
import { backupHistory, jobHistory, systemInfo } from "@/lib/platform/system";

import { BackupNote, RunJob, SystemForm } from "./system-form";

export const metadata = { title: "System · Web365 platform" };

const size = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`);
const daysSince = (iso: string) => (Date.now() - Date.parse(iso)) / 86_400_000;
const time = (value: string | null) => (value ? value.replace("T", " ").slice(0, 16) : "—");

export default async function SystemPage() {
  const actor = await requirePlatformPage("settings.manage");
  const [setting, info, jobs, backups] = await Promise.all([describePlatformSetting("system.config"), systemInfo(), jobHistory(), backupHistory()]);
  const lastBackup = backups[0];
  const backupAgeDays = lastBackup ? daysSince(lastBackup.taken_at) : null;
  const latest = (job: string) => jobs.find((run) => run.job === job);
  return (
    <PlatformShell actor={actor}>
      <h1 className="text-2xl font-bold">System</h1>
      <p className="text-sm text-slate-600">Maintenance, registration, features, uploads and background jobs for the whole platform. Changes apply at once.</p>
      {setting.value.maintenance ? <p role="alert" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-maintenance-on>Maintenance mode is ON: pharmacies cannot sign in or use the system. The Control Centre keeps working.</p> : null}

      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5"><SystemForm value={JSON.parse(JSON.stringify(setting.value))} /></section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm" data-system-info>
          <h2 className="font-semibold">Version and health</h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
            <dt className="text-slate-500">Version</dt><dd>{info.version}{info.commit ? ` (${info.commit})` : ""}</dd>
            <dt className="text-slate-500">Environment</dt><dd>{info.environment}</dd>
            <dt className="text-slate-500">Runtime</dt><dd>{info.runtime}</dd>
            <dt className="text-slate-500">This server started</dt><dd>{time(info.startedAt)} UTC</dd>
            <dt className="text-slate-500">Database</dt><dd>PostgreSQL {info.database.version}</dd>
            <dt className="text-slate-500">Database size</dt><dd data-database-size>{size(info.database.sizeBytes)}</dd>
            <dt className="text-slate-500">Latest migration</dt><dd className="break-all font-mono text-xs">{info.latestMigration ?? "—"}</dd>
          </dl>
          <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Largest tables</h3>
          <ul className="mt-1 grid grid-cols-2 gap-x-4 text-xs">{info.tables.map((table) => <li key={table.name} className="flex justify-between"><span className="font-mono">{table.name}</span><span>{size(table.bytes)}</span></li>)}</ul>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm" data-backups>
          <h2 className="font-semibold">Backups</h2>
          <p className={`mt-1 ${backupAgeDays === null || backupAgeDays > 7 ? "text-amber-800" : "text-slate-700"}`}>
            {lastBackup ? `Last backup ${time(lastBackup.taken_at)} UTC (${backupAgeDays! < 1 ? "today" : `${Math.floor(backupAgeDays!)} day(s) ago`}).` : "No backup recorded yet."}
            {backupAgeDays === null || backupAgeDays > 7 ? " Take one before the next deployment." : ""}
          </p>
          <p className="mt-1 text-xs text-slate-500">Backups are taken with <code>npm run db:backup</code> (recorded here automatically) or at the database host (note them below). Neon also keeps its own restore history.</p>
          <ul className="mt-2 divide-y divide-slate-100">
            {backups.slice(0, 10).map((backup) => (
              <li key={backup.id} className="py-1.5"><span className="font-medium">{backup.label}</span> · {time(backup.taken_at)} UTC · {backup.kind === "script" ? `${backup.tables} tables, ${backup.rows?.toLocaleString()} rows, ${backup.size_bytes ? size(backup.size_bytes) : "?"}` : "at the host"}<span className="block text-xs text-slate-500">{backup.recorded_by}{backup.location ? ` · ${backup.location}` : ""}{backup.note ? ` · ${backup.note}` : ""}</span></li>
            ))}
          </ul>
          <BackupNote />
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Background jobs</h2>
          <div className="flex gap-2"><RunJob job="alert-jobs" label="Run alert jobs now" /><RunJob job="email-queue" label="Run email queue now" /></div>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Alert jobs: last {latest("alert-jobs") ? `${time(latest("alert-jobs")!.started_at)} UTC (${latest("alert-jobs")!.trigger})` : "never"} · Email queue: last {latest("email-queue") ? `${time(latest("email-queue")!.started_at)} UTC (${latest("email-queue")!.trigger})` : "never"}
        </p>
        <table className="mt-2 w-full text-sm" data-job-runs>
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1">Started (UTC)</th><th>Job</th><th>Trigger</th><th>Took</th><th>Pharmacies</th><th>Result</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {jobs.length === 0 ? <tr><td colSpan={6} className="py-2 text-slate-500">No runs recorded yet.</td></tr> : jobs.slice(0, 30).map((run) => (
              <tr key={run.id} data-job-run={run.job}>
                <td className="py-1.5">{time(run.started_at)}</td><td>{run.job}</td><td>{run.trigger}</td>
                <td>{run.finished_at ? `${Math.max(0, Math.round((Date.parse(run.finished_at) - Date.parse(run.started_at)) / 1000))} s` : <span className="text-amber-700">not finished</span>}</td>
                <td>{run.pharmacies}</td>
                <td className={run.failed ? "text-rose-700" : ""}>{run.failed ? `${run.failed} failed. ` : ""}{run.detail ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Change history</h2>
        <ul className="mt-2 divide-y divide-slate-100 text-sm" data-settings-history>
          {setting.history.length === 0 ? <li className="py-2 text-slate-500">Defaults in use (never changed).</li> : setting.history.map((entry, index) => (
            <li key={index} className="py-2"><span className="text-slate-500">{time(entry.at)} UTC · {entry.by}</span><span className="block">{entry.changes.join("; ")}</span></li>
          ))}
        </ul>
      </section>
    </PlatformShell>
  );
}
