import Link from "next/link";
import { connection } from "next/server";

import { maintenanceMessage } from "@/lib/platform/system";

export const metadata = { title: "Maintenance" };

/** Shown to pharmacy users while Web365 has the system in maintenance. */
export default async function MaintenancePage() {
  await connection();
  const message = await maintenanceMessage();
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-4 text-center text-slate-900">
      <h1 className="text-2xl font-bold">{message ? "We'll be right back" : "The system is available"}</h1>
      <p className="text-slate-700" data-maintenance-message>{message ?? "Maintenance has finished."}</p>
      <Link href="/login" className="rounded-xl bg-green-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-800">{message ? "Try again" : "Sign in"}</Link>
    </main>
  );
}
