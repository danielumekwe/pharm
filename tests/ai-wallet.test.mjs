// AI Wallet & Credit Management: welcome bonus, coin ledger, reservations and per-page charging in the AI
// Document Scanner, insufficient coins, idempotency, concurrent spending, Paystack coin purchases (verified,
// duplicate webhooks, wrong amount/currency, failures, reconciliation, refunds), Control Centre pricing,
// packages, limits, dashboards and provider costs, permissions and tenant isolation.
// Paystack and the AI provider are local stand-ins.
import assert from "node:assert/strict";
import { createHash, createHmac, pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, describe, test } from "node:test";
import { crc32, deflateSync } from "node:zlib";

import { Client, signedIn } from "./helpers/client.mjs";
import { startServer } from "./helpers/server.mjs";

const SECRET = "sk_test_fake_paystack_secret";
let server;
let admin; // demo pharmacy Super Admin
let ops; // Web365 platform super admin
let owner; // newly registered pharmacy
let pharmacy;

// ---------------------------------------------------------------- Paystack stand-in
const paystack = { transactions: new Map(), refunds: [] };
const fakePaystack = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    const send = (status, payload) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(payload));
    };
    if (request.headers.authorization !== `Bearer ${SECRET}`) return send(401, { status: false, message: "Invalid key" });
    if (request.method === "POST" && request.url === "/transaction/initialize") {
      const input = JSON.parse(body);
      paystack.transactions.set(input.reference, { ...input, status: "ongoing", id: paystack.transactions.size + 5000 });
      return send(200, { status: true, data: { authorization_url: `https://checkout.test/${input.reference}`, reference: input.reference } });
    }
    if (request.method === "POST" && request.url === "/refund") {
      const input = JSON.parse(body);
      paystack.refunds.push(input);
      return send(200, { status: true, data: { id: 77, status: "processed", amount: input.amount, currency: input.currency } });
    }
    const match = request.url.match(/^\/transaction\/verify\/(.+)$/);
    if (request.method === "GET" && match) {
      const transaction = paystack.transactions.get(decodeURIComponent(match[1]));
      if (!transaction) return send(404, { status: false, message: "Transaction reference not found" });
      return send(200, { status: true, data: { id: transaction.id, status: transaction.status, reference: transaction.reference, amount: transaction.paidAmount ?? transaction.amount, currency: transaction.paidCurrency ?? transaction.currency, channel: "card", fees: 3000, paid_at: new Date().toISOString(), gateway_response: transaction.status === "success" ? "Successful" : "Declined" } });
    }
    send(404, { status: false, message: "Not found" });
  });
});
const setOutcome = (reference, status, extra = {}) => Object.assign(paystack.transactions.get(reference), { status, ...extra });
const sign = (body) => createHmac("sha512", SECRET).update(body).digest("hex");
async function webhook(event) {
  const body = JSON.stringify(event);
  const response = await fetch(`${server.baseUrl}/api/billing/webhooks/paystack`, { method: "POST", headers: { "Content-Type": "application/json", "x-paystack-signature": sign(body) }, body });
  return { status: response.status, data: await response.json() };
}
const chargeSuccess = (reference, id = randomUUID()) => ({ event: "charge.success", data: { id, reference, status: "success", amount: 1, currency: "NGN" } });

// ---------------------------------------------------------------- AI provider stand-in
const readings = new Map();
const delays = new Map();
function png(seed, width = 420, height = 300) {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) raw[y * (width + 1) + 1 + x] = (seed * 37 + x * 3 + y * 11) & 255;
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const content = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(content) >>> 0);
    return Buffer.concat([length, content, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const days = (count) => new Date(Date.now() + count * 86_400_000).toISOString().slice(0, 10).split("-").reverse().join("/");
const reading = (handwriting = "none") => ({ page: { type: "expense_record", readable: true, handwriting, notes: "", transcription: "x" }, records: [{ kind: "expense", fields: { date: { value: days(-5), confidence: "high", read: "" }, description: { value: `Item ${randomUUID().slice(0, 6)}`, confidence: "high", read: "" }, amount: { value: "1000", confidence: "high", read: "" } }, region: { x: 0, y: 0, width: 1, height: 0.1 } }] });
let seed = 100;
function page(response, delayMs = 0) {
  const bytes = png(++seed);
  readings.set(sha(bytes), response);
  if (delayMs) delays.set(sha(bytes), delayMs);
  return bytes;
}
const fakeAi = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", async () => {
    const payload = JSON.parse(body);
    const image = payload.messages[0].content.find((block) => block.type === "image");
    const hash = sha(Buffer.from(image.source.data, "base64"));
    if (delays.has(hash)) await new Promise((resolve) => setTimeout(resolve, delays.get(hash)));
    const next = readings.get(hash);
    if (!next || next.status) {
      response.writeHead(next?.status ?? 400, { "content-type": "application/json" });
      return response.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Could not process image" } }));
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ id: `msg_${randomUUID()}`, type: "message", role: "assistant", model: payload.model, content: [{ type: "text", text: JSON.stringify(next) }], stop_reason: "end_turn", usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }));
  });
});

