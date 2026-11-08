// Announcements from Web365 to pharmacies (all, or by plan, subscription status or named pharmacies), and the
// knowledge base of help articles. Pharmacies see published announcements meant for them as a banner until
// each person dismisses one; publishing can also email the Pharmacy Super Admins.
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { platformQuery } from "@/lib/db/database";
import { DomainError } from "@/lib/erp/services";
import { platformActorRef, recordPlatformAudit } from "@/lib/platform/audit";
import type { PlatformActor } from "@/lib/platform/session";
import { readPlatformSetting } from "@/lib/platform/settings";
import { notifyPharmacyOwners } from "@/lib/saas/account-email";

export const audienceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all") }),
  z.object({ type: z.literal("plans"), ids: z.array(z.string().min(1).max(40)).min(1).max(20) }),
  z.object({ type: z.literal("statuses"), ids: z.array(z.enum(["TRIAL", "ACTIVE", "GRACE", "PAST_DUE", "EXPIRED", "CANCELLED", "SUSPENDED"])).min(1) }),
  z.object({ type: z.literal("tenants"), ids: z.array(z.string().min(1).max(80)).min(1).max(500) }),
]);
export type Audience = z.infer<typeof audienceSchema>;

export const announcementSchema = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(3).max(2000),
  severity: z.enum(["info", "warning", "critical"]),
  audience: audienceSchema,
  startsAt: z.string().datetime().nullable(),
  endsAt: z.string().datetime().nullable(),
  emailOwners: z.boolean(),
}).refine((value) => !value.startsAt || !value.endsAt || Date.parse(value.endsAt) > Date.parse(value.startsAt), { path: ["endsAt"], message: "The end must be after the start." });

type Row = { id: string; title: string; body: string; severity: string; audience: Audience; status: string; starts_at: Date | null; ends_at: Date | null; email_owners: boolean; emailed_at: Date | null; created_by_name: string; created_at: Date; published_at: Date | null; reads?: string };
const iso = (value: Date | null) => (value ? new Date(value).toISOString() : null);
const view = (row: Row) => ({
  id: row.id, title: row.title, body: row.body, severity: row.severity, audience: row.audience, status: row.status, startsAt: iso(row.starts_at), endsAt: iso(row.ends_at),
  emailOwners: row.email_owners, emailedAt: iso(row.emailed_at), createdBy: row.created_by_name, createdAt: iso(row.created_at)!, publishedAt: iso(row.published_at), reads: Number(row.reads ?? 0),
});

/** SQL condition: the audience (a jsonb expression) includes the pharmacy (a text expression). */
const audienceMatch = (audience: string, tenant: string) => `(
  ${audience}->>'type' = 'all'
  OR (${audience}->>'type' = 'tenants' AND ${audience}->'ids' ? ${tenant})
  OR (${audience}->>'type' = 'plans' AND ${audience}->'ids' ? (SELECT plan_id FROM subscriptions WHERE tenant_id = ${tenant}))
  OR (${audience}->>'type' = 'statuses' AND ${audience}->'ids' ? (SELECT status FROM subscriptions WHERE tenant_id = ${tenant}))
)`;
const AUDIENCE_MATCH = audienceMatch("a.audience", "$1");
const LIVE = `a.status = 'PUBLISHED' AND (a.starts_at IS NULL OR a.starts_at <= now()) AND (a.ends_at IS NULL OR a.ends_at > now())`;

export async function listAnnouncements() {
  const rows = await platformQuery<Row[]>((query) => query(`SELECT a.*, (SELECT count(*) FROM announcement_reads r WHERE r.announcement_id = a.id) AS reads FROM announcements a ORDER BY a.created_at DESC LIMIT 100`));
  return rows.map(view);
}

/** How many pharmacies an audience reaches now. */
export async function audienceSize(audience: Audience) {
  const [row] = await platformQuery<Array<{ n: string }>>((query) =>
    query(`SELECT count(*) AS n FROM tenants t WHERE t.status = 'ACTIVE' AND ${audienceMatch("$1::jsonb", "t.id")}`, [JSON.stringify(audience)]),
  );
  return Number(row?.n ?? 0);
}

