"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Building2, Check, ChevronDown, Eye, EyeOff, Loader2, LockKeyhole, LogIn, Mail, QrCode, Smartphone, Store } from "lucide-react";

import { BrandWordmark } from "@/components/branding";
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

type Remembered = { identifier: string; outletId: string; tenantId?: string; mode: "email" | "staff" };
type Location = { id: string; name: string };
type Pharmacy = { tenantId: string; name: string; role: string; locations: Location[]; defaultLocationId: string | null };

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
export function LoginForm() {
  const raw = useSyncExternalStore(subscribe, readRemembered, () => "");
  let saved: Remembered | null = null;
  try {
    saved = raw ? (JSON.parse(raw) as Remembered) : null;
  } catch {
    saved = null;
  }
  return <LoginFormFields key={raw} saved={saved?.identifier ? saved : null} />;
}

/**
 * Two steps: (1) email or staff ID and password; (2) the pharmacy and location, chosen from the ones this
 * account may use. The page itself never lists pharmacies or outlets.
 */
function LoginFormFields({ saved }: { saved: Remembered | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<"email" | "staff">(saved?.mode ?? "email");
  const [identifier, setIdentifier] = useState(saved?.identifier ?? "");
  const [password, setPassword] = useState("");
  const [preferredOutlet, setPreferredOutlet] = useState<string | null>(saved?.outletId ?? null);
  const [pharmacies, setPharmacies] = useState<Pharmacy[] | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [outletId, setOutletId] = useState<string | null>(null);
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

  const pharmacy = pharmacies?.find((entry) => entry.tenantId === tenantId) ?? null;

  function choosePharmacy(entry: Pharmacy) {
    setTenantId(entry.tenantId);
    const preferred = entry.locations.find((location) => location.id === preferredOutlet);
    setOutletId(preferred?.id ?? entry.defaultLocationId ?? entry.locations[0]?.id ?? null);
    setError("");
  }

  async function signInTo(chosenTenant: string, chosenOutlet: string) {
    setIsSubmitting(true);
    const result = await signIn("credentials", { identifier, password, tenantId: chosenTenant, outletId: chosenOutlet, redirect: false });
    setIsSubmitting(false);
    if (result?.error) {
      setError(result.error === "CredentialsSignin" ? (mode === "staff" ? "Staff ID or password is incorrect." : "Email or password is incorrect.") : result.error);
      return;
    }
    try {
      if (remember) window.localStorage.setItem(REMEMBER_KEY, JSON.stringify({ identifier, outletId: chosenOutlet, tenantId: chosenTenant, mode }));
      else window.localStorage.removeItem(REMEMBER_KEY);
    } catch {
      // ignore storage failures
    }
    router.push("/dashboard");
    router.refresh();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (pharmacies) {
      if (!tenantId) return setError("Select the pharmacy you are signing in to.");
      if (!outletId) {
        setMenuOpen(true);
        return setError("Select the outlet or location you are signing in to.");
      }
      return signInTo(tenantId, outletId);
    }

    // Step 1: check the password and fetch the pharmacies and locations this account may use.
    setIsSubmitting(true);
    const response = await fetch("/api/auth/pharmacies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier, password }) });
    const body = (await response.json().catch(() => ({}))) as { pharmacies?: Pharmacy[]; error?: string };
    setIsSubmitting(false);
    if (!response.ok || !body.pharmacies?.length) {
      setError(body.error ?? "Sign-in is unavailable right now.");
      return;
    }
    const list = body.pharmacies;
    const only = list.length === 1 ? list[0] : null;
    const rememberedPharmacy = list.find((entry) => entry.tenantId === saved?.tenantId) ?? only;
    // One pharmacy with one location: nothing to choose.
    if (only && only.locations.length === 1) return signInTo(only.tenantId, only.locations[0].id);
    setPharmacies(list);
    if (rememberedPharmacy) choosePharmacy(rememberedPharmacy);
  }

  function startOver() {
    setPharmacies(null);
    setTenantId(null);
    setOutletId(null);
    setError("");
  }

  function switchMode() {
    setMode((current) => (current === "email" ? "staff" : "email"));
    setIdentifier("");
    setError("");
    window.setTimeout(() => identifierRef.current?.focus(), 0);
  }

  const selected = pharmacy?.locations.find((location) => location.id === outletId);

  return (
    <div className="w-full max-w-[560px] rounded-[28px] bg-white px-6 py-8 shadow-[0_30px_80px_-30px_rgba(15,81,50,0.35)] sm:px-10">
      <div className="flex flex-col items-center text-center">
        <BrandWordmark className="h-20 w-auto" />
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
            readOnly={Boolean(pharmacies)}
            required
          />
        </label>

        {pharmacies ? (
          <div className="space-y-3 rounded-2xl border border-green-200 bg-green-50/60 p-3">
            {pharmacies.length > 1 ? (
              <div role="radiogroup" aria-label="Pharmacy" className="grid gap-2">
                {pharmacies.map((entry) => {
                  const active = entry.tenantId === tenantId;
                  return (
                    <button
                      key={entry.tenantId}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => choosePharmacy(entry)}
                      className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${active ? "border-green-700 bg-green-700 text-white" : "border-slate-300 bg-white text-slate-900 hover:border-green-600"}`}
                    >
                      <Building2 className="h-5 w-5 shrink-0" />
                      <span className="flex-1">
                        <span className="block font-semibold">{entry.name}</span>
                        <span className={`block text-xs ${active ? "text-green-50" : "text-slate-500"}`}>{entry.role}</span>
                      </span>
                      <Check className={`h-4 w-4 ${active ? "opacity-100" : "opacity-0"}`} />
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="flex items-center gap-2 px-1 text-sm font-semibold text-green-900">
                <Building2 className="h-4 w-4" /> {pharmacy?.name} · <span className="font-normal">{pharmacy?.role}</span>
              </p>
            )}

            {pharmacy ? (
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((open) => !open)}
                  className={`flex h-12 w-full items-center gap-3 rounded-xl border bg-white px-4 text-left transition ${
                    menuOpen ? "border-green-600 ring-2 ring-green-600/15" : "border-green-600/70"
                  }`}
                >
                  <Store className="h-5 w-5 shrink-0 text-green-800" />
                  <span className={`flex-1 truncate text-[15px] ${selected ? "text-slate-900" : "font-semibold text-slate-900"}`}>
                    {selected?.name ?? "Select Outlet / Location"}
                  </span>
                  <ChevronDown className={`h-5 w-5 text-green-800 transition ${menuOpen ? "rotate-180" : ""}`} />
                </button>
                {menuOpen ? (
                  <ul role="listbox" className="absolute z-20 mt-1.5 max-h-72 w-full overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                    {pharmacy.locations.map((location) => {
                      const active = location.id === outletId;
                      return (
                        <li key={location.id} role="option" aria-selected={active}>
                          <button
                            type="button"
                            onClick={() => {
                              setOutletId(location.id);
                              setPreferredOutlet(location.id);
                              setMenuOpen(false);
                              setError("");
                            }}
                            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[15px] ${
                              active ? "bg-green-700 text-white" : "text-slate-800 hover:bg-green-50"
                            }`}
                          >
                            <Check className={`h-4 w-4 ${active ? "opacity-100" : "opacity-0"}`} />
                            <Store className="h-4 w-4 opacity-80" />
                            {location.name}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            ) : null}
            <button type="button" onClick={startOver} className="px-1 text-sm font-medium text-green-700 hover:text-green-800">
              ← Use a different account
            </button>
          </div>
        ) : null}

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
          {isSubmitting ? (pharmacies ? "Signing in…" : "Checking…") : pharmacies ? "Sign In" : "Continue"}
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

      <a
        href="/downloads/PharmaERP.apk"
        download
        className="web-only mt-4 flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-blue-400 hover:text-blue-700"
      >
        <Smartphone className="h-4 w-4" /> Get the Android app
      </a>

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
                setPreferredOutlet(account.outletId);
                startOver();
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