async function upload(client, jobId, bytes) {
  const form = new FormData();
  form.append("file", new Blob([bytes]), "page.png");
  const response = await fetch(`${server.baseUrl}/api/document-scans/${jobId}/pages`, { method: "POST", headers: { cookie: client.cookieHeader() }, body: form });
  return { status: response.status, data: await response.json() };
}
async function jobWithPages(client, pages, outletId = "outlet-1") {
  const job = (await client.post("/api/document-scans", { category: "expenses", outletId })).data;
  for (const bytes of pages) assert.equal((await upload(client, job.id, bytes)).status, 201);
  return job;
}
async function readAll(client, jobId) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const detail = (await client.get(`/api/document-scans/${jobId}`)).data;
    if (detail.status !== "PROCESSING") return detail;
    if (detail.needsWorker) await client.post(`/api/document-scans/${jobId}/process`, {});
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("still processing");
}
const wallet = async (client) => (await client.get("/api/ai-wallet")).data.wallet;
const ledgerFor = (tenantId) => server.query("SELECT type, amount, available_delta, reserved_delta, available_after, reserved_after, operation_code FROM ai_wallet_transactions WHERE tenant_id = ? ORDER BY seq", tenantId);

before(async () => {
  await new Promise((resolve) => fakePaystack.listen(0, "127.0.0.1", resolve));
  await new Promise((resolve) => fakeAi.listen(0, "127.0.0.1", resolve));
  server = await startServer({
    PAYSTACK_SECRET_KEY: SECRET,
    PAYSTACK_BASE_URL: `http://127.0.0.1:${fakePaystack.address().port}`,
    DOCUMENT_AI_PROVIDER: "anthropic",
    ANTHROPIC_API_KEY: "test-key",
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${fakeAi.address().port}`,
    DOCUMENT_SCAN_RETRY_SECONDS: "0",
  });
  admin = await signedIn(server.baseUrl, "admin@web365.ng");
  assert.equal((await admin.post("/api/document-scans/settings", { aiApproved: true })).status, 200);
  const salt = randomBytes(16).toString("hex");
  await server.query("INSERT INTO platform_users (id, email, name, role, password_hash) VALUES ('puser-ai', 'ai-ops@web365.ng', 'AI Ops', 'PLATFORM_SUPER_ADMIN', ?)", `${salt}:${pbkdf2Sync("Platform-AI-2026", salt, 310000, 32, "sha256").toString("hex")}`);
  ops = new Client(server.baseUrl);
  assert.equal((await ops.post("/api/platform/login", { email: "ai-ops@web365.ng", password: "Platform-AI-2026" })).status, 200);
});
after(async () => {
  if (process.env.DUMP_LOGS && server) (await import("node:fs")).writeFileSync(process.env.DUMP_LOGS, server.logs());
  await server?.stop();
  fakePaystack.close();
  fakeAi.close();
});

async function register(name, email) {
  const response = await fetch(`${server.baseUrl}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: randomUUID(), businessName: name, businessEmail: `hello@${email.split("@")[1]}`, businessPhone: "0803 123 4567", ownerName: "Owner Person", ownerEmail: email, ownerPhone: "0809 765 4321", address: "1 Test Road", country: "NG", state: "Lagos", currency: "NGN", timeZone: "Africa/Lagos", password: "Wallet2026Pass", planId: "professional", billingCycle: "MONTHLY" }),
  });
  const data = await response.json();
  assert.equal(response.status, 201, JSON.stringify(data));
  const client = new Client(server.baseUrl);
  assert.equal(await client.login(email, "HQ", "Wallet2026Pass"), null);
  return { client, tenantId: data.tenantId };
}

