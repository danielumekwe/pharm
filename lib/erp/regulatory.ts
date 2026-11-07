// Regulatory affairs: product registrations, premises licences and document vault.

import { outlets, products } from "@/lib/data";
import { documentStore } from "@/lib/erp/document-storage";
import { assertCan, DomainError, outletName, recordAudit } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import { DOCUMENT_CATEGORIES, REGISTRATION_STATUSES, type Actor, type ProductRegistration, type RegistrationStatus, type RegulatoryDocument } from "@/lib/erp/types";
import { newId } from "@/lib/erp/ids";
import { assertPlanFeature } from "@/lib/saas/subscriptions";

const DAY = 1000 * 60 * 60 * 24;
/** NAFDAC renewals should be filed about six months before expiry. */
export const RENEWAL_WINDOW_DAYS = 180;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES: Record<string, string> = { "application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg" };

export type ComplianceState = "Valid" | "Renewal due" | "Expired" | "Pending";

export function expiryState(identifier: string | undefined, expiryDate: string | undefined): { state: ComplianceState; days: number | null } {
  if (!identifier || identifier === "Pending" || !expiryDate) return { state: "Pending", days: null };
  const days = Math.ceil((Date.parse(expiryDate) - Date.now()) / DAY);
  if (days < 0) return { state: "Expired", days };
  if (days <= RENEWAL_WINDOW_DAYS) return { state: "Renewal due", days };
  return { state: "Valid", days };
}

export function registrationRows() {
  return getStore().registrations.map((registration) => ({
    ...registration,
    ...expiryState(registration.nafdacNumber, registration.expiryDate),
    locations: products.filter((product) => product.name === registration.productName).length,
    documents: getStore().documents.filter((document) => document.relatedTo === registration.productName).length,
  }));
}

export function licenceRows() {
  return outlets.map((outlet) => ({
    id: outlet.id,
    name: outlet.name,
    code: outlet.code,
    type: outlet.type ?? "RETAIL",
    status: outlet.status ?? "ACTIVE",
    pcnLicense: outlet.pcnLicense ?? "Pending",
    licenceExpiry: outlet.licenceExpiry ?? "",
    ...expiryState(outlet.pcnLicense, outlet.licenceExpiry),
    documents: getStore().documents.filter((document) => document.relatedTo === outlet.id).length,
  }));
}

const NAFDAC_PATTERN = /^[A-Z0-9]{2}-\d{4,6}$/;

export async function updateRegistration(
  actor: Actor,
  id: string,
  input: { nafdacNumber: string; issuedDate: string; expiryDate: string; notes?: string; status?: RegistrationStatus; renewalDate?: string; localRepresentative?: string },
) {
  assertCan(actor, "regulatory.manage");
  await assertPlanFeature("regulatory_management");
  const registration = getStore().registrations.find((row) => row.id === id);
  if (!registration) throw new DomainError("Registration not found.", 404);
  const number = input.nafdacNumber.trim().toUpperCase() || "Pending";
  if (number !== "PENDING" && number !== "Pending" && !NAFDAC_PATTERN.test(number)) throw new DomainError("NAFDAC number must look like A4-12345.");
  const nafdacNumber = number === "PENDING" ? "Pending" : number;
  if (nafdacNumber !== "Pending") {
    if (!input.issuedDate || !input.expiryDate) throw new DomainError("Issue and expiry dates are required for a registered product.");
    if (Date.parse(input.expiryDate) <= Date.parse(input.issuedDate)) throw new DomainError("Expiry must be after the issue date.");
  }

  if (input.status && !REGISTRATION_STATUSES.includes(input.status)) throw new DomainError("Unknown regulatory status.");
  if (input.renewalDate && Number.isNaN(Date.parse(input.renewalDate))) throw new DomainError("Renewal date is not a valid date.");

  const changes: string[] = [];
  if (input.status && input.status !== registration.status) changes.push(`status ${registration.status ?? "—"} → ${input.status}`);
  if (input.renewalDate !== undefined && input.renewalDate !== (registration.renewalDate ?? "")) changes.push(`renewal → ${input.renewalDate || "—"}`);
  if (input.localRepresentative !== undefined && input.localRepresentative.trim() !== (registration.localRepresentative ?? "")) changes.push(`local representative → ${input.localRepresentative.trim() || "—"}`);
  if (nafdacNumber !== registration.nafdacNumber) changes.push(`NAFDAC ${registration.nafdacNumber} → ${nafdacNumber}`);
  if (input.expiryDate !== registration.expiryDate) changes.push(`expiry ${registration.expiryDate || "—"} → ${input.expiryDate || "—"}`);
  if (input.issuedDate !== registration.issuedDate) changes.push(`issued → ${input.issuedDate || "—"}`);

  Object.assign(registration, {
    nafdacNumber,
    issuedDate: input.issuedDate,
    expiryDate: input.expiryDate,
    notes: input.notes?.trim() || undefined,
    status: input.status ?? registration.status ?? (nafdacNumber === "Pending" ? "Pending" : "Registered"),
    renewalDate: input.renewalDate !== undefined ? input.renewalDate || undefined : registration.renewalDate,
    localRepresentative: input.localRepresentative !== undefined ? input.localRepresentative.trim() || undefined : registration.localRepresentative,
    updatedBy: actor.name,
    updatedAt: new Date().toISOString(),
  } satisfies Partial<ProductRegistration>);

  // Keep the item master in step at every location.
  for (const product of products.filter((row) => row.name === registration.productName)) product.nafdacNumber = nafdacNumber;

  recordAudit(actor, {
    action: "regulatory.registration",
    entity: "ProductRegistration",
    entityId: registration.id,
    summary: `${registration.productName}: ${changes.join(", ") || "notes updated"}`,
    severity: changes.length ? "warning" : "info",
  });
  return registration;
}

