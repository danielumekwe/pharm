// AI Wallet notifications: in-app messages for the people who look after the wallet, and emails to the
// pharmacy's Super Admins through the existing email service. Low-balance alerts are decided by the ledger
// (each threshold once until the balance rises again), so they are not repeated.

import { after } from "next/server";

import { users } from "@/lib/data";
import { inDatabaseTransaction, outsideTransaction, withDatabaseTransaction } from "@/lib/db/database";
import { newId } from "@/lib/erp/ids";
import { getStore, nextNumber } from "@/lib/erp/store";
import type { AuditSeverity } from "@/lib/erp/types";
import type { TemplateKey } from "@/lib/notify/templates";
import { effectivePermissions, type Permission } from "@/lib/rbac";
import { notifyPharmacyOwners } from "@/lib/saas/account-email";
import { runInTenant } from "@/lib/saas/tenant";

import type { WalletEvent } from "./wallet";

export type InApp = { title: string; body: string; severity?: AuditSeverity; link?: string; audience?: Permission; userId?: string };

function appLink(path: string) {
  return `${(process.env.APP_URL || process.env.NEXTAUTH_URL || "").replace(/\/$/, "")}${path}`;
}

/** Adds in-app notifications (inside the pharmacy's own transaction). */
function addInApp(messages: InApp[]) {
  const store = getStore();
  for (const message of messages) {
    const audience = message.audience ?? "ai.wallet.manage";
    const recipients = message.userId ? users.filter((user) => user.id === message.userId) : users.filter((user) => (user.status ?? "ACTIVE") === "ACTIVE" && effectivePermissions(user.role, user.grants ?? []).includes(audience));
    for (const user of recipients) {
      store.notifications.unshift({ id: newId("ntf", `${Date.now()}-${nextNumber("notification")}`), userId: user.id, title: message.title, body: message.body, severity: message.severity ?? "info", link: message.link ?? "/ai-wallet", createdAt: new Date().toISOString() });
    }
  }
}

/** Runs email sending after the response when possible (never inside the database transaction). */
function later(task: () => Promise<unknown>) {
  // After the response the request's transaction is closed: the email work must not try to reuse it.
  const run = () => outsideTransaction(() => task()).catch((error) => console.error("[ai-wallet] notification email failed", error instanceof Error ? error.message : "error"));
  try {
    after(run);
  } catch {
    void run();
  }
}

export function sendOwnerEmail(tenantId: string, template: TemplateKey, values: Record<string, string | number | null | undefined>) {
  later(() => notifyPharmacyOwners(tenantId, template, { link: appLink("/ai-wallet"), ...values }, "billing"));
}

/** In-app messages for a pharmacy, from inside or outside its request transaction. */
export async function notifyPharmacy(tenantId: string, messages: InApp[]) {
  if (!messages.length) return;
  if (inDatabaseTransaction()) addInApp(messages);
  else await runInTenant(tenantId, () => withDatabaseTransaction(() => addInApp(messages))).catch((error) => console.error("[ai-wallet] in-app notification failed", error));
}

/** Turns wallet events (welcome coins, low balance) into notifications. */
export async function deliverWalletEvents(tenantId: string, events: WalletEvent[]) {
  const messages: InApp[] = [];
  for (const event of events) {
    if (event.kind === "credited") {
      messages.push({ title: `${event.coins?.toLocaleString("en-NG")} AI coins added`, body: `${event.reason ?? "Coins added to your AI Wallet"}. Balance: ${event.balance.toLocaleString("en-NG")} coins.`, audience: "ai.wallet.view" });
      sendOwnerEmail(tenantId, "ai_coins_credited", { coins: event.coins?.toLocaleString("en-NG"), reason: event.reason ?? "coins added", balance: event.balance.toLocaleString("en-NG"), amount: "Free", reference: "—" });
    } else {
      messages.push({ title: "AI coin balance is low", body: `Only ${event.balance.toLocaleString("en-NG")} AI coins are left (alert level ${event.threshold}). Buy coins to keep using AI document scanning.`, severity: "warning", audience: "ai.wallet.manage" });
      sendOwnerEmail(tenantId, "ai_low_balance", { balance: event.balance.toLocaleString("en-NG"), threshold: event.threshold });
    }
  }
  await notifyPharmacy(tenantId, messages);
}
