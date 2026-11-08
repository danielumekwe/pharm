// SaaS phase 7F: support tickets, announcements, the knowledge base, branding, notification switches and the
// integrations page.
import assert from "node:assert/strict";
import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { Client, signedIn } from "./helpers/client.mjs";
import { startServer } from "./helpers/server.mjs";

const PASSWORD = "Helpdesk-Tests-2026";
const STAFF = {
  super: { id: "p-super", email: "super@web365.ng", role: "PLATFORM_SUPER_ADMIN" },
  support: { id: "p-support", email: "support@web365.ng", role: "PLATFORM_SUPPORT" },
  billing: { id: "p-billing", email: "billing@web365.ng", role: "BILLING_ADMIN" },
  technical: { id: "p-tech", email: "tech@web365.ng", role: "TECHNICAL_ADMIN" },
};
const OWNER = { email: "ngozi@sunrise.ng", password: "Sunrise2026" };

let server;
let sunrise;

before(async () => {
  server = await startServer();
  for (const person of Object.values(STAFF)) {
    const salt = randomBytes(16).toString("hex");
    await server.query("INSERT INTO platform_users (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)", person.id, person.email, person.id, person.role, `${salt}:${pbkdf2Sync(PASSWORD, salt, 310000, 32, "sha256").toString("hex")}`);
  }
  const response = await fetch(`${server.baseUrl}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId: randomUUID(), businessName: "Sunrise Pharmacy", businessEmail: "hello@sunrise.ng", businessPhone: "0803 123 4567", ownerName: "Ngozi Okafor", ownerEmail: OWNER.email,
      ownerPhone: "0809 765 4321", address: "12 Allen Avenue, Ikeja", country: "NG", state: "Lagos", currency: "NGN", timeZone: "Africa/Lagos", password: OWNER.password, planId: "professional", billingCycle: "MONTHLY",
    }),
  });
  sunrise = JSON.parse(await response.text());
});
after(async () => {
  await server?.stop();
});

async function as(person) {
  const client = new Client(server.baseUrl);
  assert.equal((await client.post("/api/platform/login", { email: person.email, password: PASSWORD })).status, 200);
  return client;
}
async function owner() {
  const client = new Client(server.baseUrl);
  assert.equal(await client.login(OWNER.email, "HQ", OWNER.password), null);
  return client;
}
const page = (client, path) => client.request("GET", path, undefined, { raw: true });
const setting = async (key, value) => assert.equal((await (await as(STAFF.super)).request("PUT", `/api/platform/settings/${key}`, { value })).status, 200);
async function appRoleRefuses(statement) {
  await server.query("BEGIN");
  try {
    await server.query("SET LOCAL ROLE pharm_app");
    await assert.rejects(server.query(statement), (error) => error.code === "42501");
  } finally {
    await server.query("ROLLBACK");
  }
}

describe("Support tickets", () => {
  let ticketId;

  test("pharmacy users open tickets; each person sees their own, managers see the pharmacy's, other pharmacies none", async () => {
    const cashier = await signedIn(server.baseUrl, "cashier@web365.ng", "outlet-1");
    assert.equal((await cashier.post("/api/support/tickets", { category: "BUG", subject: "x", message: "too short" })).status, 422);
    const opened = await cashier.post("/api/support/tickets", { category: "BUG", subject: "Receipt printer stopped", message: "Since this morning nothing prints at Lekki." });
    assert.equal(opened.status, 201, JSON.stringify(opened.data));
    ticketId = opened.data.ticket.id;
    assert.deepEqual([opened.data.ticket.priority, opened.data.ticket.status], ["HIGH", "OPEN"], "a bug starts as high priority");
    const manager = await signedIn(server.baseUrl, "manager@web365.ng");
    assert.ok((await manager.get("/api/support/tickets")).data.tickets.some((ticket) => ticket.id === ticketId), "managers see all of the pharmacy's");
    const colleague = await signedIn(server.baseUrl, "outlet@web365.ng", "outlet-1");
    assert.equal((await colleague.get("/api/support/tickets")).data.tickets.length, 0, "others see only their own");
    assert.equal((await colleague.get(`/api/support/tickets/${ticketId}`)).status, 404);
    const other = await owner();
    assert.equal((await other.get(`/api/support/tickets/${ticketId}`)).status, 404, "another pharmacy cannot open it");
    assert.equal((await other.get("/api/support/tickets")).data.tickets.length, 0);
    assert.match(await (await page(cashier, "/support")).text(), /Receipt printer stopped/);
  });

  test("Web365 support answers: internal notes stay internal, replies are emailed, and statuses follow the conversation", async () => {
    assert.equal((await (await as(STAFF.billing)).get("/api/platform/tickets")).status, 403);
    assert.equal((await (await as(STAFF.technical)).get("/api/platform/tickets")).status, 403);
    const staff = await as(STAFF.support);
    const queue = await staff.get("/api/platform/tickets");
    assert.ok(queue.data.tickets.some((ticket) => ticket.id === ticketId));
    assert.equal(queue.data.counts.waitingOnUs, 1);
    assert.equal((await staff.post(`/api/platform/tickets/${ticketId}`, { message: "Printer model is an old Epson; check driver.", internal: true })).status, 200);
    assert.equal((await staff.post(`/api/platform/tickets/${ticketId}`, { message: "Please restart the print service and tell us if it works." })).status, 200);

    const cashier = await signedIn(server.baseUrl, "cashier@web365.ng", "outlet-1");
    const thread = await cashier.get(`/api/support/tickets/${ticketId}`);
    assert.equal(thread.data.ticket.status, "WAITING_CUSTOMER");
    assert.deepEqual(thread.data.messages.map((message) => message.author_type), ["pharmacy", "platform"], "the internal note is not shown");
    assert.ok(!JSON.stringify(thread.data).includes("old Epson"));
    const mail = server.outbox().filter((message) => message.to === "cashier@web365.ng").at(-1);
    assert.match(mail.subject, /Re: \[Ticket #\d+\] Receipt printer stopped/);
    assert.match(mail.text, new RegExp(`/support/${ticketId}`));
    assert.ok(!mail.text.includes("old Epson"));

    assert.equal((await cashier.post(`/api/support/tickets/${ticketId}`, { message: "Restarted, still nothing." })).status, 200);
    const [row] = await server.query("SELECT status, last_reply_by, assigned_to FROM support_tickets WHERE id = ?", ticketId);
    assert.deepEqual([row.status, row.last_reply_by, row.assigned_to], ["OPEN", "pharmacy", STAFF.support.id], "back with Web365, assigned to whoever answered");
    assert.equal((await staff.request("PATCH", `/api/platform/tickets/${ticketId}`, { status: "RESOLVED", priority: "URGENT" })).status, 200);
    assert.equal((await staff.request("PATCH", `/api/platform/tickets/${ticketId}`, { assignedTo: "nobody-like-this" })).status, 400);
    assert.match(await (await page(staff, `/platform/tickets/${ticketId}`)).text(), /data-message="internal"/);
    assert.equal((await staff.get(`/api/platform/tickets?status=RESOLVED&mine=${STAFF.support.id}`)).data.tickets.length, 1);
  });

  test("ticket messages cannot be edited or deleted by the application", async () => {
    await appRoleRefuses("UPDATE support_messages SET body = 'x'");
    await appRoleRefuses("DELETE FROM support_messages");
    await appRoleRefuses("DELETE FROM support_tickets");
  });
});

describe("Announcements", () => {
  const draft = (client, body) => client.post("/api/platform/announcements", { title: "Maintenance on Sunday", body: "The system is unavailable 01:00–02:00.", severity: "warning", startsAt: null, endsAt: null, emailOwners: false, ...body });

  test("an announcement reaches only its audience once published, is emailed if chosen, and can be dismissed", async () => {
    const staff = await as(STAFF.support);
    assert.equal((await draft(await as(STAFF.billing), { audience: { type: "all" } })).status, 403);
    assert.equal((await staff.post("/api/platform/announcements/audience", { type: "tenants", ids: [sunrise.tenantId] })).data.pharmacies, 1);
    const created = await draft(staff, { audience: { type: "tenants", ids: [sunrise.tenantId] }, emailOwners: true });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const client = await owner();
    assert.equal((await client.get("/api/announcements")).data.announcements.length, 0, "a draft is not shown");
    const published = await staff.post(`/api/platform/announcements/${created.data.id}`, { action: "publish" });
    assert.deepEqual([published.status, published.data.emailed], [200, 1]);
    assert.ok(server.outbox().some((message) => message.to === OWNER.email && message.subject === "Maintenance on Sunday"));
    assert.deepEqual((await client.get("/api/announcements")).data.announcements.map((item) => item.title), ["Maintenance on Sunday"]);
    const demo = await signedIn(server.baseUrl, "admin@web365.ng");
    assert.equal((await demo.get("/api/announcements")).data.announcements.length, 0, "not for other pharmacies");
    assert.equal((await demo.request("DELETE", `/api/announcements/${created.data.id}`)).status, 404);
    assert.equal((await client.request("DELETE", `/api/announcements/${created.data.id}`)).status, 200);
    assert.equal((await client.get("/api/announcements")).data.announcements.length, 0, "dismissed");
    assert.equal((await staff.get("/api/platform/announcements")).data.announcements.find((item) => item.id === created.data.id).reads, 1);
  });

  test("scheduled ones wait for their start; archived ones disappear; emails respect the switch", async () => {
    const staff = await as(STAFF.support);
    const later = await draft(staff, { title: "Later", audience: { type: "all" }, startsAt: new Date(Date.now() + 86_400_000).toISOString() });
    await staff.post(`/api/platform/announcements/${later.data.id}`, { action: "publish" });
    const now = await draft(staff, { title: "Now for everyone", audience: { type: "all" } });
    await staff.post(`/api/platform/announcements/${now.data.id}`, { action: "publish" });
    const demo = await signedIn(server.baseUrl, "admin@web365.ng");
    assert.deepEqual((await demo.get("/api/announcements")).data.announcements.map((item) => item.title), ["Now for everyone"]);
    assert.equal((await staff.post(`/api/platform/announcements/${now.data.id}`, { action: "archive" })).status, 200);
    assert.equal((await demo.get("/api/announcements")).data.announcements.length, 0);

    await setting("notifications.global", { pharmacyAlertEmails: true, pushNotifications: true, billingEmails: true, announcementEmails: false });
    const quiet = await draft(staff, { title: "Not emailed", audience: { type: "all" }, emailOwners: true });
    const result = await staff.post(`/api/platform/announcements/${quiet.data.id}`, { action: "publish" });
    assert.deepEqual([result.data.emailed, result.data.skipped], [0, "announcement emails are switched off"]);
    await setting("notifications.global", { pharmacyAlertEmails: true, pushNotifications: true, billingEmails: true, announcementEmails: true });
  });
});

describe("Knowledge base", () => {
  test("only published articles are shown; their text is never treated as HTML", async () => {
    const staff = await as(STAFF.support);
    assert.equal((await (await as(STAFF.billing)).post("/api/platform/articles", {})).status, 403);
    const article = { slug: "printing-receipts", title: "Printing receipts", category: "Point of sale", body: "Use a thermal printer.\n\n<script>alert(1)</script> See https://example.com/printers", published: false, sortOrder: 1 };
    const created = await staff.post("/api/platform/articles", article);
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal((await staff.post("/api/platform/articles", { ...article, title: "Duplicate" })).status, 409);
    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    assert.ok(!(await (await page(admin, "/help")).text()).includes("Printing receipts"), "a draft is hidden");
    assert.equal((await page(admin, "/help/printing-receipts")).status, 404);
    assert.equal((await staff.request("PUT", `/api/platform/articles/${created.data.id}`, { ...article, published: true })).status, 200);
    assert.match(await (await page(admin, "/help?q=thermal")).text(), /Printing receipts/);
    assert.match(await (await page(admin, "/help?q=nothing-like-this")).text(), /data-help-empty/);
    const html = await (await page(admin, "/help/printing-receipts")).text();
    assert.ok(!html.includes("<script>alert(1)</script>"), "escaped");
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /<a href="https:\/\/example\.com\/printers"/);
  });
});

describe("Branding, notification switches and integrations", () => {
  test("the product name and support address from branding are used in emails", async () => {
    await setting("branding.app", { appName: "Web365 Pharmacy", supportEmail: "help@web365.ng", supportPhone: "0700 365 0000", loginTagline: "" });
    const client = new Client(server.baseUrl);
    await client.post("/api/auth/password/forgot", { email: OWNER.email });
    const mail = server.outbox().filter((message) => message.to === OWNER.email).at(-1);
    assert.match(`${mail.subject}\n${mail.text}`, /Web365 Pharmacy/);
    assert.match(await (await page(await owner(), "/support")).text(), /help@web365\.ng/);
  });

  test("alert emails switched off are logged as not sent", async () => {
    await setting("notifications.global", { pharmacyAlertEmails: false, pushNotifications: true, billingEmails: true, announcementEmails: true });
    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    assert.equal((await admin.patch("/api/alerts/config", { action: "email", enabled: true, maxRetries: 0, recipients: ["procurement@example.com"] })).status, 200);
    assert.equal((await admin.patch("/api/alerts/thresholds", { productId: "prod-8", minStock: 140, maxStock: null })).status, 200);
    let rows = [];
    for (let tries = 0; tries < 50 && !rows.length; tries += 1) {
      rows = await server.query("SELECT status, last_error FROM email_deliveries WHERE category = 'pharmacy'");
      if (!rows.length) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.ok(rows.length, "the alert email was attempted");
    assert.ok(rows.every((row) => row.status === "SKIPPED" && /switched off by Web365/.test(row.last_error)), JSON.stringify(rows));
    await setting("notifications.global", { pharmacyAlertEmails: true, pushNotifications: true, billingEmails: true, announcementEmails: true });
  });

  test("the integrations page shows real status only", async () => {
    assert.equal((await page(await as(STAFF.support), "/platform/integrations")).status, 307);
    const html = await (await page(await as(STAFF.technical), "/platform/integrations")).text();
    assert.match(html, /data-integration="Paystack" data-status="not_configured"/);
    assert.match(html, /data-integration="Push notifications \(Firebase\)" data-status="not_configured"/);
    assert.match(html, /data-integration="Email" data-status="configured"/, "test outbox: set up, not confirmed");
    assert.ok(!html.includes('data-status="connected"'), "nothing claims to be connected without a check");
  });
});