// ---------------------------------------------------------------- tests

describe("Welcome bonus", () => {
  test("a new pharmacy gets exactly the configured welcome coins, once, as its own ledger entry", async () => {
    ({ client: owner, tenantId: pharmacy } = await register("Coin Pharmacy", "owner@coin-pharmacy.ng"));
    const first = await wallet(owner);
    assert.equal(first.available, 500);
    assert.equal(first.freeTotal, 500);
    await wallet(owner);
    const ledger = await ledgerFor(pharmacy);
    assert.deepEqual(ledger.map((row) => [row.type, row.amount]), [["WELCOME_BONUS", 500]]);
    // More staff do not bring more coins: the bonus belongs to the pharmacy.
    const invited = await owner.post("/api/users", { name: "Second Person", email: "second@coin-pharmacy.ng", phone: "0803 000 0000", role: "STOCK_MANAGER", outletIds: [], outletId: null }).catch(() => null);
    assert.ok(invited);
    assert.equal((await ledgerFor(pharmacy)).length, 1);
    const [{ n }] = await server.query("SELECT COUNT(*)::int AS n FROM ai_wallet_transactions WHERE idempotency_key = ?", `welcome:${pharmacy}`);
    assert.equal(n, 1);
    const notes = await server.query("SELECT title FROM notifications WHERE tenant_id = ?", pharmacy);
    assert.ok(notes.some((row) => /500 AI coins added/.test(row.title)));
  });

  test("the bonus amount and promotion are controlled from the Control Centre", async () => {
    const saved = await ops.post("/api/platform/ai", { action: "settings", value: { welcomeBonusCoins: 300 } });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const second = await register("Second Coin Pharmacy", "owner@second-coin.ng");
    assert.equal((await wallet(second.client)).available, 300);
    await ops.post("/api/platform/ai", { action: "settings", value: { welcomeBonusEnabled: false } });
    const third = await register("Third Coin Pharmacy", "owner@third-coin.ng");
    assert.equal((await wallet(third.client)).available, 0);
    assert.deepEqual(await ledgerFor(third.tenantId), []);
    await ops.post("/api/platform/ai", { action: "settings", value: { welcomeBonusEnabled: true, welcomeBonusCoins: 500 } });
    const history = await server.query("SELECT changes FROM platform_settings_history WHERE key = 'ai.wallet' ORDER BY changed_at");
    assert.ok(history.length >= 3, "each change is recorded with who made it");
  });
});

