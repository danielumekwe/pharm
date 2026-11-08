import { PlatformShell } from "@/components/platform/platform-shell";
import { requirePlatformPage } from "@/lib/platform/pages";
import { activeSessions, securityPolicy, twoFactorStatus } from "@/lib/platform/security";
import { secretsAvailable } from "@/lib/platform/secrets";

import { ChangePassword, SessionList, TwoFactor } from "./security-forms";

export const metadata = { title: "My security · Web365 platform" };

/** Each staff member's own security: password, two-factor sign-in and sessions. Reachable while setup is due. */
export default async function MySecurityPage() {
  const actor = await requirePlatformPage("self");
  const [status, sessions, policy] = await Promise.all([twoFactorStatus(actor.id), activeSessions(actor.id), securityPolicy()]);
  return (
    <PlatformShell actor={actor}>
      <h1 className="text-2xl font-bold">My security</h1>
      {actor.pending === "change_password" ? <p role="alert" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-pending="change_password">Your account was created with a temporary password. Choose your own password to continue.</p> : null}
      {actor.pending === "two_factor_setup" ? <p role="alert" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-pending="two_factor_setup">Web365 requires two-factor sign-in for platform staff. Set it up below to continue.</p> : null}
      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5"><ChangePassword /></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <TwoFactor enabled={status.enabled} enabledAt={status.enabledAt} recoveryCodesLeft={status.recoveryCodesLeft} required={policy.requireTwoFactor} available={secretsAvailable()} />
        </div>
      </section>
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Where you are signed in</h2>
        <p className="text-sm text-slate-600">Sessions end after {policy.sessionHours} hours, or {policy.idleMinutes} minutes without activity.</p>
        <SessionList sessions={sessions} currentId={actor.sessionId ?? null} showUser={false} />
      </section>
    </PlatformShell>
  );
}
