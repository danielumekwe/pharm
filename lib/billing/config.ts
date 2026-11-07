// Which Paystack keys to use: the Payment Gateway settings (encrypted, chosen by mode) when enabled there,
// otherwise the PAYSTACK_SECRET_KEY environment variable. Read fresh each time (one small query): an
// in-process cache would go stale on other server instances and in separately bundled routes.
import { readPlatformSetting } from "@/lib/platform/settings";

export type PaystackConfig = { secretKey: string; publicKey: string; mode: "test" | "live"; currency: string; source: "settings" | "environment" | "none" };

export async function paystackConfig(): Promise<PaystackConfig> {
  let config: PaystackConfig = { secretKey: "", publicKey: "", mode: "test", currency: "NGN", source: "none" };
  try {
    const setting = await readPlatformSetting("payments.paystack");
    const secret = setting.secrets[setting.value.mode === "live" ? "liveSecretKey" : "testSecretKey"];
    if (setting.value.enabled && secret) {
      config = { secretKey: secret, publicKey: setting.value.mode === "live" ? setting.value.livePublicKey : setting.value.testPublicKey, mode: setting.value.mode, currency: setting.value.currency, source: "settings" };
    }
  } catch (error) {
    console.error("[billing] payment settings unavailable", error instanceof Error ? error.name : "error"); // never log secrets
  }
  if (config.source === "none" && /^sk_(test|live)_/.test(process.env.PAYSTACK_SECRET_KEY ?? "")) {
    const secretKey = process.env.PAYSTACK_SECRET_KEY!;
    config = { secretKey, publicKey: process.env.PAYSTACK_PUBLIC_KEY ?? "", mode: secretKey.startsWith("sk_live_") ? "live" : "test", currency: "NGN", source: "environment" };
  }
  return config;
}