describe("AI Document Scanner billing", () => {
  let tenantId;
  before(async () => {
    tenantId = "tenant-demo";
    await wallet(admin); // opens the demo wallet with its welcome bonus
  });

  test("the estimate is shown before processing; pages are charged as read and failures cost nothing", async () => {
    const job = await jobWithPages(admin, [page(reading("none")), page(reading("mostly")), page({ status: 400 })]);
    const detail = (await admin.get(`/api/document-scans/${job.id}`)).data;
    assert.deepEqual(detail.billing.prices, { standard: 100, additional: 100, handwritten: 150 });
    assert.equal(detail.billing.pages, 3);
    assert.equal(detail.billing.minimum, 300);
    assert.equal(detail.billing.reserve, 450);
    assert.equal(detail.billing.available, 500);
    assert.equal(detail.billing.sufficient, true);

    const started = await admin.post(`/api/document-scans/${job.id}/extract`, { coins: 1, price: 0 });
    assert.equal(started.status, 200, JSON.stringify(started.data));
    const done = await readAll(admin, job.id);
    assert.deepEqual(done.pages.map((entry) => entry.status), ["DONE", "DONE", "FAILED"]);
    const after = await wallet(admin);
    assert.equal(after.available, 250, "100 (first page) + 150 (handwritten page) + 0 (failed page)");
    assert.equal(after.reserved, 0);
    assert.equal(after.consumedTotal, 250);
    const ledger = (await ledgerFor(tenantId)).filter((row) => row.type !== "WELCOME_BONUS");
    assert.deepEqual(ledger.map((row) => [row.type, row.amount, row.operation_code]), [
      ["RESERVATION", 450, null],
      ["AI_USAGE", 100, "document.page.standard"],
      ["RESERVATION_RELEASE", 50, "document.page.standard"],
      ["AI_USAGE", 150, "document.page.handwritten"],
      ["RESERVATION_RELEASE", 150, null],
    ]);
    const usage = await server.query("SELECT status, input_tokens, output_tokens, cost::float8 AS cost, cost_basis, coins_charged, model, request_id FROM ai_usage WHERE job_id = ? ORDER BY created_at", job.id);
    assert.equal(usage.length, 3);
    assert.deepEqual(usage.map((row) => row.status), ["SUCCESS", "SUCCESS", "FAILED"]);
    assert.equal(usage[0].cost, 0.0108, "1200 input + 300 output tokens at $4 / $20 per million");
    assert.equal(usage[0].cost_basis, "estimated");
    assert.ok(usage[0].request_id);
    assert.equal(usage[2].cost_basis, "unavailable");
    assert.equal(usage[2].coins_charged, 0);
  });

  test("not enough coins: nothing is queued, sent or charged, with a clear message", async () => {
    const job = await jobWithPages(admin, [page(reading()), page(reading())]);
    const estimate = (await admin.get(`/api/document-scans/${job.id}`)).data.billing;
    assert.equal(estimate.reserve, 300);
    assert.equal(estimate.sufficient, false);
    const before = (await ledgerFor(tenantId)).length;
    const refused = await admin.post(`/api/document-scans/${job.id}/extract`, {});
    assert.equal(refused.status, 402);
    assert.equal(refused.data.error, "You do not have enough AI coins to process these documents. Please purchase additional coins.");
    assert.equal((await ledgerFor(tenantId)).length, before);
    const pages = await server.query("SELECT status FROM document_scan_pages WHERE job_id = ?", job.id);
    assert.ok(pages.every((row) => row.status === "UPLOADED"));
  });

  test("double clicks and repeated requests reserve and charge once; concurrent jobs cannot overspend", async () => {
    // 250 available: each one-page job reserves 150, so only one of two concurrent starts can succeed.
    const a = await jobWithPages(admin, [page(reading())]);
    const b = await jobWithPages(admin, [page(reading())]);
    const results = await Promise.all([admin.post(`/api/document-scans/${a.id}/extract`, {}), admin.post(`/api/document-scans/${a.id}/extract`, {}), admin.post(`/api/document-scans/${b.id}/extract`, {})]);
    const statuses = results.map((result) => result.status);
    await readAll(admin, a.id);
    await readAll(admin, b.id);
    const reservations = await server.query("SELECT job_id, coins_reserved FROM ai_reservations WHERE job_id IN (?, ?)", a.id, b.id);
    assert.equal(reservations.filter((row) => row.job_id === a.id).length <= 1, true, "job A reserved at most once");
    const reservedTotal = reservations.reduce((sum, row) => sum + Number(row.coins_reserved), 0);
    assert.ok(reservedTotal <= 250, `never more than the balance is reserved (${reservedTotal}); statuses ${statuses}`);
    assert.ok(statuses.includes(402), `one start is refused for lack of coins: ${statuses}`);
    const final = await wallet(admin);
    assert.ok(final.available >= 0 && final.reserved === 0);
    // Repeating an extraction of pages already read reserves nothing.
    const repeat = await admin.post(`/api/document-scans/${a.id}/extract`, {});
    assert.ok(repeat.status >= 400 || repeat.data.started === 0);
    // Reconciliation finds the ledger and balances in agreement and charges nothing twice.
    const run = await ops.post("/api/platform/ai", { action: "reconcile" });
    assert.equal(run.status, 200);
    assert.deepEqual(run.data.mismatches, []);
    assert.deepEqual(await wallet(admin), final);
  });

  test("the ledger cannot be edited or deleted, and balances never go negative", async () => {
    await assert.rejects(server.query("UPDATE ai_wallet_transactions SET amount = 1 WHERE tenant_id = 'tenant-demo'"), /immutable/);
    await assert.rejects(server.query("DELETE FROM ai_wallet_transactions WHERE tenant_id = 'tenant-demo'"), /immutable/);
    const tooMuch = await ops.post("/api/platform/ai", { action: "adjust", adjustment: { tenantId: "tenant-demo", coins: -999999, type: "ADJUSTMENT", reason: "Testing negative balances" } });
    assert.equal(tooMuch.status, 402);
    await assert.rejects(server.query("UPDATE ai_wallets SET available = -1 WHERE tenant_id = 'tenant-demo'"), /nonnegative/);
  });

  test("a price change applies to new work only; work already reserved keeps its price", async () => {
    await ops.post("/api/platform/ai", { action: "adjust", adjustment: { tenantId: "tenant-demo", coins: 1000, type: "PROMO_BONUS", reason: "Coins for the price test" } });
    const slow = await jobWithPages(admin, [page(reading(), 2500)]);
    assert.equal((await admin.post(`/api/document-scans/${slow.id}/extract`, {})).status, 200);
    const changed = await ops.post("/api/platform/ai", { action: "price", price: { code: "document.page.standard", name: "Standard document page", description: "", method: "PER_PAGE", coins: 120, enabled: true } });
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
    await readAll(admin, slow.id);
    const [charge] = await server.query("SELECT amount FROM ai_wallet_transactions WHERE type = 'AI_USAGE' AND related_id = ?", slow.id);
    assert.equal(charge.amount, 100, "charged at the price in force when the coins were reserved");
    const next = await jobWithPages(admin, [page(reading())]);
    assert.equal((await admin.get(`/api/document-scans/${next.id}`)).data.billing.prices.standard, 120);
    // Pharmacy override and the browser cannot change prices.
    await ops.post("/api/platform/ai", { action: "price", price: { code: "document.page.standard", tenantId: pharmacy, name: "Standard document page", description: "Launch discount", method: "PER_PAGE", coins: 80, enabled: true } });
    const ownerJob = (await owner.post("/api/document-scans", { category: "expenses", outletId: (await server.query("SELECT id FROM outlets WHERE tenant_id = ? LIMIT 1", pharmacy))[0].id })).data;
    assert.equal((await owner.get(`/api/document-scans/${ownerJob.id}`)).data.billing.prices.standard, 80);
    await ops.post("/api/platform/ai", { action: "price", price: { code: "document.page.standard", name: "Standard document page", description: "", method: "PER_PAGE", coins: 100, enabled: true } });
    const versions = await server.query("SELECT coins, effective_to FROM ai_operation_prices WHERE code = 'document.page.standard' AND tenant_id IS NULL ORDER BY effective_from");
    assert.deepEqual(versions.map((row) => [row.coins, row.effective_to === null]), [[100, false], [120, false], [100, true]]);
  });

  test("platform and pharmacy limits stop new paid jobs with an explanation", async () => {
    const two = await jobWithPages(admin, [page(reading()), page(reading())]);
    await ops.post("/api/platform/ai", { action: "limits", limits: { tenantId: null, maxDailyCost: null, maxMonthlyCost: null, maxJobsPerDay: null, maxPagesPerJob: 1, maxConcurrentJobs: 3, maxRequestsPerUserPerDay: null, paused: false } });
    const tooMany = await admin.post(`/api/document-scans/${two.id}/extract`, {});
    assert.equal(tooMany.status, 429);
    assert.match(tooMany.data.error, /At most 1 pages/);
    await ops.post("/api/platform/ai", { action: "limits", limits: { tenantId: "tenant-demo", maxDailyCost: null, maxMonthlyCost: null, maxJobsPerDay: null, maxPagesPerJob: null, maxConcurrentJobs: null, maxRequestsPerUserPerDay: null, paused: true } });
    const paused = await admin.post(`/api/document-scans/${two.id}/extract`, {});
    assert.equal(paused.status, 429);
    assert.match(paused.data.error, /paused/);
    await ops.post("/api/platform/ai", { action: "remove-limits", tenantId: "tenant-demo" });
    await ops.post("/api/platform/ai", { action: "limits", limits: { tenantId: null, maxDailyCost: 0.00001, maxMonthlyCost: null, maxJobsPerDay: null, maxPagesPerJob: 60, maxConcurrentJobs: 3, maxRequestsPerUserPerDay: null, paused: false } });
    const spent = await admin.post(`/api/document-scans/${two.id}/extract`, {});
    assert.equal(spent.status, 429);
    assert.match(spent.data.error, /spending limit/);
    await ops.post("/api/platform/ai", { action: "limits", limits: { tenantId: null, maxDailyCost: null, maxMonthlyCost: null, maxJobsPerDay: null, maxPagesPerJob: 60, maxConcurrentJobs: 3, maxRequestsPerUserPerDay: null, paused: false } });
    assert.equal((await admin.post(`/api/document-scans/${two.id}/extract`, {})).status, 200);
    await readAll(admin, two.id);
  });

  test("cancelling a job returns its held coins", async () => {
    const slow = await jobWithPages(admin, [page(reading(), 4000)]);
    const before = await wallet(admin);
    await admin.post(`/api/document-scans/${slow.id}/extract`, {});
    assert.equal((await wallet(admin)).reserved, before.reserved + 150);
    await new Promise((resolve) => setTimeout(resolve, 500));
    // Cancel while the page is still being read: the hold is released; the late reading is not charged.
    await admin.post(`/api/document-scans/${slow.id}/actions`, { action: "cancel", reason: "test" });
    assert.equal((await wallet(admin)).reserved, before.reserved);
    await new Promise((resolve) => setTimeout(resolve, 4500));
    const after = await wallet(admin);
    assert.equal(after.available, before.available, "nothing was charged for the cancelled job");
  });
});

