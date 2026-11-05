// Site branding: the business name (site title) and an optional uploaded logo, both managed in Settings.

import { cache } from "react";
import { connection } from "next/server";

import { inDatabaseTransaction, readStateValue } from "@/lib/db/database";
import { documentStore } from "@/lib/erp/document-storage";
import { assertCan, DomainError, recordAudit } from "@/lib/erp/services";
import { DEFAULT_SETTINGS, getStore } from "@/lib/erp/store";
import type { Actor, SystemSettings } from "@/lib/erp/types";

export type Branding = { name: string; logoFile: string | null };

const MAX_LOGO_BYTES = 512 * 1024;
const LOGO_TYPES: Record<string, { extension: string; matches: (bytes: Uint8Array) => boolean }> = {
  "image/png": { extension: ".png", matches: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  "image/jpeg": { extension: ".jpg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/webp": { extension: ".webp", matches: (b) => String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP" },
};

function fromSettings(settings: Partial<SystemSettings> | undefined): Branding {
  return { name: settings?.businessName?.trim() || DEFAULT_SETTINGS.businessName, logoFile: settings?.logoFile ?? null };
}

/** Current branding for page chrome. Public: the login page needs it before anyone signs in. */
export const readBranding = cache(async (): Promise<Branding> => {
  if (inDatabaseTransaction()) return fromSettings(getStore().settings);
  await connection();
  try {
    return fromSettings(await readStateValue<SystemSettings>("settings"));
  } catch (error) {
    console.error("[branding] falling back to defaults", error);
    return fromSettings(undefined);
  }
});

/** Logo bytes for the public logo route. Only the current logo can be read, never other stored files. */
export async function readLogo() {
  const name = getStore().settings.logoFile;
  if (!name) return null;
  const bytes = await (await documentStore()).get(name);
  if (!bytes) return null;
  const mimeType = Object.entries(LOGO_TYPES).find(([, type]) => name.endsWith(type.extension))?.[0] ?? "application/octet-stream";
  return { name, bytes, mimeType };
}

export async function saveLogo(actor: Actor, file: File) {
  assertCan(actor, "settings.manage");
  const type = LOGO_TYPES[file.type];
  if (!type) throw new DomainError("The logo must be a PNG, JPEG or WebP image.");
  if (file.size === 0) throw new DomainError("The file is empty.");
  if (file.size > MAX_LOGO_BYTES) throw new DomainError("The logo must be 512 KB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!type.matches(bytes)) throw new DomainError("The file content does not match its type.");

  const store = await documentStore();
  const settings = getStore().settings;
  const previous = settings.logoFile;
  const name = `brand-logo-${crypto.randomUUID().replaceAll("-", "")}${type.extension}`;
  await store.put(name, bytes, file.type);
  if (previous) await store.delete(previous);
  settings.logoFile = name;
  recordAudit(actor, { action: "settings.logo", entity: "Settings", entityId: "system", summary: `Logo ${previous ? "replaced" : "uploaded"} (${Math.ceil(file.size / 1024)} KB)`, severity: "info" });
  return fromSettings(settings);
}

export async function removeLogo(actor: Actor) {
  assertCan(actor, "settings.manage");
  const settings = getStore().settings;
  if (settings.logoFile) {
    await (await documentStore()).delete(settings.logoFile);
    settings.logoFile = null;
    recordAudit(actor, { action: "settings.logo", entity: "Settings", entityId: "system", summary: "Logo removed; built-in logo restored", severity: "info" });
  }
  return fromSettings(settings);
}
