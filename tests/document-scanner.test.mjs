// AI Document Scanner: upload validation, AI consent, background reading with retries, proofreading,
// approval, import through the existing workflows (inventory import + stock ledger, historical sales, expenses,
// suppliers), duplicates, reports, permissions, audit and tenant isolation.
//
// The AI provider is a local stand-in for the Anthropic Messages API (ANTHROPIC_BASE_URL): it answers with
// the reading prepared for each test image, or with an error, so every path is exercised without sending
// anything outside this machine.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { after, before, describe, test } from "node:test";
import { crc32, deflateSync } from "node:zlib";

import { signedIn } from "./helpers/client.mjs";
import { startServer } from "./helpers/server.mjs";

let server;
let admin;
let mock;
const readings = new Map(); // image sha256 → { status?, body? } list (one per call; the last one repeats)
const calls = [];

// ---------------------------------------------------------------- helpers

/** A real PNG (grayscale) whose pixels depend on `seed`, so every test image is different. */
function png(seed, width = 420, height = 300) {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0;
    for (let x = 0; x < width; x += 1) raw[y * (width + 1) + 1 + x] = (seed * 31 + x * 7 + y * 13 + ((x * y) % 17)) & 255;
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // grayscale
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const f = (value, confidence = "high", read) => ({ value: String(value), confidence, read: read ?? String(value) });
const none = () => ({ value: "", confidence: "not_detected", read: "" });
const page = (type, records, notes = "") => ({ page: { type, readable: true, notes, transcription: "(transcription)" }, records });
const days = (count) => new Date(Date.now() + count * 86_400_000).toISOString().slice(0, 10);
const dmy = (iso) => iso.split("-").reverse().join("/");

/** Image whose reading the mock returns (in order, the last one repeating). */
let seed = 0;
function image(...responses) {
  const bytes = png(++seed);
  readings.set(sha(bytes), responses);
  return bytes;
}

async function upload(client, jobId, bytes, name = "page.png", extra = {}) {
  const form = new FormData();
  form.append("file", new Blob([bytes]), name);
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  const response = await fetch(`${server.baseUrl}/api/document-scans/${jobId}/pages`, { method: "POST", headers: { cookie: client.cookieHeader() }, body: form });
  return { status: response.status, data: await response.json() };
}

async function newJob(client, body) {
  const created = await client.post("/api/document-scans", body);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  return created.data;
}

/** Waits for the background reading started by "extract" (and nudges the queue like the review screen does). */
async function readAll(client, jobId) {
  const deadline = Date.now() + 60_000;
  let detail;
  while (Date.now() < deadline) {
    detail = (await client.get(`/api/document-scans/${jobId}`)).data;
    if (detail.status !== "PROCESSING") return detail;
    if (detail.needsWorker) await client.post(`/api/document-scans/${jobId}/process`, {});
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Job ${jobId} still processing: ${JSON.stringify(detail?.pages)}`);
}

async function extracted(client, jobId) {
  const started = await client.post(`/api/document-scans/${jobId}/extract`, {});
  assert.equal(started.status, 200, JSON.stringify(started.data));
  return readAll(client, jobId);
}

const byName = (detail, text) => detail.records.find((record) => record.summary.includes(text));

before(async () => {
  mock = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const payload = JSON.parse(body || "{}");
      const imageBlock = payload.messages?.[0]?.content?.find((block) => block.type === "image");
      const hash = imageBlock ? sha(Buffer.from(imageBlock.source.data, "base64")) : "";
      calls.push({ path: request.url, headers: request.headers, apiKey: request.headers["x-api-key"], beta: request.headers["anthropic-beta"], model: payload.model, fallbacks: payload.fallbacks, format: payload.output_config?.format?.type, hash, text: payload.messages?.[0]?.content?.find((block) => block.type === "text")?.text ?? "" });
      const queue = readings.get(hash) ?? [{ status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "unknown test image" } } }];
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next.status) {
        response.writeHead(next.status, { "content-type": "application/json" });
        response.end(JSON.stringify(next.body ?? { type: "error", error: { type: "api_error", message: "test failure" } }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "msg_test", type: "message", role: "assistant", model: payload.model, content: [{ type: "text", text: JSON.stringify(next) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 300 } }));
    });
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  server = await startServer({
    DOCUMENT_AI_PROVIDER: "anthropic",
    ANTHROPIC_API_KEY: "test-key-not-real",
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${mock.address().port}`,
    DOCUMENT_SCAN_RETRY_SECONDS: "0",
  });
  admin = await signedIn(server.baseUrl, "admin@web365.ng");
});
after(async () => {
  await server?.stop();
  mock?.close();
});