describe("Paystack coin purchases", () => {
  let packageId;
  before(async () => {
    const packages = (await ops.get("/api/platform/ai?view=packages")).data;
    const starter = packages.find((entry) => entry.name === "Starter");
    assert.equal(starter.active, false, "packages are not on sale until an administrator activates them");
    assert.deepEqual((await owner.get("/api/ai-wallet")).data.packages, []);
    const saved = await ops.post("/api/platform/ai", { action: "package", package: { ...starter, bonusCoins: 100, active: true, promoStartsAt: null, promoEndsAt: null } });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    packageId = starter.id;
  });

  const buy = async (client = owner, extra = {}) => client.post("/api/ai-wallet/purchases", { packageId, ...extra });

  test("only a verified payment credits the wallet, exactly once, at the server's price", async () => {
    const started = await buy(owner, { coins: 999999, amount: 1, tenantId: "tenant-demo" });
    assert.equal(started.status, 200, JSON.stringify(started.data));
    const { reference } = started.data;
    const sent = paystack.transactions.get(reference);
    assert.equal(sent.amount, 200000, "₦2,000 in kobo, from the package — not from the browser");
    assert.equal(sent.metadata.tenantId, pharmacy);
    const before = await wallet(owner);
    // Pending: not credited.
    const pending = await owner.request("GET", `/ai-wallet/callback?reference=${reference}`, undefined, { raw: true });
    assert.ok(pending.status === 200 || pending.status === 307);
    assert.equal((await wallet(owner)).available, before.available);
    assert.equal((await webhook(chargeSuccess(reference))).status, 500, "an unconfirmed payment is retried later");
    // Paid: credited by the webhook, once.
    setOutcome(reference, "success");
    const event = chargeSuccess(reference);
    const credited = await webhook(event);
    assert.equal(credited.data.result, "ai-coins:credited", JSON.stringify(credited));
    assert.equal((await webhook(event)).data.duplicate, true);
    assert.equal((await webhook(chargeSuccess(reference))).data.result, "ai-coins:already");
    await owner.request("GET", `/ai-wallet/callback?reference=${reference}`, undefined, { raw: true });
    const after = await wallet(owner);
    assert.equal(after.available, before.available + 600, "500 coins + 100 promotional bonus");
    assert.equal(after.purchasedTotal, 500);
    const [purchase] = await server.query("SELECT status, fees::float8 AS fees, credited_at FROM ai_coin_purchases WHERE reference = ?", reference);
    assert.equal(purchase.status, "SUCCESS");
    assert.equal(purchase.fees, 30);
    const entries = await server.query("SELECT type, amount FROM ai_wallet_transactions WHERE related_type = 'CoinPurchase' AND tenant_id = ? ORDER BY seq", pharmacy);
    assert.deepEqual(entries.map((row) => [row.type, row.amount]), [["PURCHASE", 500], ["PROMO_BONUS", 100]]);
  });

  test("wrong amount, wrong currency and failed payments credit nothing", async () => {
    const before = await wallet(owner);
    const short = (await buy()).data.reference;
    setOutcome(short, "success", { paidAmount: 100 });
    assert.equal((await webhook(chargeSuccess(short))).data.result, "ai-coins:rejected");
    const dollars = (await buy()).data.reference;
    setOutcome(dollars, "success", { paidCurrency: "USD" });
    assert.equal((await webhook(chargeSuccess(dollars))).data.result, "ai-coins:rejected");
    const declined = (await buy()).data.reference;
    setOutcome(declined, "failed");
    await owner.request("GET", `/ai-wallet/callback?reference=${declined}`, undefined, { raw: true });
    assert.equal((await wallet(owner)).available, before.available);
    const statuses = await server.query("SELECT reference, status FROM ai_coin_purchases WHERE reference IN (?, ?, ?)", short, dollars, declined);
    assert.ok(statuses.every((row) => row.status === "FAILED"));
    const notes = await server.query("SELECT title FROM notifications WHERE tenant_id = ?", pharmacy);
    assert.ok(notes.some((row) => /did not go through/.test(row.title)));
  });

  test("a paid purchase whose credit never arrived is recovered by reconciliation without paying again", async () => {
    const before = await wallet(owner);
    const reference = (await buy()).data.reference;
    setOutcome(reference, "success"); // paid, but no webhook arrives and the payer never returns
    const run = await ops.post("/api/platform/ai", { action: "reconcile" });
    assert.equal(run.status, 200);
    assert.ok(run.data.actions.some((action) => action.includes(reference) && action.includes("credited")), JSON.stringify(run.data));
    assert.equal((await wallet(owner)).available, before.available + 600);
    await ops.post("/api/platform/ai", { action: "reconcile" });
    assert.equal((await wallet(owner)).available, before.available + 600, "reconciling again changes nothing");
  });

  test("a refund returns the money and removes the coins with a reversing entry", async () => {
    const [purchase] = await server.query("SELECT id, reference FROM ai_coin_purchases WHERE tenant_id = ? AND status = 'SUCCESS' ORDER BY created_at DESC LIMIT 1", pharmacy);
    const before = await wallet(owner);
    const refunded = await ops.post("/api/platform/ai", { action: "refund", purchaseId: purchase.id, reason: "Customer bought the wrong package" });
    assert.equal(refunded.status, 200, JSON.stringify(refunded.data));
    assert.equal(paystack.refunds.at(-1).transaction, purchase.reference);
    assert.equal((await wallet(owner)).available, before.available - 600);
    const [row] = await server.query("SELECT status FROM ai_coin_purchases WHERE id = ?", purchase.id);
    assert.equal(row.status, "REFUNDED");
  });

  test("staff buy coins only when allowed", async () => {
    const manager = await signedIn(server.baseUrl, "manager@web365.ng");
    assert.equal((await manager.get("/api/ai-wallet")).status, 200, "the pharmacy manager can see the wallet");
    assert.equal((await manager.post("/api/ai-wallet/purchases", { packageId })).status, 403);
    const stock = await signedIn(server.baseUrl, "stock.lekki@web365.ng", "outlet-1");
    assert.equal((await stock.post("/api/ai-wallet/purchases", { packageId })).status, 403);
    const cashier = await signedIn(server.baseUrl, "cashier@web365.ng", "outlet-1");
    assert.equal((await cashier.get("/api/ai-wallet")).status, 403);
  });
});

