// Generates prisma/schema.prisma from lib/db/schema.ts so Prisma migrations match the tables used by the app.
// Run: npm run db:schema
//
// Tenancy: every table except the user-scoped ones (users, devices) carries tenantId with a relation to
// Tenant. Fields marked `ref` become composite relations on (tenantId, field) → (tenantId, id), the same
// links the migration enforces with composite foreign keys. Unique fields are unique per tenant.
import { writeFileSync } from "node:fs";

import { columnName, KV_TABLE, TABLES, type FieldSpec, type TableSpec } from "../lib/db/schema.ts";

const PRISMA_TYPES = { text: "String", int: "Int", real: "Float", money: "Decimal", bool: "Boolean", json: "String" } as const;
const pascal = (table: string) => table.replace(/(^|_)([a-z])/g, (_, __, letter: string) => letter.toUpperCase()).replace(/s$/, "");
const camel = (column: string) => column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
const upperFirst = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const tenantOwned = (spec: TableSpec) => spec.scope !== "user";
const pad = (name: string, type: string) => `  ${name.padEnd(24)} ${type.padEnd(14)}`;

function field([name, kind, options]: FieldSpec, { child = false, perTenantUnique = false } = {}) {
  const column = columnName(name);
  const globalUnique = options?.unique && !perTenantUnique;
  const attributes = [name === "id" && !child ? "@id" : "", globalUnique ? "@unique" : "", column !== name ? `@map("${column}")` : "", kind === "money" ? "@db.Decimal(18, 4)" : ""].filter(Boolean).join(" ");
  const optional = (name === "id" && !child) || options?.required ? "" : "?";
  const comment = kind === "json" ? " // JSON" : "";
  return `${pad(name, PRISMA_TYPES[kind] + optional)} ${attributes}${comment}`.trimEnd();
}

// Incoming links per parent table, so each parent gets the matching back-relation fields.
type Link = { table: string; field: string; parent: string; name: string };
const links: Link[] = TABLES.flatMap((spec) => spec.fields.filter(([, , options]) => options?.ref).map(([name, , options]) => ({ table: spec.table, field: name, parent: options!.ref!, name: `${spec.table}_${columnName(name)}` })));
const referenced = new Set([...links.map((link) => link.parent), ...TABLES.filter((spec) => spec.children?.length && tenantOwned(spec)).map((spec) => spec.table)]);
const tenantBackRelations: string[] = [];
const tenantRelation = (model: string, plural: string, onDelete = "Restrict") => {
  tenantBackRelations.push(`${pad(plural, `${model}[]`)}`.trimEnd());
  return [`${pad("tenantId", "String")} @map("tenant_id")`, `${pad("tenant", "Tenant")} @relation(fields: [tenantId], references: [id], onDelete: ${onDelete}, onUpdate: Cascade)`];
};