// ---------------------------------------------------------------- tests

describe("Data Import Centre pages", () => {
  test("the centre, a job and the job history render for scanners and are refused to others", async () => {
    const hub = await admin.request("GET", "/data-migration", undefined, { raw: true });
    assert.equal(hub.status, 200);
    const html = await hub.text();
    for (const text of ["Data Import Centre", "AI Document Scanner", "Scan Inventory Records", "Scan Historical Sales Records", "Scan Expense Records", "Scan Supplier Records", "View Previous Scanning Jobs"]) assert.ok(html.includes(text), text);
    const history = await admin.request("GET", "/data-migration/scanner/history", undefined, { raw: true });
    assert.equal(history.status, 200);
    assert.match(await history.text(), /Scanning Jobs/);
    const cashier = await signedIn(server.baseUrl, "cashier@web365.ng", "outlet-1");
    assert.equal((await cashier.request("GET", "/data-migration", undefined, { raw: true })).status, 307);
    assert.equal((await cashier.get("/api/document-scans")).status, 403);
    assert.equal((await cashier.post("/api/document-scans", { category: "sales", outletId: "outlet-1" })).status, 403);
  });
});

describe("AI consent and upload safety", () => {
  test("pages are not sent anywhere until the Super Administrator approves AI reading", async () => {
    const settings = await admin.get("/api/document-scans/settings");
    assert.equal(settings.status, 200);
    assert.equal(settings.data.providerConfigured, true);
    assert.equal(settings.data.aiApproved, false);
    const job = await newJob(admin, { category: "expenses", outletId: "outlet-1", title: "Consent check" });
    assert.equal((await upload(admin, job.id, image(page("expense_record", [])))).status, 201);
    const refused = await admin.post(`/api/document-scans/${job.id}/extract`, {});
    assert.equal(refused.status, 403);
    assert.match(refused.data.error, /not yet approved/);
    assert.equal(calls.length, 0, "nothing was sent to the AI provider");

    const stockManager = await signedIn(server.baseUrl, "stock.lekki@web365.ng", "outlet-1");
    assert.equal((await stockManager.post("/api/document-scans/settings", { aiApproved: true })).status, 403, "only the Super Administrator approves");
    const approved = await admin.post("/api/document-scans/settings", { aiApproved: true });
    assert.equal(approved.status, 200);
    assert.equal(approved.data.aiApproved, true);
    const [audit] = await server.query("SELECT summary FROM audit_events WHERE action = 'documents.ai-approval' ORDER BY at DESC LIMIT 1");
    assert.match(audit.summary, /Approved sending scanned paper records to the AI provider \(anthropic/);
  });

  test("only real JPEG/PNG images of a sensible size are accepted, and the same photo only once", async () => {
    const job = await newJob(admin, { category: "inventory", outletId: "outlet-1", stockMode: "opening" });
    const text = await upload(admin, job.id, Buffer.from("this is not an image, just text pretending"), "fake.jpg");
    assert.equal(text.status, 415);
    const pdfAsPage = await upload(admin, job.id, Buffer.from("%PDF-1.7\n1 0 obj\n"), "scan.pdf");
    assert.equal(pdfAsPage.status, 415);
    const tiny = await upload(admin, job.id, png(999, 120, 90));
    assert.equal(tiny.status, 400);
    assert.match(tiny.data.error, /too small/);
    const bytes = image(page("inventory_list", []));
    assert.equal((await upload(admin, job.id, bytes)).status, 201);
    const again = await upload(admin, job.id, bytes);
    assert.equal(again.status, 409);
    const big = new Uint8Array(4 * 1024 * 1024 + 200 * 1024);
    const oversized = await upload(admin, job.id, big);
    assert.equal(oversized.status, 413);
    const stored = await server.query("SELECT count(*)::int AS n FROM document_scan_pages WHERE job_id = ?", job.id);
    assert.equal(stored[0].n, 1);
    // An inventory job must say what its quantities mean.
    assert.equal((await admin.post("/api/document-scans", { category: "inventory", outletId: "outlet-1" })).status, 400);
  });
});

describe("Inventory records", () => {
  let job;
  let existing;
  let stockBefore;
  let detail;

  before(async () => {
    [existing] = await server.query("SELECT id, name, strength, stock FROM products WHERE outlet_id = 'outlet-1' AND stock > 0 ORDER BY name LIMIT 1");
    stockBefore = existing.stock;
    job = await newJob(admin, { category: "inventory", outletId: "outlet-1", stockMode: "opening", title: "Stock book 2025", note: "Prices are per tablet" });
    const expiry = dmy(days(500));
    const record = (fields) => ({ kind: "inventory", fields, region: { x: 0.05, y: 0.1, width: 0.9, height: 0.06 } });
    const page1 = image(
      page("inventory_list", [
        // A product already in the catalogue: a person must confirm the match.
        record({ name: f(existing.name), strength: none(), dosageForm: f("Tab", "high", "Tab"), quantity: f("40"), purchasePrice: f("50"), sellingPrice: f("80"), batchNumber: f("SCAN-B1"), expiryDate: f(expiry) }),
        // A new product with a hard-to-read quantity.
        record({ name: f("Scanomycin Syrup"), strength: f("125mg/5ml"), dosageForm: f("Syr", "high", "Syr"), quantity: f("2O", "low", "2O"), purchasePrice: f("900"), sellingPrice: f("1300"), batchNumber: f("SCN-7781"), expiryDate: f(expiry) }),
      ]),
    );
    const page2 = image(
      page("inventory_list", [
        record({ name: f("Scanoprofen Tablets"), strength: f("400mg"), dosageForm: f("Tablet"), quantity: f("100"), purchasePrice: f("12"), sellingPrice: f("20"), batchNumber: f("SPF-1"), expiryDate: f(expiry), packSize: none() }),
        // Written twice in the book.
        record({ name: f("Scanoprofen Tablets"), strength: f("400mg"), dosageForm: f("Tablet"), quantity: f("100"), purchasePrice: f("12"), sellingPrice: f("20"), batchNumber: f("SPF-1"), expiryDate: f(expiry) }),
      ]),
    );
    assert.equal((await upload(admin, job.id, page1, "stock-book-1.jpg")).status, 201);
    assert.equal((await upload(admin, job.id, page2, "stock-book-2.jpg")).status, 201);
    detail = await extracted(admin, job.id);
  });

  test("pages are read in the background with the configured model, structured output and fallbacks", async () => {
    assert.equal(detail.status, "AWAITING_REVIEW", JSON.stringify(detail.pages));
    assert.equal(detail.records.length, 4);
    const sent = calls.filter((call) => call.text.includes("Inventory records"));
    assert.ok(sent.length >= 2);
    for (const call of sent) {
      assert.equal(call.headers.authorization, "Bearer test-key-not-real");
      assert.equal(call.model, "claude-opus-5-5");
      assert.equal(call.format, "json_schema");
      assert.equal(call.fallbacks, "default");
      assert.match(call.beta, /server-side-fallback-2026-07-01/);
      assert.match(call.path, /^\/v1\/messages/);
    }
    assert.ok(sent.some((call) => call.text.includes("Prices are per tablet")), "the user's note is passed as context");
    assert.equal(detail.reconciliation.pagesProcessed, 2);
  });

  test("readings keep confidence, expand clear abbreviations, never fill in blanks, and flag problems", async () => {
    const syrup = byName(detail, "Scanomycin");
    assert.equal(syrup.fields.dosageForm.value, "Syrup");
    assert.equal(syrup.fields.dosageForm.read, "Syr");
    assert.equal(syrup.fields.quantity.confidence, "low");
    assert.ok(syrup.blocked);
    assert.ok(syrup.issues.some((issue) => issue.field === "quantity" && /hard to read/.test(issue.message)));
    const known = byName(detail, existing.name);
    assert.equal(known.fields.strength.value, "");
    assert.equal(known.fields.strength.confidence, "none");
    assert.ok(known.candidates.some((candidate) => candidate.id === existing.id), "the existing product is offered as a match");
    assert.ok(known.blocked, "a possible match must be decided by a person");
    const [first, second] = detail.records.filter((record) => record.summary.includes("Scanoprofen"));
    assert.equal(first.duplicateOf, null);
    assert.ok(second.duplicateOf, "the repeated line is flagged as a possible duplicate");
    assert.ok(second.region && second.region.width > 0, "records carry where they are on the page");
  });

  test("blocked records cannot be approved, and approval needs the approve permission", async () => {
    const syrup = byName(detail, "Scanomycin");
    const refused = await admin.post(`/api/document-scans/${job.id}/actions`, { action: "approve", ids: [syrup.id] });
    assert.equal(refused.status, 409);
    assert.match(refused.data.error, /unresolved problems/);
    const stockManager = await signedIn(server.baseUrl, "stock.lekki@web365.ng", "outlet-1");
    const view = await stockManager.get(`/api/document-scans/${job.id}`);
    assert.equal(view.status, 200, "outlet scanners can open their outlet's job");
    assert.equal((await stockManager.post(`/api/document-scans/${job.id}/actions`, { action: "approve", allValid: true })).status, 403);
    const manager = await signedIn(server.baseUrl, "manager@web365.ng");
    assert.equal((await manager.post(`/api/document-scans/${job.id}/actions`, { action: "approve", allValid: true })).status, 403, "the pharmacy manager does not approve migrations by default");
  });

  test("corrections, confirmations and product decisions resolve the problems", async () => {
    const stockManager = await signedIn(server.baseUrl, "stock.lekki@web365.ng", "outlet-1");
    const syrup = byName(detail, "Scanomycin");
    const known = byName(detail, existing.name);
    const [, duplicate] = detail.records.filter((record) => record.summary.includes("Scanoprofen"));
    const saved = await stockManager.patch(`/api/document-scans/${job.id}/records`, {
      updates: [
        { id: syrup.id, edits: { quantity: "20" }, product: { action: "create" } },
        { id: known.id, product: { action: "match", productId: existing.id } },
      ],
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const fixed = saved.data.records.find((record) => record.id === syrup.id);
    assert.equal(fixed.fields.quantity.value, "20");
    assert.equal(fixed.fields.quantity.confidence, "confirmed");
    assert.equal(fixed.fields.quantity.read, "2O", "the text as written is kept");
    assert.equal(fixed.corrected, true);
    assert.equal(fixed.blocked, false, JSON.stringify(fixed.issues));
    assert.equal(saved.data.records.find((record) => record.id === known.id).blocked, false);
    const rejected = await stockManager.post(`/api/document-scans/${job.id}/actions`, { action: "reject", ids: [duplicate.id], reason: "Written twice in the book" });
    assert.equal(rejected.status, 200);
    detail = rejected.data;
    const audit = await server.query("SELECT action FROM audit_events WHERE entity_id = ? ORDER BY at", job.reference);
    assert.ok(audit.some((row) => row.action === "documents.scan.correct"));
    assert.ok(audit.some((row) => row.action === "documents.scan.reject"));
  });

  test("approval and import stage an ordinary inventory import; stock changes only when it is confirmed, through the ledger", async () => {
    const approved = await admin.post(`/api/document-scans/${job.id}/actions`, { action: "approve", allValid: true });
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    assert.equal(approved.data.reconciliation.approved, 3);
    assert.equal(approved.data.status, "APPROVED");
    const imported = await admin.post(`/api/document-scans/${job.id}/actions`, { action: "import" });
    assert.equal(imported.status, 200, JSON.stringify(imported.data));
    const staged = imported.data.inventoryImport;
    assert.ok(staged?.id);
    assert.equal(imported.data.status, "IMPORTING");
    // Nothing has touched stock yet: the import waits for its normal confirmation.
    assert.equal((await server.query("SELECT stock FROM products WHERE id = ?", existing.id))[0].stock, stockBefore);
    const importDetail = await admin.get(`/api/inventory-imports/${staged.id}`);
    assert.equal(importDetail.status, 200);
    assert.equal(importDetail.data.status, "PREVIEWED");
    assert.equal(importDetail.data.kind, "both");
    // Importing again is refused while the import is staged.
    assert.equal((await admin.post(`/api/document-scans/${job.id}/actions`, { action: "import" })).status, 400);

    let last;
    for (let chunk = importDetail.data.nextChunk ?? 0; chunk < importDetail.data.chunkCount; chunk += 1) {
      last = await admin.post(`/api/inventory-imports/${staged.id}/commit`, { confirm: true, token: importDetail.data.preview.token, chunk });
      assert.equal(last.status, 200, JSON.stringify(last.data));
    }
    const after = (await server.query("SELECT stock FROM products WHERE id = ?", existing.id))[0].stock;
    assert.equal(after, stockBefore + 40, "the matched product's stock grew by the scanned batch; it was not overwritten");
    const batch = await server.query("SELECT b.batch_number, b.available_quantity FROM batches b WHERE b.product_id = ? AND b.batch_number = 'SCAN-B1'", existing.id);
    assert.equal(batch.length, 1);
    const ledger = await server.query("SELECT type FROM stock_ledger WHERE batch_id IN (SELECT id FROM batches WHERE batch_number IN ('SCAN-B1', 'SCN-7781', 'SPF-1'))");
    assert.ok(ledger.length >= 3 && ledger.every((row) => row.type === "OPENING"), JSON.stringify(ledger));
    const created = await server.query("SELECT name, dosage_form FROM products WHERE name IN ('Scanomycin Syrup', 'Scanoprofen Tablets') AND outlet_id = 'outlet-1'");
    assert.equal(created.length, 2);
    const verify = await admin.get("/api/stock-ledger?verify=1");
    assert.deepEqual(verify.data.mismatches, []);

    const done = (await admin.get(`/api/document-scans/${job.id}`)).data;
    assert.equal(done.status, "COMPLETED");
    assert.equal(done.reconciliation.imported, 3);
    assert.equal(done.reconciliation.rejected, 1);
    const report = await admin.request("GET", `/api/document-scans/${job.id}/report`, undefined, { raw: true });
    assert.equal(report.status, 200);
    const csv = await report.text();
    for (const text of [job.reference, "Imported", "Rejected", "Written twice in the book", "stock-book-1.jpg", "Approved by"]) assert.ok(csv.includes(text), text);
    const [{ name }] = await server.query("SELECT name FROM users WHERE email = 'admin@web365.ng'");
    assert.ok(csv.includes(name), "the approver is named");
  });

  test("scanning the same page again is caught as a duplicate of the earlier import", async () => {
    const again = await newJob(admin, { category: "inventory", outletId: "outlet-1", stockMode: "opening" });
    const expiry = dmy(days(500));
    await upload(admin, again.id, image(page("inventory_list", [{ kind: "inventory", fields: { name: f("Scanoprofen Tablets"), strength: f("400mg"), dosageForm: f("Tablet"), quantity: f("100"), purchasePrice: f("12"), sellingPrice: f("20"), batchNumber: f("SPF-1"), expiryDate: f(expiry) }, region: { x: 0, y: 0, width: 1, height: 0.1 } }])));
    const read = await extracted(admin, again.id);
    const [record] = read.records;
    assert.equal(record.duplicateOf, job.reference);
    assert.ok(record.issues.some((issue) => /already imported by scanning job/.test(issue.message)));
    assert.equal((await admin.post(`/api/document-scans/${again.id}/actions`, { action: "approve", allValid: true })).status, 400);
  });
});

describe("Historical sales records", () => {
  test("individual sales and daily totals keep their dates, move no stock, take no payment and cannot be voided", async () => {
    const job = await newJob(admin, { category: "sales", outletId: "outlet-1", title: "Sales register March" });
    const saleDay = days(-40);
    const totalDay = days(-41);
    const line = (product, qty, price, total, extra = {}) => ({ kind: "sale", fields: { date: f(dmy(saleDay)), receiptNumber: f("R-101"), productName: f(product), quantity: f(qty), unitPrice: f(price), lineTotal: f(total), paymentMethod: f("Cash"), ...extra }, region: { x: 0, y: 0.2, width: 1, height: 0.05 } });
    await upload(
      admin,
      job.id,
      image(
        page("sales_register", [
          line("Scanoprofen Tablets", 2, 20, 40),
          line("Vitamin C 100mg", 1, 150, 150),
          { kind: "daily_sales", fields: { date: f(dmy(totalDay)), totalSales: f("56000"), cashTotal: f("30000"), transferTotal: f("26000") }, region: { x: 0, y: 0.8, width: 1, height: 0.05 } },
          // Dated today: belongs at the till, not in history.
          { kind: "sale", fields: { date: f(dmy(days(0))), productName: f("Cough syrup"), quantity: f(1), lineTotal: f(900) }, region: { x: 0, y: 0.9, width: 1, height: 0.05 } },
        ]),
      ),
    );
    const detail = await extracted(admin, job.id);
    assert.equal(detail.records.length, 4);
    const today = detail.records.find((record) => record.summary.includes("Cough syrup"));
    assert.ok(today.blocked);
    assert.ok(today.issues.some((issue) => /till/.test(issue.message)));

    const [ledgerBefore] = await server.query("SELECT count(*)::int AS n FROM stock_ledger");
    const [paymentsBefore] = await server.query("SELECT count(*)::int AS n FROM payments");
    const [notificationsBefore] = await server.query("SELECT count(*)::int AS n FROM notifications");
    const stockBefore = await server.query("SELECT id, stock FROM products WHERE outlet_id = 'outlet-1' ORDER BY id");

    const approved = await admin.post(`/api/document-scans/${job.id}/actions`, { action: "approve", allValid: true });
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    assert.equal(approved.data.reconciliation.approved, 3);
    await admin.post(`/api/document-scans/${job.id}/actions`, { action: "reject", ids: [today.id], reason: "Today's sale" });
    const imported = await admin.post(`/api/document-scans/${job.id}/actions`, { action: "import" });
    assert.equal(imported.status, 200, JSON.stringify(imported.data));
    assert.equal(imported.data.reconciliation.imported, 3);
    assert.equal(imported.data.status, "COMPLETED");

    const sales = await server.query("SELECT id, number, date, total, migrated, status, payment_method FROM sales WHERE migrated IS NOT NULL ORDER BY date");
    assert.equal(sales.length, 2, "one sale for receipt R-101 (two lines) and one daily total");
    const [daily, sale] = sales;
    assert.match(sale.number, /^HIS-/);
    assert.equal(new Date(sale.date).toISOString().slice(0, 10), saleDay);
    assert.equal(Number(sale.total), 190);
    const marker = JSON.parse(sale.migrated);
    assert.equal(marker.kind, "transaction");
    assert.equal(marker.receiptNumber, "R-101");
    assert.equal(marker.jobReference, job.reference);
    const lines = await server.query("SELECT product_name, quantity, total, batch_numbers FROM sale_lines WHERE sale_id = ? ORDER BY product_name", sale.id);
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(daily.migrated).kind, "daily-summary");
    assert.equal(Number(daily.total), 56000);
    assert.equal(daily.payment_method, "Split");
    assert.equal((await server.query("SELECT count(*)::int AS n FROM sale_lines WHERE sale_id = ?", daily.id))[0].n, 0, "no product sales are made up from a daily total");

    assert.equal((await server.query("SELECT count(*)::int AS n FROM stock_ledger"))[0].n, ledgerBefore.n, "no stock moved");
    assert.deepEqual(await server.query("SELECT id, stock FROM products WHERE outlet_id = 'outlet-1' ORDER BY id"), stockBefore);
    assert.equal((await server.query("SELECT count(*)::int AS n FROM payments"))[0].n, paymentsBefore.n, "no payment recorded");
    assert.equal((await server.query("SELECT count(*)::int AS n FROM notifications"))[0].n, notificationsBefore.n, "nobody was notified");

    const voided = await admin.patch(`/api/sales/${sale.id}`, { action: "void", reason: "testing a void" });
    assert.equal(voided.status, 400, "migrated sales cannot be voided");
    assert.match(voided.data.error, /cannot be voided/);

    // A second scan of the same register: the receipt and the daily total are refused (they would count twice).
    const again = await newJob(admin, { category: "sales", outletId: "outlet-1" });
    await upload(admin, again.id, image(page("sales_register", [line("Scanoprofen Tablets", 2, 20, 40), { kind: "daily_sales", fields: { date: f(dmy(totalDay)), totalSales: f("56000") }, region: { x: 0, y: 0, width: 1, height: 0.1 } }])));
    const second = await extracted(admin, again.id);
    assert.ok(second.records.every((record) => record.blocked), JSON.stringify(second.records.map((record) => record.issues)));
    assert.ok(second.records.some((record) => record.issues.some((issue) => /count those sales twice|already imported|count twice/.test(issue.message))));
  });
});

describe("Expenses and suppliers", () => {
  test("expenses enter the expense approval workflow; suppliers are added unverified, balances only when confirmed", async () => {
    const expenses = await newJob(admin, { category: "expenses", outletId: "outlet-1" });
    await upload(admin, expenses.id, image(page("expense_record", [{ kind: "expense", fields: { date: f(dmy(days(-12))), description: f("NEPA bill"), amount: f("18500"), category: f("Utilities"), vendor: f("IKEDC") }, region: { x: 0, y: 0, width: 1, height: 0.1 } }])));
    let detail = await extracted(admin, expenses.id);
    await admin.post(`/api/document-scans/${expenses.id}/actions`, { action: "approve", allValid: true });
    detail = (await admin.post(`/api/document-scans/${expenses.id}/actions`, { action: "import" })).data;
    assert.equal(detail.reconciliation.imported, 1);
    const [expense] = await server.query("SELECT status, amount, category, description FROM expenses WHERE description LIKE ?", `%${expenses.reference}%`);
    assert.equal(expense.status, "Submitted", "still goes through expense approval");
    assert.equal(Number(expense.amount), 18500);

    const suppliers = await newJob(admin, { category: "suppliers" });
    await upload(
      admin,
      suppliers.id,
      image(
        page("supplier_record", [
          { kind: "supplier", fields: { name: f("Scanned Pharma Distributors"), phone: f("08031234567"), pcnLicense: f("PCN/W/7788"), outstandingBalance: f("250000", "high") }, region: { x: 0, y: 0, width: 1, height: 0.1 } },
          { kind: "supplier", fields: { name: f("Second Scan Supplies"), phone: f("0809 000 1111") }, region: { x: 0, y: 0.2, width: 1, height: 0.1 } },
        ]),
      ),
    );
    detail = await extracted(admin, suppliers.id);
    const withBalance = byName(detail, "Scanned Pharma");
    assert.ok(withBalance.blocked, "a balance owed must be confirmed by a person");
    detail = (await admin.patch(`/api/document-scans/${suppliers.id}/records`, { updates: [{ id: withBalance.id, edits: { outstandingBalance: { confirm: true } } }] })).data;
    assert.equal(byName(detail, "Scanned Pharma").blocked, false);
    await admin.post(`/api/document-scans/${suppliers.id}/actions`, { action: "approve", allValid: true });
    detail = (await admin.post(`/api/document-scans/${suppliers.id}/actions`, { action: "import" })).data;
    assert.equal(detail.reconciliation.imported, 2);
    const rows = await server.query("SELECT name, status, balance FROM suppliers WHERE name IN ('Scanned Pharma Distributors', 'Second Scan Supplies') ORDER BY name");
    assert.equal(rows.length, 2);
    assert.equal(rows[0].status, "Pending verification");
    assert.equal(Number(rows[0].balance), 250000);
    assert.equal(Number(rows[1].balance), 0);
  });
});

describe("Failures and resuming", () => {
  test("rate limits are retried, unreadable pages fail without losing the image, and records can be typed in by hand", async () => {
    const job = await newJob(admin, { category: "expenses", outletId: "outlet-1", title: "Faded receipts" });
    const flaky = image({ status: 429, body: { type: "error", error: { type: "rate_limit_error", message: "slow down" } } }, page("expense_record", [{ kind: "expense", fields: { date: f(dmy(days(-30))), description: f("Generator diesel"), amount: f("42000") }, region: { x: 0, y: 0, width: 1, height: 0.1 } }]));
    const broken = image({ status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "Could not process image" } } });
    await upload(admin, job.id, flaky, "receipt-1.jpg");
    await upload(admin, job.id, broken, "receipt-2.jpg");
    const detail = await extracted(admin, job.id);
    const [first, second] = detail.pages;
    assert.equal(first.status, "DONE");
    assert.ok(first.attempts >= 2, "the rate-limited page was tried again");
    assert.equal(second.status, "FAILED");
    assert.match(second.error, /could not accept this page/);
    assert.equal(detail.records.length, 1);
    assert.match(detail.message, /could not be read/);
    // The image is kept and still served (signed, short-lived link, never cached).
    const picture = await admin.request("GET", second.imageUrl, undefined, { raw: true });
    assert.equal(picture.status, 200);
    assert.equal(picture.headers.get("content-type"), "image/png");
    assert.match(picture.headers.get("cache-control"), /no-store/);
    assert.deepEqual(Buffer.from(await picture.arrayBuffer()), broken);
    const forged = second.imageUrl.replace(/sig=[^&]+/, "sig=forged");
    assert.equal((await admin.request("GET", forged, undefined, { raw: true })).status, 403);
    const expired = second.imageUrl.replace(/expires=\d+/, "expires=1000");
    assert.equal((await admin.request("GET", expired, undefined, { raw: true })).status, 403);

    const typed = await admin.post(`/api/document-scans/${job.id}/records`, { kind: "expense", pageId: second.id, edits: { date: dmy(days(-29)), description: "Shop cleaning", amount: "5000" } });
    assert.equal(typed.status, 201, JSON.stringify(typed.data));
    const manual = typed.data.records.find((record) => record.manual);
    assert.equal(manual.blocked, false, JSON.stringify(manual.issues));
    assert.equal(manual.fields.amount.confidence, "confirmed");

    // Resume: the job is listed, and opening it again shows the same records.
    const list = await admin.get("/api/document-scans");
    assert.ok(list.data.some((row) => row.id === job.id && row.records === 2));
    const screen = await admin.request("GET", `/data-migration/scanner/${job.id}`, undefined, { raw: true });
    assert.equal(screen.status, 200);
    assert.match(await screen.text(), /Faded receipts/);

    // Reprocess a page; cancel keeps the pages.
    readings.set(sha(broken), [page("expense_record", [])]);
    const again = await admin.post(`/api/document-scans/${job.id}/pages/${second.id}`, {});
    assert.equal(again.status, 200, JSON.stringify(again.data));
    const reread = await readAll(admin, job.id);
    assert.equal(reread.pages[1].status, "DONE");
    assert.ok(reread.records.some((record) => record.manual), "typed-in records survive a reprocess");
    const cancelled = await admin.post(`/api/document-scans/${job.id}/actions`, { action: "cancel", reason: "test" });
    assert.equal(cancelled.data.status, "CANCELLED");
    assert.equal((await server.query("SELECT count(*)::int AS n FROM document_scan_pages WHERE job_id = ?", job.id))[0].n, 2);
  });
});

