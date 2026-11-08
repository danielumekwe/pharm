import { PlatformShell } from "@/components/platform/platform-shell";
import { requirePlatformPage } from "@/lib/platform/pages";
import { activeSessions } from "@/lib/platform/security";
import { describePlatformSetting } from "@/lib/platform/settings";
import { clientAddress } from "@/lib/saas/rate-limit";

import { SessionList } from "../../security/security-forms";
import { SecurityPolicyForm } from "./security-policy-form";

export const metadata = { title: "Security policy · Web365 platform" };

export default async function SecurityPolicyPage() {
  const actor = await requirePlatformPage("staff.manage");
  const [setting, sessions, address] = await Promise.all([describePlatformSetting("security.policy"), activeSessions(), clientAddress()]);
  const time = (value: string) => value.replace("T", " ").slice(0, 16);
  return (
    <PlatformShell actor={actor}>
      <h1 className="text-2xl font-bold">Security policy</h1>
      <p className="text-sm text-slate-600">How Web365 staff sign in to the Control Centre. Changes apply at once to everyone.</p>
      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5"><SecurityPolicyForm value={setting.value} address={address} /></section>
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Everyone signed in now ({sessions.length})</h2>
        <SessionList sessions={sessions} currentId={actor.sessionId ?? null} showUser />
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
