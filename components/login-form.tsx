"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Check, ChevronDown, Eye, EyeOff, Loader2, LockKeyhole, LogIn, Mail, QrCode, Store } from "lucide-react";

import { BrandMark } from "@/components/brand-logo";
import { PharmacyIllustration } from "@/components/pharmacy-illustration";

const HEAD_OFFICE = "HQ";
const REMEMBER_KEY = "pharmerp.remembered-login";


const demoAccounts = [
  { role: "Super Administrator", email: "admin@web365.ng", outletId: HEAD_OFFICE },
  { role: "Pharmacy Manager", email: "manager@web365.ng", outletId: HEAD_OFFICE },
  { role: "Regulatory Affairs", email: "regulatory@web365.ng", outletId: HEAD_OFFICE },
  { role: "Sales Manager · Lekki", email: "outlet@web365.ng", outletId: "outlet-1" },
  { role: "Stock Manager · Ikeja + Warehouse", email: "store@web365.ng", outletId: "outlet-2" },
  { role: "Staff · Lekki", email: "cashier@web365.ng", outletId: "outlet-1" },
  { role: "Relief Staff · Lekki + VI", email: "relief@web365.ng", outletId: "outlet-3" },
];

const fieldShell =
  "flex h-12 items-center gap-3 rounded-xl border border-slate-300 bg-white px-4 text-slate-800 transition focus-within:border-green-600 focus-within:ring-2 focus-within:ring-green-600/15";

type Remembered = { identifier: string; outletId: string; mode: "email" | "staff" };