const models: string[] = [];
for (const spec of TABLES) {
  const name = pascal(spec.table);
  const owned = tenantOwned(spec);
  const lines = spec.fields.map((spec_) => field(spec_, { perTenantUnique: owned }));
  lines.push(`${pad("seq", "Int")} // insertion order`);
  if (owned) lines.push(...tenantRelation(name, camel(spec.table)));
  for (const link of links.filter((entry) => entry.table === spec.table)) {
    const base = link.field.replace(/Id$/, "");
    const relation = spec.fields.some(([fieldName]) => fieldName === base) ? `${base}Ref` : base; // e.g. batches.supplier is a name column
    lines.push(`${pad(relation, `${pascal(link.parent)}?`)} @relation("${link.name}", fields: [tenantId, ${link.field}], references: [tenantId, id], onDelete: NoAction, onUpdate: NoAction, map: "${link.name}_tenant_fkey")`);
  }
  for (const link of links.filter((entry) => entry.parent === spec.table)) {
    lines.push(`${pad(`${camel(link.table)}By${upperFirst(link.field)}`, `${pascal(link.table)}[]`)} @relation("${link.name}")`.trimEnd());
  }
  for (const child of spec.children ?? []) lines.push(`${pad(child.property, `${pascal(child.table)}[]`)}`.trimEnd());
  if (spec.table === "users") {
    lines.push(`${pad("memberships", "TenantMembership[]")}`.trimEnd());
    lines.push(`${pad("authTokens", "AuthToken[]")}`.trimEnd());
  }
  if (spec.table === "outlets") {
    lines.push(`${pad("userAssignments", "UserOutlet[]")} @relation("user_outlets_outlet_id")`);
    lines.push(`${pad("defaultForMemberships", "TenantMembership[]")} @relation("tenant_memberships_default_outlet_id")`);
  }

  const blockLines: string[] = [];
  // Constraint and index names match the hand-written migrations, so `prisma migrate diff` shows no drift.
  for (const [fieldName, , options] of spec.fields) {
    if (options?.unique && owned) blockLines.push(`  @@unique([tenantId, ${fieldName}], map: "${spec.table}_tenant_id_${columnName(fieldName)}_key")`);
  }
  if (owned && referenced.has(spec.table)) blockLines.push(`  @@unique([tenantId, id], map: "${spec.table}_tenant_id_id_key")`);
  if (owned) blockLines.push(`  @@index([tenantId], map: "${spec.table}_tenant_id_idx")`);
  for (const [fieldName, , options] of spec.fields) {
    if (options?.index) blockLines.push(`  @@index([${fieldName}])`);
    if (options?.ref) blockLines.push(`  @@index([tenantId, ${fieldName}], map: "${spec.table}_tenant_id_${columnName(fieldName)}_idx")`);
  }
  models.push(`model ${name} {\n${lines.join("\n")}\n${blockLines.length ? `\n${blockLines.join("\n")}\n` : ""}  @@map("${spec.table}")\n}`);

  for (const child of spec.children ?? []) {
    const childName = pascal(child.table);
    const parentField = camel(child.parentColumn);
    const childLines = [`${pad(parentField, "String")} @map("${child.parentColumn}")`, `${pad("position", "Int")}`.trimEnd()];
    if (child.scalarColumn) childLines.push(`${pad(camel(child.scalarColumn), "String")} @map("${child.scalarColumn}")`);
    for (const childField of child.fields ?? []) childLines.push(field(childField, { child: true }));
    childLines.push(...tenantRelation(childName, camel(child.table)));
    if (owned) {
      childLines.push(`${pad("parent", name)} @relation(fields: [tenantId, ${parentField}], references: [tenantId, id], onDelete: Cascade, onUpdate: Cascade, map: "${child.table}_${child.parentColumn.replace(/_id$/, "")}_fkey")`);
    } else {
      childLines.push(`${pad("parent", name)} @relation(fields: [${parentField}], references: [id], onDelete: Cascade, onUpdate: Cascade)`);
    }
    if (child.table === "user_outlets") {
      childLines.push(`${pad("outlet", "Outlet")} @relation("user_outlets_outlet_id", fields: [tenantId, outletId], references: [tenantId, id], onDelete: NoAction, onUpdate: NoAction, map: "user_outlets_outlet_fkey")`);
    }
    models.push(`model ${childName} {\n${childLines.join("\n")}\n\n  @@id([${owned ? "" : "tenantId, "}${parentField}, position])\n  @@index([tenantId], map: "${child.table}_tenant_id_idx")\n  @@map("${child.table}")\n}`);
  }
}

models.push(`model RegulatoryFile {
${tenantRelation("RegulatoryFile", "regulatoryFiles").join("\n")}
  storedName               String         @id @map("stored_name")
  mimeType                 String         @map("mime_type")
  bytes                    Bytes
  createdAt                DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([tenantId], map: "regulatory_files_tenant_id_idx")
  @@map("regulatory_files")
}`);

