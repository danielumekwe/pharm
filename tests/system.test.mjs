// SaaS phase 7E: system configuration: maintenance mode, registration and trial switches, platform-wide
// feature switches, upload limits, background job switches and "run now", system information and backups.
import assert from "node:assert/strict";
import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { Client, signedIn } from "./helpers/client.mjs";
import { startServer } from "./helpers/server.mjs";

const PASSWORD = "System-Settings-2026";
const CRON_SECRET = "cron-secret-for-system-tests";
const STAFF = {
  super: { id: "p-super", email: "super@web365.ng", role: "PLATFORM_SUPER_ADMIN" },
  technical: { id: "p-tech", email: "tech@web365.ng", role: "TECHNICAL_ADMIN" },
  support: { id: "p-support", email: "support@web365.ng", role: "PLATFORM_SUPPORT" },
};
const DEFAULTS = {
  maintenance: false, maintenanceMessage: "", registrationOpen: true, trialsEnabled: true, trialDaysOverride: null,
  features: { stock_transfers: true, regulatory_management: true }, maxDocumentMB: 5, documentTypes: ["pdf", "png", "jpeg"], maxLogoKB: 512,
  jobs: { alertJobs: true, emailQueue: true },
};

let server;

before(async () => {
  server = await startServer({ CRON_SECRET });
  for (const person of Object.values(STAFF)) {
    const salt = randomBytes(16).toString("hex");
    await server.query("INSERT INTO platform_users (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)", person.id, person.email, person.id, person.role, `${salt}:${pbkdf2Sync(PASSWORD, salt, 310000, 32, "sha256").toString("hex")}`);
  }
});
after(async () => {
  await server?.stop();
});

