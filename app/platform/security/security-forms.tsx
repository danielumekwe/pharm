"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field, inputClass, Notice } from "@/components/auth-card";

type Message = { tone: "success" | "error"; text: string } | null;
const button = "rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60";

async function post(url: string, method: string, body?: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Something went wrong.");
  return result;
}

export function ChangePassword() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [message, setMessage] = useState<Message>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (next !== again) return setMessage({ tone: "error", text: "The new passwords do not match." });
    try {
      await post("/api/platform/me/password", "POST", { current, next });
      setMessage({ tone: "success", text: "Password changed. Your other sessions have been signed out." });
      setCurrent(""); setNext(""); setAgain("");
      router.refresh();
    } catch (error) {
      setMessage({ tone: "error", text: (error as Error).message });
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3" data-change-password>
      <h2 className="font-semibold">Password</h2>
      <Field label="Current password"><input type="password" required autoComplete="current-password" className={inputClass} value={current} onChange={(event) => setCurrent(event.target.value)} /></Field>
      <Field label="New password" hint="At least 12 characters, with letters and a number."><input type="password" required autoComplete="new-password" className={inputClass} value={next} onChange={(event) => setNext(event.target.value)} /></Field>
      <Field label="New password again"><input type="password" required autoComplete="new-password" className={inputClass} value={again} onChange={(event) => setAgain(event.target.value)} /></Field>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <button type="submit" className={`${button} bg-green-700 text-white hover:bg-green-800`}>Change password</button>
    </form>
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm" data-recovery-codes>
      <p className="font-semibold text-amber-900">Your recovery codes — save them now</p>
      <p className="text-amber-900">Each one signs you in once if you lose your phone. They will not be shown again.</p>
      <ul className="mt-2 grid grid-cols-2 gap-1 font-mono">{codes.map((code) => <li key={code}>{code}</li>)}</ul>
    </div>
  );
}

export function TwoFactor({ enabled, enabledAt, recoveryCodesLeft, required, available }: { enabled: boolean; enabledAt: string | null; recoveryCodesLeft: number; required: boolean; available: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  async function run(body: Record<string, string>, after: (result: Record<string, unknown>) => void) {
    setBusy(true);
    setMessage(null);
    try {
      after(await post("/api/platform/me/two-factor", "POST", body));
    } catch (error) {
      setMessage({ tone: "error", text: (error as Error).message });
    }
    setBusy(false);
    setCode("");
    setPassword("");
  }
  return (
    <div className="space-y-3" data-two-factor={enabled ? "on" : "off"}>
      <h2 className="font-semibold">Two-factor sign-in</h2>
      {codes ? <RecoveryCodes codes={codes} /> : null}
      {enabled ? (
        <>
          <p className="text-sm text-slate-700">On since {enabledAt?.slice(0, 10)}. Signing in needs your password and a code from your authenticator app. {recoveryCodesLeft} recovery code(s) left.</p>
          <Field label="Password"><input type="password" autoComplete="current-password" className={inputClass} value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
          <Field label="Code from your app"><input inputMode="numeric" autoComplete="one-time-code" className={inputClass} value={code} onChange={(event) => setCode(event.target.value)} /></Field>
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void run({ action: "recovery-codes", password, code }, (result) => { setCodes(result.recoveryCodes as string[]); router.refresh(); })} className={`${button} border border-slate-300 hover:bg-slate-50`}>New recovery codes</button>
            <button type="button" disabled={busy || required} title={required ? "Required by the security policy" : undefined} onClick={() => void run({ action: "disable", password, code }, () => { setMessage({ tone: "success", text: "Two-factor sign-in is off." }); router.refresh(); })} className={`${button} border border-rose-300 text-rose-700 hover:bg-rose-50`}>Turn off</button>
          </div>
        </>
      ) : setup ? (
        <>
          <p className="text-sm text-slate-700">Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…), then enter the code it shows.</p>
          <div className="w-52 rounded-lg border border-slate-200 bg-white p-2" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
          <p className="text-xs text-slate-600">Can&apos;t scan? Enter this key in the app: <code className="break-all rounded bg-slate-100 px-1" data-totp-secret>{setup.secret}</code></p>
          <Field label="Code from your app"><input inputMode="numeric" autoComplete="one-time-code" className={inputClass} value={code} onChange={(event) => setCode(event.target.value)} /></Field>
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
          <button type="button" disabled={busy} onClick={() => void run({ action: "confirm", code }, (result) => { setSetup(null); setCodes(result.recoveryCodes as string[]); router.refresh(); })} className={`${button} bg-green-700 text-white hover:bg-green-800`}>Turn on</button>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-700">Off. With it on, a stolen password alone cannot open the Control Centre.{required ? " The security policy requires it." : ""}</p>
          {!available ? <Notice tone="error">Secret storage is not set up on this server (SETTINGS_ENCRYPTION_KEY), so two-factor sign-in cannot be turned on yet.</Notice> : null}
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
          <button type="button" disabled={busy || !available} onClick={() => void run({ action: "begin" }, (result) => setSetup({ secret: result.secret as string, qrSvg: result.qrSvg as string }))} className={`${button} bg-slate-900 text-white`}>Set up two-factor sign-in</button>
        </>
      )}
    </div>
  );
}