models.push(`/// tenantId is a tenant id, or '_platform' for platform-wide rows (no foreign key for that reason).
model AppState {
  tenantId                 String         @map("tenant_id")
  key                      String
  value                    String         // JSON

  @@id([tenantId, key])
  @@index([tenantId], map: "app_state_tenant_id_idx")
  @@map("${KV_TABLE}")
}`);

models.push(`/// A global user's role, status and permissions inside one tenant.
model TenantMembership {
  id                       String         @id
${tenantRelation("TenantMembership", "memberships", "Cascade").join("\n")}
  userId                   String         @map("user_id")
  user                     User           @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  role                     String
  status                   String         @default("ACTIVE")
  grants                   String?        // JSON
  defaultOutletId          String?        @map("default_outlet_id")
  defaultOutlet            Outlet?        @relation("tenant_memberships_default_outlet_id", fields: [tenantId, defaultOutletId], references: [tenantId, id], onDelete: NoAction, onUpdate: NoAction, map: "tenant_memberships_default_outlet_fkey")
  staffId                  String?        @map("staff_id")
  createdAt                DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt                DateTime       @default(now()) @map("updated_at") @db.Timestamptz(6)

  @@unique([tenantId, userId])
  @@unique([tenantId, staffId])
  @@index([userId])
  @@map("tenant_memberships")
}`);

models.push(`/// Single-use account token (email verification, password reset); only its SHA-256 hash is stored.
model AuthToken {
  id                       String         @id
  userId                   String         @map("user_id")
  user                     User           @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  purpose                  String         // verify_email | reset_password | join_pharmacy
  tenantId                 String?        @map("tenant_id")
  tenant                   Tenant?        @relation(fields: [tenantId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  tokenHash                String         @unique @map("token_hash")
  expiresAt                DateTime       @map("expires_at") @db.Timestamptz(6)
  usedAt                   DateTime?      @map("used_at") @db.Timestamptz(6)
  createdAt                DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([userId])
  @@map("auth_tokens")
}`);

models.push(`/// A Web365 staff account (platform administration; no pharmacy membership).
model PlatformUser {
  id                       String         @id
  email                    String         @unique(map: "platform_users_email_key")
  name                     String
  role                     String         // PLATFORM_SUPER_ADMIN | PLATFORM_SUPPORT
  status                   String         @default("ACTIVE")
  passwordHash             String         @map("password_hash")
  passwordChangedAt        DateTime?      @map("password_changed_at") @db.Timestamptz(6)
  lastLoginAt              DateTime?      @map("last_login_at") @db.Timestamptz(6)
  createdAt                DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt                DateTime       @default(now()) @map("updated_at") @db.Timestamptz(6)
  supportRequests          SupportAccessGrant[]

  @@map("platform_users")
}`);

models.push(`/// Platform audit trail; append-only for the application role.
model PlatformAuditEvent {
  id                       String         @id
  at                       DateTime       @default(now()) @db.Timestamptz(6)
  actorId                  String?        @map("actor_id")
  actorName                String         @map("actor_name")
  actorType                String         @map("actor_type") // platform | pharmacy | system
  action                   String
  targetType               String?        @map("target_type")
  targetId                 String?        @map("target_id")
  tenantId                 String?        @map("tenant_id")
  summary                  String
  severity                 String         @default("info")
  ip                       String?

  @@index([at(sort: Desc)])
  @@index([tenantId])
  @@map("platform_audit_events")
}`);

models.push(`/// Time-limited, read-only Web365 support access, approved by the pharmacy.
model SupportAccessGrant {
  id                       String         @id
  tenantId                 String         @map("tenant_id")
  tenant                   Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  requestedBy              String         @map("requested_by")
  requester                PlatformUser   @relation(fields: [requestedBy], references: [id], onDelete: Restrict, onUpdate: Cascade)
  reason                   String
  durationMinutes          Int            @map("duration_minutes")
  status                   String         @default("PENDING") // PENDING | APPROVED | DENIED | REVOKED
  requestedAt              DateTime       @default(now()) @map("requested_at") @db.Timestamptz(6)
  decidedBy                String?        @map("decided_by")
  decidedAt                DateTime?      @map("decided_at") @db.Timestamptz(6)
  expiresAt                DateTime?      @map("expires_at") @db.Timestamptz(6)

  @@index([tenantId])
  @@map("support_access_grants")
}`);