async function as(person) {
  const client = new Client(server.baseUrl);
  assert.equal((await client.post("/api/platform/login", { email: person.email, password: PASSWORD })).status, 200);
  return client;
}
const page = (client, path) => client.request("GET", path, undefined, { raw: true });
async function configure(value) {
  const result = await (await as(STAFF.technical)).request("PUT", "/api/platform/settings/system.config", { value: { ...DEFAULTS, ...value } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
}
const registration = (email, name = "Harbour Pharmacy") => fetch(`${server.baseUrl}/api/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    requestId: randomUUID(), businessName: name, businessEmail: `desk.${email}`, businessPhone: "0803 123 4567", ownerName: "Ada Obi", ownerEmail: email, ownerPhone: "0809 765 4321",
    address: "3 Marina Road, Lagos", country: "NG", state: "Lagos", currency: "NGN", timeZone: "Africa/Lagos", password: "Harbour2026", planId: "professional", billingCycle: "MONTHLY",
  }),
});

describe("Access", () => {
  test("Technical and Super Admins manage the system; others cannot", async () => {
    const support = await as(STAFF.support);
    assert.equal((await page(support, "/platform/settings/system")).status, 307);
    assert.equal((await support.request("PUT", "/api/platform/settings/system.config", { value: DEFAULTS })).status, 403);
    assert.equal((await support.post("/api/platform/system/jobs", { job: "email-queue" })).status, 403);
    const technical = await as(STAFF.technical);
    const html = await (await page(technical, "/platform/settings/system")).text();
    assert.match(html, /data-system-form/);
    assert.match(html, /data-system-info/);
    assert.match(html, /0\.1\.0/, "the version");
    assert.match(html, /data-database-size/);
    assert.equal((await technical.request("PUT", "/api/platform/settings/system.config", { value: { ...DEFAULTS, maxDocumentMB: 50 } })).status, 422);
  });
});

describe("Maintenance mode", () => {
  test("pauses pharmacy sign-in, pages and APIs with the message; the Control Centre keeps working", async () => {
    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    assert.equal((await admin.get("/api/products")).status, 200);
    await configure({ maintenance: true, maintenanceMessage: "Upgrading until 2 pm" });
    try {
      const blocked = await admin.get("/api/products");
      assert.deepEqual([blocked.status, blocked.data.error], [503, "Upgrading until 2 pm"]);
      const dashboard = await page(admin, "/dashboard");
      assert.ok([302, 307].includes(dashboard.status));
      assert.match(dashboard.headers.get("location"), /\/maintenance$/);
      assert.match(await (await fetch(`${server.baseUrl}/maintenance`)).text(), /Upgrading until 2 pm/);
      assert.match(await (await fetch(`${server.baseUrl}/`)).text(), /data-maintenance-banner/);
      const step1 = await fetch(`${server.baseUrl}/api/auth/pharmacies`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: "admin@web365.ng", password: "Admin@123" }) });
      assert.equal(step1.status, 503);
      assert.notEqual(await new Client(server.baseUrl).login("admin@web365.ng", "HQ"), null, "no new sign-in");
      assert.equal((await registration("ada@harbour.ng")).status, 503);
      assert.equal((await (await as(STAFF.super)).get("/api/platform/tenants")).status, 200, "the Control Centre works");
      const [refused] = await server.query("SELECT outcome, detail FROM sign_in_attempts WHERE surface = 'pharmacy' ORDER BY at DESC LIMIT 1");
      assert.deepEqual([refused.outcome, refused.detail], ["refused", "maintenance"]);
    } finally {
      await configure({});
    }
    assert.equal((await admin.get("/api/products")).status, 200, "back to normal");
  });
});

describe("Registration and trials", () => {
  test("closing registration stops self-service sign-ups, not pharmacies created by Web365", async () => {
    await configure({ registrationOpen: false });
    try {
      const closed = await registration("ada@harbour.ng");
      assert.equal(closed.status, 403);
      assert.match(await (await fetch(`${server.baseUrl}/register`)).text(), /data-registration-closed/);
      const created = await (await as(STAFF.super)).post("/api/platform/tenants", {
        businessName: "Created By Web365", businessEmail: "desk@created.ng", businessPhone: "0803 123 4567", ownerName: "Bisi Ade", ownerEmail: "bisi@created.ng", ownerPhone: "0809 765 4321",
        address: "1 Broad Street, Lagos", country: "NG", state: "Lagos", currency: "NGN", timeZone: "Africa/Lagos", planId: "professional", billingCycle: "MONTHLY",
      });
      assert.equal(created.status, 201, JSON.stringify(created.data));
    } finally {
      await configure({});
    }
  });

  test("trial length can be set for new pharmacies, or trials switched off", async () => {
    await configure({ trialDaysOverride: 30 });
    const long = await (await registration("ada@harbour.ng")).json();
    const [trial] = await server.query("SELECT status, trial_ends_at FROM subscriptions WHERE tenant_id = ?", long.tenantId);
    assert.equal(trial.status, "TRIAL");
    assert.equal(Math.round((new Date(trial.trial_ends_at) - Date.now()) / 86_400_000), 30);

    await configure({ trialsEnabled: false });
    const none = await (await registration("chi@noreef.ng", "No Reef Pharmacy")).json();
    const [paid] = await server.query("SELECT status FROM subscriptions WHERE tenant_id = ?", none.tenantId);
    assert.equal(paid.status, "EXPIRED", "must pay before using the system");
    assert.equal(server.outbox().filter((message) => message.to === "chi@noreef.ng" && /trial/i.test(message.subject)).length, 0, "no trial email");
    await configure({});
  });
});

describe("Feature switches and uploads", () => {
  test("a feature switched off is refused on the server for every pharmacy, whatever its plan", async () => {
    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    await configure({ features: { stock_transfers: false, regulatory_management: true } });
    try {
      const refused = await admin.post("/api/transfers", { fromOutletId: "outlet-1", toOutletId: "outlet-2", lines: [{ productId: "any-product", quantity: 1 }] });
      assert.equal(refused.status, 403);
      assert.match(refused.data.error, /Stock transfers is temporarily turned off by Web365/);
    } finally {
      await configure({});
    }
    const after = await admin.post("/api/transfers", { fromOutletId: "outlet-1", toOutletId: "outlet-2", lines: [{ productId: "any-product", quantity: 1 }] });
    assert.ok(!/turned off/.test(after.data?.error ?? ""), "switched back on");
  });

  test("document size and type limits come from the settings", async () => {
    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    const upload = (bytes, name, type) => {
      const form = new FormData();
      form.set("file", new File([bytes], name, { type }));
      form.set("title", "Premises licence");
      form.set("category", "PCN premises licence");
      form.set("relatedTo", "");
      return fetch(`${server.baseUrl}/api/regulatory/documents`, { method: "POST", headers: { cookie: admin.cookieHeader() }, body: form });
    };
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(100)]);
    await configure({ maxDocumentMB: 1, documentTypes: ["pdf"] });
    try {
      const wrongType = await upload(png, "licence.png", "image/png");
      assert.equal(wrongType.status, 400);
      assert.match((await wrongType.json()).error, /Only PDF files/);
      const big = await upload(Buffer.concat([Buffer.from("%PDF-1.4 "), Buffer.alloc(1_200_000)]), "licence.pdf", "application/pdf");
      assert.equal(big.status, 400);
      assert.match((await big.json()).error, /1 MB or smaller/);
    } finally {
      await configure({});
    }
    assert.ok((await upload(png, "licence.png", "image/png")).status < 300, "PNG allowed again");
  });
});

describe("Background jobs", () => {
  const cron = async () => (await fetch(`${server.baseUrl}/api/alerts/jobs`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } })).json();

  test("switched-off jobs are skipped on schedule (and logged), and can still be run by hand", async () => {
    await configure({ jobs: { alertJobs: false, emailQueue: false } });
    try {
      const result = await cron();
      assert.equal(result.pharmacies, 0, "alert jobs skipped");
      assert.equal(result.emailQueue.skipped, true);
      const skipped = await server.query("SELECT job, detail FROM platform_job_runs WHERE trigger = 'cron' ORDER BY started_at DESC LIMIT 2");
      assert.ok(skipped.every((run) => /Skipped: turned off/.test(run.detail)), JSON.stringify(skipped));
      const technical = await as(STAFF.technical);
      const manual = await technical.post("/api/platform/system/jobs", { job: "alert-jobs" });
      assert.equal(manual.status, 200, JSON.stringify(manual.data));
      assert.ok(manual.data.result.pharmacies >= 1);
      assert.equal((await technical.post("/api/platform/system/jobs", { job: "email-queue" })).data.result.due, 0);
      const html = await (await page(technical, "/platform/settings/system")).text();
      assert.match(html, /data-job-run="alert-jobs"/);
      assert.match(html, /manual/);
    } finally {
      await configure({});
    }
    assert.ok((await cron()).pharmacies >= 1, "running again on schedule");
  });
});

describe("Backups", () => {
  test("the dashboard warns until a backup is recorded; host backups can be noted; the history is append-only", async () => {
    const technical = await as(STAFF.technical);
    assert.match(await (await page(technical, "/platform")).text(), /data-health-item="Backups" data-status="warning"/);
    assert.equal((await technical.post("/api/platform/system/backups", { label: "Too late", takenAt: new Date(Date.now() + 86_400_000).toISOString() })).status, 400);
    const noted = await technical.post("/api/platform/system/backups", { label: "Neon branch before 7E", takenAt: new Date().toISOString(), location: "neon: pre-7e", note: "Before deploying" });
    assert.equal(noted.status, 201, JSON.stringify(noted.data));
    assert.match(await (await page(technical, "/platform")).text(), /data-health-item="Backups" data-status="ok"/);
    assert.match(await (await page(technical, "/platform/settings/system")).text(), /Neon branch before 7E/);
    for (const statement of ["UPDATE platform_backups SET label = 'x'", "DELETE FROM platform_backups"]) {
      await server.query("BEGIN");
      try {
        await server.query("SET LOCAL ROLE pharm_app");
        await assert.rejects(server.query(statement), (error) => error.code === "42501");
      } finally {
        await server.query("ROLLBACK");
      }
    }
  });
});
