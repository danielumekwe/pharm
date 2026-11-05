// Helpers for the Android app (Capacitor shell that loads this site). In a normal browser every function is a no-op
// or reports "not native", so web behaviour is unchanged. Plugins are reached through the bridge Capacitor injects.

type PluginCall = (options?: Record<string, unknown>) => Promise<Record<string, unknown>>;
type Plugins = Record<string, Record<string, PluginCall & ((event: string, handler: (data: Record<string, unknown>) => void) => Promise<unknown>)>>;
type CapacitorGlobal = { isNativePlatform?: () => boolean; Plugins?: Plugins };

function capacitor(): CapacitorGlobal | null {
  if (typeof window === "undefined") return null;
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return cap?.isNativePlatform?.() ? cap : null;
}

export function isNativeApp() {
  return capacitor() !== null;
}

export function nativePlugin(name: string) {
  return capacitor()?.Plugins?.[name] ?? null;
}

/** Scans one barcode with the phone camera (Google ML Kit scanner). Returns null if cancelled or unavailable. */
export async function nativeScan(): Promise<string | null> {
  const scanner = nativePlugin("BarcodeScanner");
  if (!scanner) return null;
  try {
    const available = (await scanner.isGoogleBarcodeScannerModuleAvailable?.()) as { available?: boolean } | undefined;
    if (available && available.available === false) {
      await scanner.installGoogleBarcodeScannerModule?.();
      throw new Error("The barcode scanner is being installed by Google Play services. Try again in a moment.");
    }
    const result = (await scanner.scan({ formats: ["EAN_13", "EAN_8", "UPC_A", "UPC_E", "CODE_128", "CODE_39", "QR_CODE"] })) as { barcodes?: { rawValue?: string }[] };
    return result.barcodes?.[0]?.rawValue ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/cancel/i.test(message)) return null;
    throw error instanceof Error ? error : new Error(message);
  }
}

function base64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

/**
 * Android WebViews cannot open PDFs or download files, so in the app a receipt or export is fetched with the
 * signed-in session, saved to the app's cache and handed to the share sheet (print, WhatsApp, Drive, PDF viewer…).
 */
export async function shareFile(url: string, fallbackName = "document") {
  const filesystem = nativePlugin("Filesystem");
  const share = nativePlugin("Share");
  if (!filesystem || !share) return false;
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Could not download the file (${response.status}).`);
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const type = response.headers.get("content-type") ?? "";
  const extension = type.includes("pdf") ? ".pdf" : type.includes("spreadsheet") ? ".xlsx" : type.includes("png") ? ".png" : type.includes("jpeg") ? ".jpg" : "";
  const named = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  const name = (named ?? `${fallbackName}${extension}`).replace(/[^\w.-]+/g, "_");
  const written = (await filesystem.writeFile({ path: name, data: base64(await response.arrayBuffer()), directory: "CACHE" })) as { uri?: string };
  await share.share({ title: name, files: [written.uri] });
  return true;
}