function readRemembered(): string {
  try {
    return window.localStorage.getItem(REMEMBER_KEY) ?? "";
  } catch {
    return "";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** Reads any remembered login on this device, then mounts the form with it as initial values. */
type Location = { id: string; label: string };

export function LoginForm({ outlets }: { outlets: { id: string; name: string }[] }) {
  const raw = useSyncExternalStore(subscribe, readRemembered, () => "");
  let saved: Remembered | null = null;
  try {
    saved = raw ? (JSON.parse(raw) as Remembered) : null;
  } catch {
    saved = null;
  }
  const locations: Location[] = [
    { id: HEAD_OFFICE, label: "Head Office / All Outlets (Admin Only)" },
    ...outlets.map((outlet) => ({ id: outlet.id, label: outlet.name.replace(" - ", " – ") })),
  ];
  return <LoginFormFields key={raw} saved={saved?.identifier ? saved : null} locations={locations} />;
}

function LoginFormFields({ saved, locations }: { saved: Remembered | null; locations: Location[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"email" | "staff">(saved?.mode ?? "email");
  const [identifier, setIdentifier] = useState(saved?.identifier ?? "");
  const [password, setPassword] = useState("");
  const [outletId, setOutletId] = useState<string | null>(saved?.outletId ?? null);
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(Boolean(saved));
  const [menuOpen, setMenuOpen] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const identifierRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menuOpen]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!outletId) {
      setError("Select the outlet or location you are signing in to.");
      setMenuOpen(true);
      return;
    }

    setIsSubmitting(true);
    const result = await signIn("credentials", { identifier, password, outletId, redirect: false });
    setIsSubmitting(false);

    if (result?.error) {
      setError(
        result.error === "CredentialsSignin"
          ? mode === "staff"
            ? "Staff ID or password is incorrect, or the account is suspended."
            : "Email or password is incorrect, or the account is suspended."
          : result.error,
      );
      return;
    }

    try {
      if (remember) window.localStorage.setItem(REMEMBER_KEY, JSON.stringify({ identifier, outletId, mode }));
      else window.localStorage.removeItem(REMEMBER_KEY);
    } catch {
      // ignore storage failures
    }

    router.push("/dashboard");
    router.refresh();
  }

  function switchMode() {
    setMode((current) => (current === "email" ? "staff" : "email"));
    setIdentifier("");
    setError("");
    window.setTimeout(() => identifierRef.current?.focus(), 0);
  }

  const selected = locations.find((location) => location.id === outletId);

  return (
    <div className="w-full max-w-[560px] rounded-[28px] bg-white px-6 py-8 shadow-[0_30px_80px_-30px_rgba(15,81,50,0.35)] sm:px-10">
      <div className="flex flex-col items-center text-center">
        <BrandMark id="card" className="h-20 w-20" />
        <p className="mt-2 text-3xl font-bold tracking-tight text-green-900">Pharmacy ERP</p>
        <h2 className="mt-4 text-2xl font-bold text-slate-900 sm:text-[28px]">Sign in to your account</h2>
        <p className="mt-1.5 text-slate-600">Enter your credentials to access the system</p>
      </div>

      <form className="mt-7 space-y-4" onSubmit={handleSubmit} noValidate>
        <label className={fieldShell}>
          {mode === "email" ? <Mail className="h-5 w-5 shrink-0 text-slate-600" /> : <QrCode className="h-5 w-5 shrink-0 text-green-700" />}
          <span className="sr-only">{mode === "email" ? "Email address" : "Staff ID"}</span>
          <input
            ref={identifierRef}
            type={mode === "email" ? "email" : "text"}
            autoComplete={mode === "email" ? "username" : "off"}
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder={mode === "email" ? "Email address" : "Staff ID — type or scan badge (e.g. W365-0004)"}
            className="h-full w-full bg-transparent text-[15px] outline-none placeholder:text-slate-500"
            required
          />
        </label>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className={`flex h-12 w-full items-center gap-3 rounded-xl border px-4 text-left transition ${
              menuOpen ? "border-green-600 ring-2 ring-green-600/15" : "border-green-600/70"
            }`}
          >
            <Store className="h-5 w-5 shrink-0 text-green-800" />
            <span className={`flex-1 truncate text-[15px] ${selected ? "text-slate-900" : "font-semibold text-slate-900"}`}>
              {selected?.label ?? "Select Outlet / Location"}
            </span>
            <ChevronDown className={`h-5 w-5 text-green-800 transition ${menuOpen ? "rotate-180" : ""}`} />
          </button>
          {menuOpen ? (
            <ul role="listbox" className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
              {locations.map((location) => {
                const active = location.id === outletId;
                return (
                  <li key={location.id} role="option" aria-selected={active}>
                    <button
                      type="button"
                      onClick={() => {
                        setOutletId(location.id);
                        setMenuOpen(false);
                        setError("");
                      }}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[15px] ${
                        active ? "bg-green-700 text-white" : "text-slate-800 hover:bg-green-50"
                      }`}
                    >
                      <Check className={`h-4 w-4 ${active ? "opacity-100" : "opacity-0"}`} />
                      <Store className="h-4 w-4 opacity-80" />
                      {location.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        <label className={fieldShell}>
          <LockKeyhole className="h-5 w-5 shrink-0 text-slate-600" />
          <span className="sr-only">Password</span>
          <input
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            className="h-full w-full bg-transparent text-[15px] outline-none placeholder:text-slate-500"
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            className="rounded p-1 text-slate-500 hover:text-slate-800"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </label>

        <div className="flex items-center justify-between text-[15px]">
          <label className="flex cursor-pointer items-center gap-2.5 text-slate-800">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              className="h-5 w-5 rounded border-slate-400 accent-green-700"
            />
            Remember me
          </label>
          <button type="button" onClick={() => setShowReset((value) => !value)} className="font-medium text-green-700 hover:text-green-800">
            Forgot password?
          </button>
        </div>

        {showReset ? (
          <p className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
            For security, passwords are reset by your Super Admin under <span className="font-semibold">Users</span>. Contact Head Office IT with your staff ID.
          </p>
        ) : null}

        {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-gradient-to-b from-green-600 to-green-800 text-lg font-semibold text-white shadow-sm transition hover:from-green-600 hover:to-green-700 disabled:opacity-70"
        >
          {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />}
          {isSubmitting ? "Signing in…" : "Sign In"}
        </button>

        <div className="flex items-center gap-4 text-slate-600">
          <span className="h-px flex-1 bg-slate-200" />
          or
          <span className="h-px flex-1 bg-slate-200" />
        </div>

        <button
          type="button"
          onClick={switchMode}
          className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-slate-50 text-[16px] font-semibold text-slate-900 transition hover:bg-slate-100"
        >
          {mode === "email" ? <QrCode className="h-5 w-5 text-green-700" /> : <Mail className="h-5 w-5 text-green-700" />}
          {mode === "email" ? "Use Staff ID / Barcode" : "Use Email Address"}
        </button>
      </form>

      <details className="mt-4 text-sm text-slate-600">
        <summary className="cursor-pointer select-none text-center text-xs font-medium uppercase tracking-[0.18em] text-slate-500 hover:text-green-700">
          Demo accounts
        </summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {demoAccounts.map((account) => (
            <button
              key={account.email}
              type="button"
              onClick={() => {
                setMode("email");
                setIdentifier(account.email);
                setPassword("Admin@123");
                setOutletId(account.outletId);
                setError("");
              }}
              className="rounded-lg border border-slate-200 px-3 py-2 text-left transition hover:border-green-600 hover:bg-green-50"
            >
              <span className="block font-medium text-slate-900">{account.role}</span>
              <span className="block text-xs text-slate-500">{account.email}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-center text-xs text-slate-500">Password for all demo accounts: Admin@123</p>
      </details>

      <PharmacyIllustration className="mx-auto mt-4 w-full max-w-[380px]" />
    </div>
  );
}