describe("Control Centre: AI Usage & Billing", () => {
  test("dashboard figures come from the ledger, purchases and provider usage", async () => {
    const dashboard = (await ops.get("/api/platform/ai")).data;
    const [ledger] = await server.query("SELECT COALESCE(SUM(amount) FILTER (WHERE type = 'AI_USAGE'), 0)::int AS consumed, COALESCE(SUM(amount) FILTER (WHERE type = 'PURCHASE'), 0)::int AS purchased FROM ai_wallet_transactions");
    assert.equal(dashboard.coins.consumed, ledger.consumed);
    assert.equal(dashboard.coins.purchased, ledger.purchased);
    assert.equal(dashboard.money.revenue, 2000, "two ₦2,000 purchases, one refunded; free coins are not revenue");
    assert.equal(dashboard.money.fees, 60);
    assert.equal(dashboard.money.grossProfit, null, "no profit is shown until the USD→NGN rate is configured");
    assert.ok(dashboard.provider.cost > 0);
    assert.ok(dashboard.jobs.successfulRequests > 0 && dashboard.jobs.failedRequests > 0);
    await ops.post("/api/platform/ai", { action: "settings", value: { usdToNgnRate: 1500 } });
    const priced = (await ops.get("/api/platform/ai")).data;
    assert.ok(Math.abs(priced.money.costNgn - priced.provider.cost * 1500) < 1e-6);
    assert.ok(Math.abs(priced.money.grossProfit - (2000 - 60 - priced.provider.cost * 1500)) < 0.01);
    const costs = (await ops.get("/api/platform/ai?view=costs")).data;
    assert.ok(costs.byModel.some((row) => row.key === "claude-opus-5-5" && row.cost > 0));
    assert.ok(costs.recent.every((row) => row.basis === "estimated" || row.cost === null));
    const tenants = (await ops.get("/api/platform/ai?view=tenants")).data;
    const coin = tenants.find((row) => row.tenantId === pharmacy);
    assert.equal(coin.available, (await wallet(owner)).available);
    const detail = (await ops.get(`/api/platform/ai?view=tenant&id=${pharmacy}`)).data;
    assert.ok(detail.transactions.length > 0 && detail.purchases.length > 0);
    assert.ok(!JSON.stringify(detail).includes("Item "), "no document content in the Control Centre");
  });

  test("only platform staff with the AI permissions can see or change it", async () => {
    assert.equal((await admin.get("/api/platform/ai")).status, 401);
    const salt = randomBytes(16).toString("hex");
    await server.query("INSERT INTO platform_users (id, email, name, role, password_hash) VALUES ('puser-support', 'support-ai@web365.ng', 'Support', 'PLATFORM_SUPPORT', ?)", `${salt}:${pbkdf2Sync("Platform-AI-2026", salt, 310000, 32, "sha256").toString("hex")}`);
    const support = new Client(server.baseUrl);
    assert.equal((await support.post("/api/platform/login", { email: "support-ai@web365.ng", password: "Platform-AI-2026" })).status, 200);
    assert.equal((await support.get("/api/platform/ai")).status, 200);
    assert.equal((await support.post("/api/platform/ai", { action: "adjust", adjustment: { tenantId: pharmacy, coins: 100, type: "PROMO_BONUS", reason: "Not allowed for support" } })).status, 403);
  });
});

