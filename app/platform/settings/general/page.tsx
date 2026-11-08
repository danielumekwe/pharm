import { PlatformShell } from "@/components/platform/platform-shell";
import { requirePlatformPage } from "@/lib/platform/pages";
import { describePlatformSetting } from "@/lib/platform/settings";

import { SettingForm } from "./setting-form";

export const metadata = { title: "Branding and notifications · Web365 platform" };

export default async function GeneralSettingsPage() {
  const actor = await requirePlatformPage("settings.manage");
  const [branding, notifications] = await Promise.all([describePlatformSetting("branding.app"), describePlatformSetting("notifications.global")]);
  return (
    <PlatformShell actor={actor}>
      <h1 className="text-2xl font-bold">Branding and notifications</h1>
      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Application branding</h2>
        <p className="text-sm text-slate-600">Used in every email, the sign-in page and the help pages. Each pharmacy keeps its own name and logo inside its app.</p>
        <SettingForm settingKey="branding.app" value={branding.value} fields={[
          { name: "appName", label: "Product name", type: "text" },
          { name: "supportEmail", label: "Support email (shown in emails and Help)", type: "text" },
          { name: "supportPhone", label: "Support phone (shown in Help)", type: "text" },
          { name: "loginTagline", label: "Line under the sign-in form (optional)", type: "text" },
        ]} />
      </section>
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Notification switches</h2>
        <p className="text-sm text-slate-600">Platform-wide. Switched-off messages are logged as not sent. Account emails (confirm email, password reset, invitations) are always sent.</p>
        <SettingForm settingKey="notifications.global" value={notifications.value} fields={[
          { name: "pharmacyAlertEmails", label: "Stock, expiry and summary alert emails", type: "boolean" },
          { name: "pushNotifications", label: "Android push notifications", type: "boolean" },
          { name: "billingEmails", label: "Payment confirmation and failure emails", type: "boolean" },
          { name: "announcementEmails", label: "Announcement emails", type: "boolean" },
        ]} />
      </section>
    </PlatformShell>
  );
}