type Session = { id: string; user: string; email: string; createdAt: string; lastSeenAt: string; ip: string | null; userAgent: string | null; twoFactor: boolean };

const device = (agent: string | null) => {
  if (!agent) return "Unknown device";
  const browser = /Edg\//.test(agent) ? "Edge" : /Chrome\//.test(agent) ? "Chrome" : /Firefox\//.test(agent) ? "Firefox" : /Safari\//.test(agent) ? "Safari" : "Browser";
  const system = /Windows/.test(agent) ? "Windows" : /Android/.test(agent) ? "Android" : /iPhone|iPad/.test(agent) ? "iOS" : /Mac OS/.test(agent) ? "macOS" : /Linux/.test(agent) ? "Linux" : "";
  return [browser, system].filter(Boolean).join(" on ");
};

export function SessionList({ sessions, currentId, showUser }: { sessions: Session[]; currentId: string | null; showUser: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const time = (value: string) => value.replace("T", " ").slice(0, 16);
  async function end(id: string) {
    setError(null);
    try {
      await post(`/api/platform/sessions/${encodeURIComponent(id)}`, "DELETE");
      if (id === currentId) router.push("/platform/login");
      router.refresh();
    } catch (failure) {
      setError((failure as Error).message);
    }
  }
  return (
    <div className="mt-2 overflow-x-auto">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <table className="w-full text-sm" data-sessions>
        <thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr>{showUser ? <th className="py-1">Person</th> : null}<th className="py-1">Device</th><th>Address</th><th>Signed in (UTC)</th><th>Last active</th><th>Two-factor</th><th /></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {sessions.length === 0 ? <tr><td colSpan={7} className="py-2 text-slate-500">No active sessions.</td></tr> : sessions.map((session) => (
            <tr key={session.id} data-session={session.id}>
              {showUser ? <td className="py-1.5">{session.user}<span className="block text-xs text-slate-500">{session.email}</span></td> : null}
              <td className="py-1.5">{device(session.userAgent)}{session.id === currentId ? <span className="ml-1 rounded bg-green-100 px-1.5 text-xs text-green-800">this device</span> : null}</td>
              <td className="font-mono text-xs">{session.ip ?? "—"}</td>
              <td>{time(session.createdAt)}</td>
              <td>{time(session.lastSeenAt)}</td>
              <td>{session.twoFactor ? "yes" : "no"}</td>
              <td><button type="button" onClick={() => void end(session.id)} className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50">{session.id === currentId ? "Sign out" : "End session"}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
