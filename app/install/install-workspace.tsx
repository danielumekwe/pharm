"use client";

import { CheckCircle2, CircleDashed, Download, Laptop, Monitor, Smartphone, Tablet, XCircle } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { ActionButton } from "@/components/erp/fields";
import { PageHeader } from "@/components/erp/page-header";
import { Panel } from "@/components/erp/stat-card";
import { usePwa } from "@/components/pwa/pwa-client";
import { promptInstall } from "@/components/pwa/pwa-store";

type Platform = "windows" | "mac" | "android" | "ios" | "other";

function detectPlatform(): Platform {
  const agent = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(agent)) return "android";
  if (/Windows/.test(agent)) return "windows";
  if (/Macintosh/.test(agent)) return "mac";
  return "other";
}

const noSubscription = () => () => {};

const GUIDES: { key: Platform; title: string; icon: typeof Monitor; steps: string[] }[] = [
  {
    key: "windows",
    title: "Windows (Chrome or Microsoft Edge)",
    icon: Monitor,
    steps: [
      "Open PharmaERP in Chrome or Edge and sign in.",
      "Click the install icon at the right of the address bar (a screen with a down arrow), or open the ⋮ / … menu and choose “Install PharmaERP” (Edge: Apps → Install this site as an app).",
      "Click Install. PharmaERP opens in its own window and is added to the Start menu; you can pin it to the taskbar.",
    ],
  },
  {
    key: "mac",
    title: "macOS (Chrome, Edge or Safari 17+)",
    icon: Laptop,
    steps: [
      "Chrome or Edge: click the install icon in the address bar, or menu → “Install PharmaERP”.",
      "Safari: choose File → Add to Dock, then Add.",
      "PharmaERP opens in its own window and appears in Launchpad and the Dock.",
    ],
  },
  {
    key: "android",
    title: "Android phones and tablets (Chrome)",
    icon: Smartphone,
    steps: [
      "Open PharmaERP in Chrome and sign in.",
      "Tap “Install” when Chrome offers it, or open the ⋮ menu and tap “Install app” / “Add to Home screen”.",
      "Open PharmaERP from the home screen. The PharmaERP Android app (APK) from our website works too.",
    ],
  },
  {
    key: "ios",
    title: "iPhone and iPad (Safari)",
    icon: Tablet,
    steps: [
      "Open PharmaERP in Safari (on iOS 16.4+ Chrome and Edge also work).",
      "Tap the Share button, then “Add to Home Screen”.",
      "Keep “Open as Web App” on and tap Add. Open PharmaERP from the home screen.",
    ],
  },
];

function Status({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) {
  const Icon = ok === null ? CircleDashed : ok ? CheckCircle2 : XCircle;
  return (
    <li className="flex items-start gap-3 rounded-xl border border-slate-800 p-3">
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${ok === null ? "text-slate-500" : ok ? "text-emerald-400" : "text-amber-400"}`} aria-hidden="true" />
      <div>
        <p className="text-sm font-medium text-white">{label}</p>
        <p className="text-xs text-slate-400">{detail}</p>
      </div>
    </li>
  );
}

export function InstallWorkspace() {
  const pwa = usePwa();
  const platform = useSyncExternalStore(noSubscription, detectPlatform, () => "other" as Platform);
  const [message, setMessage] = useState<string | null>(null);

  async function install() {
    const outcome = await promptInstall();
    setMessage(outcome === "accepted" ? "PharmaERP is being installed. Open it from your desktop, Start menu, Dock or home screen." : outcome === "dismissed" ? "Installation cancelled. You can install any time from this page." : null);
  }

  const ordered = [...GUIDES].sort((a, b) => Number(b.key === platform) - Number(a.key === platform));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Install PharmaERP"
        description="Install PharmaERP on this computer, phone or tablet so it opens in its own window from your desktop or home screen, with the same sign-in and branding."
        actions={
          pwa.canPrompt ? (
            <ActionButton onClick={install} data-install>
              <Download className="h-4 w-4" /> Install PharmaERP
            </ActionButton>
          ) : null
        }
      />
      {message ? <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{message}</p> : null}

      <Panel title="This device" description="Checked live in this browser.">
        <ul className="grid gap-3 md:grid-cols-2">
          <Status
            ok={pwa.installed || pwa.standalone ? true : pwa.canPrompt ? false : null}
            label={pwa.standalone ? "Running as the installed app" : pwa.installed ? "Installed" : "Not installed in this browser"}
            detail={
              pwa.standalone
                ? "You are using PharmaERP in its own app window."
                : pwa.canPrompt
                  ? "Use the Install PharmaERP button above."
                  : "This browser does not offer a one-click install here; follow the steps below for your device. If PharmaERP is already installed, open it from your desktop or home screen."
            }
          />
          <Status
            ok={pwa.serviceWorker === "active" ? true : pwa.serviceWorker === "registering" ? null : false}
            label={{ active: "App files ready", registering: "Preparing app files…", failed: "App files could not be prepared", unsupported: "This browser cannot install apps", disabled: "App files are only prepared on the live site" }[pwa.serviceWorker]}
            detail="The app window, icons and the offline screen are stored on this device. No pharmacy data is stored in the browser cache."
          />
          <Status
            ok={pwa.connection === "checking" ? null : pwa.connection !== "offline"}
            label={pwa.connection === "offline" ? "Offline" : pwa.connection === "checking" ? "Checking connection…" : "Connected to PharmaERP"}
            detail={pwa.lastReachable ? `Server last reached at ${new Date(pwa.lastReachable).toLocaleTimeString()}. Checked automatically; you never need to refresh.` : "The connection is checked automatically."}
          />
          <Status ok={null} label="Offline device registration: not available yet" detail="Registering this device for offline selling comes with the offline POS update. Until then PharmaERP needs an internet connection to load and save data." />
        </ul>
      </Panel>

      <Panel title="What works without internet today" description="Honest status of offline support in this version.">
        <ul className="grid gap-2 text-sm text-slate-300 md:grid-cols-2">
          <li>✓ The installed app opens, with its icon and window, even without a connection.</li>
          <li>✓ When the connection drops, you see a clear offline screen instead of a browser error.</li>
          <li>✓ The app notices when the connection returns and reopens the screen on its own.</li>
          <li>✓ The header shows Online / Offline at all times.</li>
          <li className="text-slate-400">• Selling, stock receiving and adjustments still need a connection. Offline POS with automatic upload is the next update.</li>
          <li className="text-slate-400">• Nothing is ever recorded as saved unless the server has confirmed it.</li>
        </ul>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {ordered.map(({ key, title, icon: Icon, steps }) => (
          <Panel key={key} title={title} description={key === platform ? "Your device" : undefined}>
            <div className="flex gap-4">
              <Icon className="h-6 w-6 shrink-0 text-blue-400" aria-hidden="true" />
              <ol className="list-decimal space-y-2 pl-4 text-sm text-slate-300">
                {steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}