export async function saveAnnouncement(actor: PlatformActor, id: string | null, input: z.infer<typeof announcementSchema>) {
  if (id) {
    const [existing] = await platformQuery<Array<{ status: string }>>((query) => query(`SELECT status FROM announcements WHERE id = $1`, [id]));
    if (!existing) throw new DomainError("Announcement not found.", 404);
    if (existing.status === "ARCHIVED") throw new DomainError("An archived announcement cannot be changed.", 409);
    await platformQuery((query) =>
      query(`UPDATE announcements SET title = $1, body = $2, severity = $3, audience = $4, starts_at = $5, ends_at = $6, email_owners = $7, updated_at = now() WHERE id = $8`, [input.title, input.body, input.severity, JSON.stringify(input.audience), input.startsAt, input.endsAt, input.emailOwners, id]),
    );
  } else {
    id = `ann-${randomUUID()}`;
    await platformQuery((query) =>
      query(`INSERT INTO announcements (id, title, body, severity, audience, starts_at, ends_at, email_owners, created_by, created_by_name) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [id, input.title, input.body, input.severity, JSON.stringify(input.audience), input.startsAt, input.endsAt, input.emailOwners, actor.id, actor.name]),
    );
  }
  await recordPlatformAudit(platformActorRef(actor), { action: "content.announcement-save", targetType: "Announcement", targetId: id, summary: `Saved announcement "${input.title}"` });
  return { ok: true, id };
}

/** Publishes (shown at once, within its dates) and, if asked, emails each pharmacy's Super Admins once. */
export async function publishAnnouncement(actor: PlatformActor, id: string) {
  const [row] = await platformQuery<Row[]>((query) => query(`SELECT * FROM announcements WHERE id = $1`, [id]));
  if (!row) throw new DomainError("Announcement not found.", 404);
  if (row.status !== "DRAFT") throw new DomainError(`It is already ${row.status.toLowerCase()}.`, 409);
  await platformQuery((query) => query(`UPDATE announcements SET status = 'PUBLISHED', published_at = now(), updated_at = now() WHERE id = $1`, [id]));
  let emailed = 0;
  let skipped: string | null = null;
  if (row.email_owners) {
    const switches = await readPlatformSetting("notifications.global").catch(() => null);
    if (switches && !switches.value.announcementEmails) skipped = "announcement emails are switched off";
    else {
      const tenants = await platformQuery<Array<{ id: string }>>((query) => query(`SELECT t.id FROM tenants t WHERE t.status = 'ACTIVE' AND NOT t.is_demo AND ${audienceMatch("$1::jsonb", "t.id")}`, [JSON.stringify(row.audience)]));
      for (const tenant of tenants) {
        await notifyPharmacyOwners(tenant.id, "system_announcement", { title: row.title, message: row.body }, "platform").catch(() => undefined);
        emailed += 1;
      }
      await platformQuery((query) => query(`UPDATE announcements SET emailed_at = now() WHERE id = $1`, [id]));
    }
  }
  await recordPlatformAudit(platformActorRef(actor), { action: "content.announcement-publish", targetType: "Announcement", targetId: id, summary: `Published announcement "${row.title}"${row.email_owners ? (skipped ? ` (not emailed: ${skipped})` : `, emailed to ${emailed} pharmacies`) : ""}` });
  return { ok: true, emailed, skipped };
}

export async function archiveAnnouncement(actor: PlatformActor, id: string) {
  const rows = await platformQuery<Array<{ title: string }>>((query) => query(`UPDATE announcements SET status = 'ARCHIVED', updated_at = now() WHERE id = $1 AND status <> 'ARCHIVED' RETURNING title`, [id]));
  if (!rows.length) throw new DomainError("Announcement not found or already archived.", 404);
  await recordPlatformAudit(platformActorRef(actor), { action: "content.announcement-archive", targetType: "Announcement", targetId: id, summary: `Archived announcement "${rows[0].title}"` });
  return { ok: true };
}

/** Pharmacy side: live announcements for this pharmacy that this person has not dismissed. */
export async function announcementsFor(tenantId: string, userId: string) {
  const rows = await platformQuery<Row[]>((query) =>
    query(
      `SELECT a.* FROM announcements a WHERE ${LIVE} AND ${AUDIENCE_MATCH}
         AND NOT EXISTS (SELECT 1 FROM announcement_reads r WHERE r.announcement_id = a.id AND r.user_id = $2 AND r.tenant_id = $1)
       ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, a.published_at DESC LIMIT 5`,
      [tenantId, userId],
    ),
  );
  return rows.map((row) => ({ id: row.id, title: row.title, body: row.body, severity: row.severity }));
}

export async function dismissAnnouncement(tenantId: string, userId: string, id: string) {
  const [visible] = await platformQuery<Array<{ id: string }>>((query) => query(`SELECT a.id FROM announcements a WHERE a.id = $2 AND ${LIVE} AND ${AUDIENCE_MATCH}`, [tenantId, id]));
  if (!visible) throw new DomainError("Announcement not found.", 404);
  await platformQuery((query) => query(`INSERT INTO announcement_reads (announcement_id, user_id, tenant_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [id, userId, tenantId]));
  return { ok: true };
}

// ── Knowledge base ───────────────────────────────────────────────────────────────────────────────────────

export const articleSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,79}$/, "Use lowercase letters, digits and dashes."),
  title: z.string().trim().min(3).max(140),
  category: z.string().trim().min(2).max(60),
  body: z.string().trim().min(10).max(20_000),
  published: z.boolean(),
  sortOrder: z.number().int().min(0).max(10_000),
});