describe("Tenant isolation", () => {
  test("another pharmacy cannot list, open, change or see the images of our scanning jobs", async () => {
    const B_OWNER = "owner@scan-b.ng";
    const [account] = await server.query("SELECT password, password_hash FROM users WHERE email = 'admin@web365.ng'");
    await server.query("INSERT INTO tenants (id, slug, name) VALUES ('tenant-scn', 'scan-b', 'Scan B')");
    await server.query("INSERT INTO subscriptions (id, tenant_id, plan_id, status, billing_cycle) VALUES ('sub-tenant-scn', 'tenant-scn', 'starter', 'ACTIVE', 'MONTHLY')");
    await server.query("INSERT INTO outlets (id, tenant_id, name, code, status, seq) VALUES ('outlet-scn1', 'tenant-scn', 'Scan B Main', 'SCNB', 'OPEN', 1)");
    await server.query("INSERT INTO users (id, name, email, role, status, password, password_hash, seq) VALUES ('user-scn1', 'Scan B Owner', ?, 'SUPER_ADMIN', 'ACTIVE', ?, ?, 997)", B_OWNER, account.password, account.password_hash);
    await server.query("INSERT INTO tenant_memberships (id, tenant_id, user_id, role, staff_id) VALUES ('mem-tenant-scn-user-scn1', 'tenant-scn', 'user-scn1', 'SUPER_ADMIN', 'SCN-0001')");
    await server.query("INSERT INTO app_state (tenant_id, key, value) VALUES ('tenant-scn', 'settings', ?)", JSON.stringify({ businessName: "Scan B" }));
    const owner = await signedIn(server.baseUrl, B_OWNER);

    const [ours] = (await admin.get("/api/document-scans")).data;
    const detail = (await admin.get(`/api/document-scans/${ours.id}`)).data;
    assert.deepEqual((await owner.get("/api/document-scans")).data, []);
    assert.equal((await owner.get(`/api/document-scans/${ours.id}`)).status, 404);
    assert.equal((await owner.patch(`/api/document-scans/${ours.id}/records`, { updates: [{ id: detail.records[0]?.id ?? "x", edits: { name: "x" } }] })).status, 404);
    assert.equal((await owner.post(`/api/document-scans/${ours.id}/actions`, { action: "cancel" })).status, 404);
    if (detail.pages[0]) assert.equal((await owner.request("GET", detail.pages[0].imageUrl, undefined, { raw: true })).status, 404);
    assert.equal((await upload(owner, ours.id, png(4242))).status, 404);
    // Their own job cannot be pointed at our outlet.
    const theirs = await owner.post("/api/document-scans", { category: "sales", outletId: "outlet-1" });
    assert.equal(theirs.status, 404);
    // And their AI approval is their own.
    assert.equal((await owner.get("/api/document-scans/settings")).data.aiApproved, false);
  });
});