models.push(`/// A subscription plan, edited by the platform (limits and features: phase 5).
model Plan {
  id                       String         @id
  name                     String
  description              String         @default("")
  monthlyPrice             Decimal?       @map("monthly_price") @db.Decimal(18, 4)
  annualPrice              Decimal?       @map("annual_price") @db.Decimal(18, 4)
  currency                 String         @default("NGN")
  trialDays                Int            @default(14) @map("trial_days")
  isActive                 Boolean        @default(true) @map("is_active")
  isPublic                 Boolean        @default(true) @map("is_public")
  sortOrder                Int            @default(0) @map("sort_order")
  createdAt                DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt                DateTime       @default(now()) @map("updated_at") @db.Timestamptz(6)
  subscriptions            Subscription[]

  @@map("plans")
}`);

models.push(`/// A pharmacy's subscription (one per pharmacy).
model Subscription {
  id                       String         @id
  tenantId                 String         @unique @map("tenant_id")
  tenant                   Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  planId                   String         @map("plan_id")
  plan                     Plan           @relation(fields: [planId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  status                   String         // TRIAL | ACTIVE | PAST_DUE | GRACE | SUSPENDED | CANCELLED | EXPIRED
  billingCycle             String         @default("MONTHLY") @map("billing_cycle")
  trialEndsAt              DateTime?      @map("trial_ends_at") @db.Timestamptz(6)
  currentPeriodEnd         DateTime?      @map("current_period_end") @db.Timestamptz(6)
  createdAt                DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt                DateTime       @default(now()) @map("updated_at") @db.Timestamptz(6)

  @@index([planId])
  @@map("subscriptions")
}`);

models.unshift(`/// A pharmacy business on the platform. Every tenant-owned row points here.
model Tenant {
  id                       String         @id
  slug                     String         @unique
  name                     String
  status                   String         @default("ACTIVE") // ACTIVE | SUSPENDED | CLOSED
  businessEmail            String?        @map("business_email")
  businessPhone            String?        @map("business_phone")
  address                  String?
  country                  String         @default("NG")
  state                    String?
  currency                 String         @default("NGN")
  timeZone                 String         @default("Africa/Lagos") @map("time_zone")
  ownerUserId              String?        @map("owner_user_id")
  isDemo                   Boolean        @default(false) @map("is_demo")
  /// Set by self-service registration; a retry with the same key returns this tenant.
  registrationKey          String?        @unique(map: "tenants_registration_key_key") @map("registration_key")
  subscription             Subscription?
  statusReason             String?        @map("status_reason")
  statusChangedAt          DateTime?      @map("status_changed_at") @db.Timestamptz(6)
  supportGrants            SupportAccessGrant[]
  authTokens               AuthToken[]
  createdAt                DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt                DateTime       @default(now()) @map("updated_at") @db.Timestamptz(6)
${tenantBackRelations.join("\n")}

  @@map("tenants")
}`);

const header = `// GENERATED by scripts/prisma-schema.ts from lib/db/schema.ts — do not edit by hand.
// Application records are stored in PostgreSQL and accessed through Prisma's PostgreSQL driver adapter.
// Tenancy is enforced in the database by composite foreign keys and Row Level Security
// (see prisma/migrations/20261107100000_tenants and 20261107100100_tenant_rls).

datasource db {
  provider = "postgresql"
}

generator client {
  provider = "prisma-client-js"
}
`;
writeFileSync("prisma/schema.prisma", `${header}\n${models.join("\n\n")}\n`);
console.log(`Wrote prisma/schema.prisma (${models.length} models).`);