type ArticleRow = { id: string; slug: string; title: string; category: string; body: string; published: boolean; sort_order: number; updated_at: Date; updated_by: string | null };
const article = (row: ArticleRow) => ({ id: row.id, slug: row.slug, title: row.title, category: row.category, body: row.body, published: row.published, sortOrder: row.sort_order, updatedAt: iso(row.updated_at)!, updatedBy: row.updated_by });

export async function listArticles(options: { publishedOnly: boolean; q?: string }) {
  const q = options.q?.trim().toLowerCase();
  const rows = await platformQuery<ArticleRow[]>((query) =>
    query(
      `SELECT * FROM kb_articles WHERE ($1::boolean = false OR published) AND ($2::text IS NULL OR lower(title) LIKE $2 OR lower(body) LIKE $2 OR lower(category) LIKE $2) ORDER BY category, sort_order, title`,
      [options.publishedOnly, q ? `%${q.replace(/[\\%_]/g, (character) => `\\${character}`)}%` : null],
    ),
  );
  return rows.map(article);
}

export async function articleBySlug(slug: string, publishedOnly: boolean) {
  const [row] = await platformQuery<ArticleRow[]>((query) => query(`SELECT * FROM kb_articles WHERE slug = $1 AND ($2::boolean = false OR published)`, [slug, publishedOnly]));
  return row ? article(row) : null;
}

export async function saveArticle(actor: PlatformActor, id: string | null, input: z.infer<typeof articleSchema>) {
  const [taken] = await platformQuery<Array<{ id: string }>>((query) => query(`SELECT id FROM kb_articles WHERE slug = $1 AND ($2::text IS NULL OR id <> $2)`, [input.slug, id]));
  if (taken) throw new DomainError("Another article already uses that address.", 409);
  if (id) {
    const rows = await platformQuery<Array<{ id: string }>>((query) =>
      query(`UPDATE kb_articles SET slug = $1, title = $2, category = $3, body = $4, published = $5, sort_order = $6, updated_at = now(), updated_by = $7 WHERE id = $8 RETURNING id`, [input.slug, input.title, input.category, input.body, input.published, input.sortOrder, actor.name, id]),
    );
    if (!rows.length) throw new DomainError("Article not found.", 404);
  } else {
    id = `kb-${randomUUID()}`;
    await platformQuery((query) =>
      query(`INSERT INTO kb_articles (id, slug, title, category, body, published, sort_order, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [id, input.slug, input.title, input.category, input.body, input.published, input.sortOrder, actor.name]),
    );
  }
  await recordPlatformAudit(platformActorRef(actor), { action: "content.article-save", targetType: "KbArticle", targetId: id, summary: `Saved help article "${input.title}"${input.published ? " (published)" : " (draft)"}` });
  return { ok: true, id };
}

export async function deleteArticle(actor: PlatformActor, id: string) {
  const rows = await platformQuery<Array<{ title: string }>>((query) => query(`DELETE FROM kb_articles WHERE id = $1 RETURNING title`, [id]));
  if (!rows.length) throw new DomainError("Article not found.", 404);
  await recordPlatformAudit(platformActorRef(actor), { action: "content.article-delete", targetType: "KbArticle", targetId: id, summary: `Deleted help article "${rows[0].title}"` });
  return { ok: true };
}