describe("Screens", () => {
  test("the AI Wallet, the scanner estimate and the Control Centre section render for the right people", async () => {
    const walletPage = await owner.request("GET", "/ai-wallet", undefined, { raw: true });
    assert.equal(walletPage.status, 200);
    const html = await walletPage.text();
    for (const text of ["AI Wallet", "Available coins", "Reserved coins", "Buy coins", "View Transaction History", "View AI Usage", "View Pricing"]) assert.ok(html.includes(text), text);
    const job = await jobWithPages(admin, [page(reading())]);
    const scanner = await (await admin.request("GET", `/data-migration/scanner/${job.id}`, undefined, { raw: true })).text();
    assert.match(scanner, /Estimated cost/);
    const consolePage = await ops.request("GET", "/platform/ai", undefined, { raw: true });
    assert.equal(consolePage.status, 200);
    const consoleHtml = await consolePage.text();
    for (const text of ["AI Usage &amp; Billing", "Coins issued", "Coin sales revenue", "Estimated gross profit", "How these figures are worked out"]) assert.ok(consoleHtml.includes(text), text);
    const detail = await ops.request("GET", `/platform/ai/tenants/${pharmacy}`, undefined, { raw: true });
    assert.equal(detail.status, 200);
    assert.match(await detail.text(), /Coin ledger/);
    const cashier = await signedIn(server.baseUrl, "cashier@web365.ng", "outlet-1");
    assert.equal((await cashier.request("GET", "/ai-wallet", undefined, { raw: true })).status, 307);
  });
});

describe("Tenant isolation", () => {
  test("one pharmacy never sees another pharmacy's wallet, ledger or purchases", async () => {
    const mine = (await owner.get("/api/ai-wallet/transactions")).data;
    assert.ok(mine.rows.length > 0);
    const demo = (await admin.get("/api/ai-wallet/transactions?pageSize=100")).data;
    const ownRefs = new Set(mine.rows.map((row) => row.reference));
    assert.ok(demo.rows.every((row) => !ownRefs.has(row.reference)));
    const demoOverview = (await admin.get("/api/ai-wallet")).data;
    assert.ok(demoOverview.purchases.every((row) => !row.reference.includes(pharmacy.replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase())));
    const filtered = (await owner.get("/api/ai-wallet/transactions?type=PURCHASE")).data;
    assert.ok(filtered.rows.every((row) => row.type === "PURCHASE"));
    const html = await (await owner.request("GET", "/ai-wallet", undefined, { raw: true })).text();
    assert.ok(!html.includes("sk_test_") && !html.includes("test-key"), "no provider secret reaches the browser");
  });
});
