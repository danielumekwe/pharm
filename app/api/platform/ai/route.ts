import { NextResponse } from "next/server";

import {
  adjustWallet,
  aiDashboard,
  endPriceOverride,
  limitsView,
  listPackages,
  pricingView,
  providerCosts,
  purchasesView,
  recheckPurchase,
  reconciliationView,
  refundPurchase,
  removeTenantLimits,
  runReconciliation,
  savePackage,
  setLimits,
  setModelPrice,
  setOperationPrice,
  setWalletStatus,
  tenantDetail,
  tenantUsage,
  updateWalletSettings,
  walletSettings,
} from "@/lib/ai/admin";
import { DomainError } from "@/lib/erp/services";
import { platformGuarded } from "@/lib/platform/session";

/** Control Centre → AI Usage & Billing (read): ?view=dashboard|costs|pricing|packages|tenants|tenant|limits|purchases|reconciliation|settings */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const dates = { from: params.get("from"), to: params.get("to") };
  return platformGuarded("ai.view", async () => {
    switch (params.get("view")) {
      case "costs":
        return providerCosts(dates);
      case "pricing":
        return pricingView();
      case "packages":
        return listPackages();
      case "tenants":
        return tenantUsage();
      case "tenant":
        return tenantDetail(params.get("id") ?? "");
      case "limits":
        return limitsView();
      case "purchases":
        return purchasesView({ status: params.get("status") });
      case "reconciliation":
        return reconciliationView();
      case "settings":
        return walletSettings();
      default:
        return aiDashboard(dates);
    }
  });
}

/** Changes (ai.manage): { action, ... }. Every change is recorded in the platform audit log. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  return platformGuarded("ai.manage", async (actor) => {
    switch (body.action) {
      case "price":
        return setOperationPrice(actor, body.price);
      case "end-override":
        return endPriceOverride(actor, String(body.code ?? ""), String(body.tenantId ?? ""));
      case "model-price":
        return setModelPrice(actor, body.price);
      case "package":
        return savePackage(actor, body.package);
      case "adjust":
        return adjustWallet(actor, body.adjustment);
      case "wallet-status":
        return setWalletStatus(actor, String(body.tenantId ?? ""), body.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE", String(body.reason ?? ""));
      case "limits":
        return setLimits(actor, body.limits);
      case "remove-limits":
        return removeTenantLimits(actor, String(body.tenantId ?? ""));
      case "recheck":
        return recheckPurchase(actor, String(body.reference ?? ""));
      case "refund":
        return refundPurchase(actor, String(body.purchaseId ?? ""), String(body.reason ?? ""));
      case "reconcile":
        return runReconciliation(actor);
      case "settings":
        return updateWalletSettings(actor, body.value);
      default:
        throw new DomainError("Unknown action.");
    }
  });
}