export async function updateLicence(actor: Actor, outletId: string, input: { pcnLicense: string; licenceExpiry: string }) {
  assertCan(actor, "regulatory.manage");
  await assertPlanFeature("regulatory_management");
  const outlet = outlets.find((row) => row.id === outletId);
  if (!outlet) throw new DomainError("Outlet not found.", 404);
  const licence = input.pcnLicense.trim().toUpperCase();
  if (!/^PCN\/[A-Z]{2}\//.test(licence)) throw new DomainError("PCN licence numbers look like PCN/PR/LA/2026/1182.");
  if (Number.isNaN(Date.parse(input.licenceExpiry))) throw new DomainError("Licence expiry date is required.");
  const before = `${outlet.pcnLicense ?? "—"} (exp ${outlet.licenceExpiry ?? "—"})`;
  outlet.pcnLicense = licence;
  outlet.licenceExpiry = input.licenceExpiry;
  recordAudit(actor, {
    action: "regulatory.licence",
    entity: "Outlet",
    entityId: outlet.id,
    summary: `${outlet.name} premises licence ${before} → ${licence} (exp ${input.licenceExpiry})`,
    outletId: outlet.id,
    severity: "warning",
  });
  return outlet;
}

export async function saveDocument(
  actor: Actor,
  meta: { title: string; category: string; relatedTo: string; expiresOn?: string },
  file: File,
) {
  assertCan(actor, "regulatory.manage");
  await assertPlanFeature("regulatory_management");
  const title = meta.title.trim();
  if (title.length < 3) throw new DomainError("Give the document a title.");
  if (!(DOCUMENT_CATEGORIES as readonly string[]).includes(meta.category)) throw new DomainError("Choose a document category.");
  const extension = ALLOWED_TYPES[file.type];
  if (!extension) throw new DomainError("Only PDF, PNG or JPEG files can be uploaded.");
  if (file.size === 0) throw new DomainError("The file is empty.");
  if (file.size > MAX_UPLOAD_BYTES) throw new DomainError("Files must be 5 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Check the file signature, not just the declared type.
  const signature = [...bytes.subarray(0, 4)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const valid = extension === ".pdf" ? signature === "25504446" : extension === ".png" ? signature === "89504e47" : signature.startsWith("ffd8ff");
  if (!valid) throw new DomainError("The file content does not match its type.");
  const relatedTo = meta.relatedTo.trim();
  if (relatedTo && !outlets.some((outlet) => outlet.id === relatedTo) && !getStore().registrations.some((row) => row.productName === relatedTo)) {
    throw new DomainError("Link the document to a known product or outlet.");
  }

  const storedName = `${crypto.randomUUID().replaceAll("-", "")}${extension}`;
  await (await documentStore()).put(storedName, bytes, file.type);

  const document: RegulatoryDocument = {
    id: newId("doc", `${Date.now()}`),
    title,
    category: meta.category as RegulatoryDocument["category"],
    relatedTo,
    fileName: file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || `document${extension}`,
    mimeType: file.type,
    size: file.size,
    storedName,
    expiresOn: meta.expiresOn || undefined,
    uploadedBy: actor.name,
    uploadedAt: new Date().toISOString(),
  };
  getStore().documents.unshift(document);
  recordAudit(actor, {
    action: "regulatory.upload",
    entity: "RegulatoryDocument",
    entityId: document.id,
    summary: `Uploaded "${title}" (${document.category}, ${Math.ceil(file.size / 1024)} KB)${relatedTo ? ` for ${outletName(relatedTo) === relatedTo ? relatedTo : outletName(relatedTo)}` : ""}`,
    outletId: outlets.some((outlet) => outlet.id === relatedTo) ? relatedTo : null,
  });
  return document;
}

export async function readDocument(id: string) {
  const document = getStore().documents.find((row) => row.id === id);
  if (!document) throw new DomainError("Document not found.", 404);
  const bytes = await (await documentStore()).get(document.storedName);
  if (!bytes) throw new DomainError("The stored file is missing.", 410);
  return { document, bytes };
}

export async function deleteDocument(actor: Actor, id: string) {
  assertCan(actor, "regulatory.manage");
  await assertPlanFeature("regulatory_management");
  const store = getStore();
  const document = store.documents.find((row) => row.id === id);
  if (!document) throw new DomainError("Document not found.", 404);
  await (await documentStore()).delete(document.storedName);
  store.documents = store.documents.filter((row) => row.id !== id);
  recordAudit(actor, { action: "regulatory.delete", entity: "RegulatoryDocument", entityId: id, summary: `Deleted "${document.title}" (${document.category})`, severity: "warning" });
  return { ok: true };
}
