// Multi-tenant isolation (SaaS phases 1–2). A second pharmacy ("tenant-b", Pharmacy B) is created next to the
// demo pharmacy. Both are used through the app at the same time; neither may see, change, export, download,
// link to or sign in to the other's data. The app runs as the restricted database role (pharm_app), so
// PostgreSQL Row Level Security applies to every query it makes.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { Client, signedIn } from "./helpers/client.mjs";
import { startServer } from "./helpers/server.mjs";

const TENANT_TABLES = [
  "outlets", "user_outlets", "products", "product_packaging", "product_barcodes", "batches", "stock_movements",
  "stock_ledger", "price_history", "held_sales", "stock_transfers", "customers", "suppliers", "sales", "sale_lines",
  "purchase_orders", "purchase_order_lines", "payments", "expenses", "audit_events", "product_registrations",
  "regulatory_documents", "regulatory_files", "inventory_alerts", "notifications", "notification_deliveries",
  "sale_returns", "sale_return_lines", "impersonation_sessions", "app_state", "inventory_imports", "offline_devices", "offline_operations",
];
const SECRET = "Tenant B Secret Paracetamol";
const B_OWNER = "owner@pharmacy-b.ng";
const CRON_SECRET = "test-cron-secret-for-tenancy";

let server;
let demo; // { outlet, product, productName, sale }
before(async () => {
  // Files in PostgreSQL, as on the live Vercel deployment (DOCUMENT_STORAGE=postgres).
  server = await startServer({ RATE_LIMIT: "on", CRON_SECRET, DOCUMENT_STORAGE: "postgres" });
  const [outlet] = await server.query("SELECT id, code, name FROM outlets WHERE tenant_id = 'tenant-demo' ORDER BY seq LIMIT 1");
  const [product] = await server.query("SELECT id, name FROM products WHERE tenant_id = 'tenant-demo' ORDER BY seq LIMIT 1");
  const [sale] = await server.query("SELECT id FROM sales WHERE tenant_id = 'tenant-demo' LIMIT 1");
  demo = { outlet, product: product.id, productName: product.name, sale: sale.id };
  const [admin] = await server.query("SELECT password, password_hash FROM users WHERE email = 'admin@web365.ng'");
  // Pharmacy B reuses the demo outlet's code on purpose: business codes are unique per pharmacy, not globally.
  await server.query("INSERT INTO tenants (id, slug, name) VALUES ('tenant-b', 'pharmacy-b', 'Pharmacy B')");
  await server.query("INSERT INTO subscriptions (id, tenant_id, plan_id, status, billing_cycle) VALUES ('sub-tenant-b', 'tenant-b', 'starter', 'ACTIVE', 'MONTHLY')");
  await server.query("INSERT INTO outlets (id, tenant_id, name, code, status, seq) VALUES ('outlet-b1', 'tenant-b', 'Pharmacy B Main', ?, 'OPEN', 1)", outlet.code);
  await server.query("INSERT INTO products (id, tenant_id, name, outlet_id, stock, min_stock, seq) VALUES ('prod-b1', 'tenant-b', ?, 'outlet-b1', 50, 10, 1)", SECRET);
  await server.query("INSERT INTO batches (id, tenant_id, batch_number, product_id, assigned_outlet_id, expiry_date, quantity_received, available_quantity, seq) VALUES ('bat-b1', 'tenant-b', 'B-LOT-1', 'prod-b1', 'outlet-b1', '2030-01-01', 50, 50, 1)");
  await server.query("INSERT INTO customers (id, tenant_id, code, name, type, seq) VALUES ('cus-b1', 'tenant-b', 'CUS-0001', 'Tenant B Customer', 'Walk-in', 1)");
  // Same password as the demo accounts (Admin@123), stored the same way.
  await server.query("INSERT INTO users (id, name, email, role, status, password, password_hash, seq) VALUES ('user-b1', 'Pharmacy B Owner', ?, 'SUPER_ADMIN', 'ACTIVE', ?, ?, 999)", B_OWNER, admin.password, admin.password_hash);
  await server.query("INSERT INTO tenant_memberships (id, tenant_id, user_id, role, staff_id) VALUES ('mem-tenant-b-user-b1', 'tenant-b', 'user-b1', 'SUPER_ADMIN', 'W365-0001')");
  await server.query("INSERT INTO app_state (tenant_id, key, value) VALUES ('tenant-b', 'settings', ?)", JSON.stringify({ businessName: "Pharmacy B" }));
  // Pharmacy B's own counters, consistent with the customer created above.
  await server.query("INSERT INTO app_state (tenant_id, key, value) VALUES ('tenant-b', 'counters', ?)", JSON.stringify({ customer: 2 }));
});
after(async () => {
  await server?.stop();
});

const text = async (client, path) => (await client.request("GET", path, undefined, { raw: true })).text();
const DEMO_MARKERS = () => [demo.productName, demo.outlet.name, "Outlet 1 - Lekki", "admin@web365.ng"];
const B_MARKERS = [SECRET, "prod-b1", "outlet-b1", "bat-b1", "Tenant B Customer", "Pharmacy B Main", B_OWNER];

describe("Database after the tenancy migrations", () => {
  test("the demo tenant exists and every user has a membership", async () => {
    const [tenant] = await server.query("SELECT id, slug, is_demo FROM tenants WHERE id = 'tenant-demo'");
    assert.deepEqual(tenant, { id: "tenant-demo", slug: "demo", is_demo: true });
    const [{ n }] = await server.query("SELECT COUNT(*) AS n FROM users u WHERE NOT EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.user_id = u.id)");
    assert.equal(n, 0);
  });

  test("every tenant table has a required tenant_id and forced Row Level Security", async () => {
    const columns = await server.query("SELECT table_name, is_nullable FROM information_schema.columns WHERE column_name = 'tenant_id' AND table_schema = 'public'");
    for (const table of TENANT_TABLES) assert.equal(columns.find((row) => row.table_name === table)?.is_nullable, "NO", `${table}.tenant_id is NOT NULL`);
    const rls = await server.query("SELECT relname FROM pg_class WHERE relrowsecurity AND relforcerowsecurity AND relnamespace = 'public'::regnamespace");
    assert.deepEqual(rls.map((row) => row.relname).sort(), [...TENANT_TABLES].sort());
  });
});

describe("Sign-in", () => {
  test("the public sign-in page names no pharmacy and no outlet", async () => {
    const html = await (await fetch(`${server.baseUrl}/login`)).text();
    for (const marker of ["Outlet 1 - Lekki", "Pharmacy B Main", B_OWNER, "Web365 Demo Pharmacy"]) assert.ok(!html.includes(marker), `sign-in page shows ${marker}`);
  });

  test("pharmacies and locations are listed only after the password is checked, and only the account's own", async () => {
    const ask = (identifier, password) => fetch(`${server.baseUrl}/api/auth/pharmacies`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier, password }) });
    const wrong = await ask(B_OWNER, "Wrong#Pass1");
    assert.equal(wrong.status, 401);
    assert.ok(!(await wrong.text()).includes("Pharmacy B"));
    const owner = await (await ask(B_OWNER, "Admin@123")).json();
    assert.deepEqual(owner.pharmacies.map((entry) => entry.name), ["Pharmacy B"]);
    assert.deepEqual(owner.pharmacies[0].locations.map((location) => location.id), ["HQ", "outlet-b1"]);
    const cashier = await (await ask("relief@web365.ng", "Admin@123")).json();
    assert.deepEqual(cashier.pharmacies.map((entry) => entry.tenantId), ["tenant-demo"]);
    assert.ok(cashier.pharmacies[0].locations.every((location) => location.id.startsWith("outlet-")), "outlet staff see only their outlets");
  });

  test("each owner signs in to their own pharmacy and sees only its data", async () => {
    const owner = await signedIn(server.baseUrl, B_OWNER);
    const session = await owner.session();
    assert.equal(session.user.tenantId, "tenant-b");
    assert.equal(session.user.tenantName, "Pharmacy B");
    const ownerProducts = await text(owner, "/api/products");
    assert.ok(ownerProducts.includes(SECRET));
    for (const marker of DEMO_MARKERS()) assert.ok(!ownerProducts.includes(marker), `Pharmacy B sees ${marker}`);

    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    assert.equal((await admin.session()).user.tenantId, "tenant-demo");
    const adminProducts = await text(admin, "/api/products");
    assert.ok(adminProducts.includes(demo.productName));
    for (const marker of B_MARKERS) assert.ok(!adminProducts.includes(marker), `demo sees ${marker}`);
  });

  test("asking for a pharmacy the account does not belong to is refused", async () => {
    const client = new Client(server.baseUrl);
    assert.match(await client.login(B_OWNER, "HQ", "Admin@123", "tenant-demo"), /does not have access/);
    assert.match(await client.login(B_OWNER, "outlet-1", "Admin@123"), /closed or does not exist/, "the demo outlet is unknown in Pharmacy B");
  });
});

describe("No access across pharmacies (signed in as Pharmacy B)", () => {
  test("API responses and pages show none of the demo pharmacy's data", async () => {
    const owner = await signedIn(server.baseUrl, B_OWNER);
    for (const path of ["/api/products", "/api/catalog", "/api/stock-levels", "/api/pos/catalog", "/api/dashboard", "/api/stock-ledger", "/api/alerts", "/api/sales", "/api/sales/feed", "/api/sales-overview", "/api/inventory-reports?kind=all", "/dashboard", "/products", "/outlets", "/contacts", "/users", "/sales", "/stock", "/audit", "/regulatory", "/finance", "/reports"]) {
      const response = await owner.request("GET", path, undefined, { raw: true });
      assert.ok(response.status < 500, `${path} answered ${response.status}`);
      const body = await response.text();
      for (const marker of DEMO_MARKERS()) assert.ok(!body.includes(marker), `${path} leaked ${marker}`);
    }
  });

  test("the demo pharmacy's record IDs are unknown: no reading, changing, receipts or downloads", async () => {
    const owner = await signedIn(server.baseUrl, B_OWNER);
    assert.ok([403, 404].includes((await owner.get(`/api/products/${demo.product}`)).status));
    assert.ok((await owner.patch(`/api/products/${demo.product}`, { name: "Hijacked" })).status >= 400);
    assert.ok([403, 404].includes((await owner.get(`/api/sales/${demo.sale}/receipt`)).status));
    assert.ok((await owner.post(`/api/sales/${demo.sale}/returns`, { lines: [], reason: "x", refundMethod: "Cash" })).status >= 400);
    const [row] = await server.query("SELECT name FROM products WHERE id = ?", demo.product);
    assert.equal(row.name, demo.productName);
  });

  test("the demo pharmacy's outlets cannot be chosen, sold from or reported on", async () => {
    const owner = await signedIn(server.baseUrl, B_OWNER);
    await owner.updateSession({ outletId: demo.outlet.id });
    assert.notEqual((await owner.session()).user.outletId, demo.outlet.id);
    const sale = await owner.post("/api/sales", { outletId: demo.outlet.id, customerId: "cus-b1", paymentMethod: "Cash", lines: [{ productId: demo.product, quantity: 1 }] });
    assert.ok(sale.status >= 400, `sale answered ${sale.status}`);
    const report = await text(owner, `/api/inventory-reports?kind=all&outlet=${demo.outlet.id}`);
    for (const marker of DEMO_MARKERS()) assert.ok(!report.includes(marker));
  });

  test("regulatory files of one pharmacy cannot be downloaded by the other", async () => {
    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    const form = new FormData();
    form.set("file", new File([Buffer.from("%PDF-1.4 demo licence")], "licence.pdf", { type: "application/pdf" }));
    form.set("title", "Demo premises licence");
    form.set("category", "PCN premises licence");
    form.set("relatedTo", demo.outlet.id);
    const uploaded = await fetch(`${server.baseUrl}/api/regulatory/documents`, { method: "POST", headers: { cookie: admin.cookieHeader() }, body: form });
    assert.ok(uploaded.status < 300, await uploaded.text());
    const [document] = await server.query("SELECT id, tenant_id FROM regulatory_documents WHERE title = 'Demo premises licence'");
    assert.equal(document.tenant_id, "tenant-demo");
    const [file] = await server.query("SELECT tenant_id FROM regulatory_files ORDER BY created_at DESC LIMIT 1");
    assert.equal(file.tenant_id, "tenant-demo");
    assert.equal((await admin.request("GET", `/api/regulatory/documents/${document.id}`, undefined, { raw: true })).status, 200);
    const owner = await signedIn(server.baseUrl, B_OWNER);
    assert.ok([403, 404].includes((await owner.request("GET", `/api/regulatory/documents/${document.id}`, undefined, { raw: true })).status));
  });

  test("Pharmacy B's new records carry Pharmacy B and platform-unique IDs", async () => {
    const owner = await signedIn(server.baseUrl, B_OWNER);
    const created = await owner.post("/api/contacts", { kind: "customer", name: "B Walk-in Two", type: "Walk-in", phone: "", email: "", creditLimit: 0, outletId: null });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const [customer] = await server.query("SELECT id, tenant_id FROM customers WHERE name = 'B Walk-in Two'");
    assert.equal(customer.tenant_id, "tenant-b");
    const audits = await server.query("SELECT id FROM audit_events WHERE tenant_id = 'tenant-b'");
    assert.ok(audits.length > 0 && audits.every((row) => row.id.startsWith("aud-tenant-b-")), JSON.stringify(audits));
    const [demoAudit] = await server.query("SELECT id FROM audit_events WHERE tenant_id = 'tenant-demo' ORDER BY seq DESC LIMIT 1");
    assert.match(demoAudit.id, /^aud-\d+$/, "the demo pharmacy keeps its existing ID format");
  });
});

describe("Simultaneous requests from both pharmacies", () => {
  test("interleaved requests each see only their own pharmacy", async () => {
    const [owner, admin] = await Promise.all([signedIn(server.baseUrl, B_OWNER), signedIn(server.baseUrl, "admin@web365.ng")]);
    const calls = Array.from({ length: 12 }, (_, index) => (index % 2 ? { who: "b", client: owner } : { who: "demo", client: admin }));
    const results = await Promise.all(calls.map(async (call) => ({ ...call, body: await text(call.client, "/api/products") })));
    for (const { who, body } of results) {
      if (who === "b") assert.ok(body.includes(SECRET) && !body.includes(demo.productName));
      else assert.ok(body.includes(demo.productName) && !body.includes(SECRET));
    }
  });
});

describe("Pharmacy status, memberships and switching", () => {
  test("one person in two pharmacies chooses one at sign-in, has a separate role in each, and can switch", async () => {
    const [admin] = await server.query("SELECT id FROM users WHERE email = 'admin@web365.ng'");
    await server.query("INSERT INTO tenant_memberships (id, tenant_id, user_id, role, staff_id) VALUES ('mem-tenant-b-admin', 'tenant-b', ?, 'CASHIER', 'B-0002')", admin.id);
    await server.query("INSERT INTO user_outlets (tenant_id, user_id, position, outlet_id) VALUES ('tenant-b', ?, 0, 'outlet-b1')", admin.id);
    try {
      assert.match(await new Client(server.baseUrl).login("admin@web365.ng"), /Choose the pharmacy/);

      const inB = await signedIn(server.baseUrl, "admin@web365.ng", "outlet-b1", "tenant-b");
      const sessionB = (await inB.session()).user;
      assert.deepEqual([sessionB.tenantId, sessionB.role, sessionB.outletId], ["tenant-b", "CASHIER", "outlet-b1"]);
      assert.deepEqual(sessionB.pharmacies.map((entry) => entry.id).sort(), ["tenant-b", "tenant-demo"]);
      assert.equal((await inB.get("/api/users")).status === 200, false, "a cashier in B has no user admin there");

      const inDemo = await signedIn(server.baseUrl, "admin@web365.ng", "HQ", "tenant-demo");
      assert.equal((await inDemo.session()).user.role, "SUPER_ADMIN");
      await inDemo.updateSession({ tenantId: "tenant-b" });
      const switched = (await inDemo.session()).user;
      assert.deepEqual([switched.tenantId, switched.role], ["tenant-b", "CASHIER"]);
      await inDemo.updateSession({ tenantId: "tenant-nowhere" });
      assert.equal((await inDemo.session()).user.tenantId, "tenant-b", "an unknown pharmacy is ignored");
      const [audit] = await server.query("SELECT tenant_id FROM audit_events WHERE action = 'auth.switch-pharmacy'");
      assert.equal(audit.tenant_id, "tenant-b");
    } finally {
      await server.query("DELETE FROM user_outlets WHERE tenant_id = 'tenant-b' AND user_id = ?", admin.id);
      await server.query("DELETE FROM tenant_memberships WHERE id = 'mem-tenant-b-admin'");
    }
  });

  test("a suspended pharmacy loses access at once; reactivating restores it", async () => {
    const owner = await signedIn(server.baseUrl, B_OWNER);
    assert.equal((await owner.get("/api/products")).status, 200);
    await server.query("UPDATE tenants SET status = 'SUSPENDED' WHERE id = 'tenant-b'");
    try {
      assert.equal((await owner.get("/api/products")).status, 401);
      assert.ok(await new Client(server.baseUrl).login(B_OWNER), "no new sign-in either");
    } finally {
      await server.query("UPDATE tenants SET status = 'ACTIVE' WHERE id = 'tenant-b'");
    }
    assert.equal((await owner.get("/api/products")).status, 200);
  });

  test("removing a membership ends that person's access to the pharmacy", async () => {
    const owner = await signedIn(server.baseUrl, B_OWNER);
    await server.query("UPDATE tenant_memberships SET status = 'DEACTIVATED' WHERE id = 'mem-tenant-b-user-b1'");
    try {
      assert.equal((await owner.get("/api/products")).status, 401);
    } finally {
      await server.query("UPDATE tenant_memberships SET status = 'ACTIVE' WHERE id = 'mem-tenant-b-user-b1'");
    }
  });
});

describe("Background jobs", () => {
  test("scheduled jobs run once per pharmacy, each inside its own data", async () => {
    const response = await fetch(`${server.baseUrl}/api/alerts/jobs`, { method: "POST", headers: { "Content-Type": "application/json", "x-cron-secret": CRON_SECRET }, body: JSON.stringify({ job: "scan" }) });
    assert.equal(response.status, 200);
    const { results } = await response.json();
    assert.deepEqual(results.map((entry) => entry.tenantId).sort(), ["tenant-b", "tenant-demo"]);
    assert.ok(results.every((entry) => entry.ok), JSON.stringify(results));
    const crossed = await server.query("SELECT COUNT(*) AS n FROM inventory_alerts a JOIN products p ON p.id = a.product_id WHERE p.tenant_id <> a.tenant_id");
    assert.equal(crossed[0].n, 0);
  });
});

describe("Database isolation", () => {
  test("a link to another pharmacy's record is rejected by the composite foreign keys", async () => {
    await assert.rejects(
      server.query("INSERT INTO batches (id, tenant_id, batch_number, product_id, assigned_outlet_id, expiry_date, seq) VALUES ('bat-cross', 'tenant-b', 'X', ?, 'outlet-b1', '2030-01-01', 2)", demo.product),
      (error) => error.code === "23503",
    );
    await assert.rejects(
      server.query("INSERT INTO sale_lines (tenant_id, sale_id, position) SELECT 'tenant-b', id, 99 FROM sales WHERE tenant_id = 'tenant-demo' LIMIT 1"),
      (error) => error.code === "23503",
    );
  });

  test("as the app's role, Row Level Security shows and accepts only the scoped pharmacy's rows", async () => {
    const scoped = async (tenantId, sql, ...params) => {
      await server.query("BEGIN");
      try {
        await server.query("SET LOCAL ROLE pharm_app");
        if (tenantId !== null) await server.query("SELECT set_config('app.tenant_id', ?, true)", tenantId);
        return await server.query(sql, ...params);
      } finally {
        await server.query("ROLLBACK");
      }
    };
    const names = async (tenantId) => (await scoped(tenantId, "SELECT name FROM products")).map((row) => row.name);
    assert.deepEqual(await names("tenant-b"), [SECRET]);
    assert.ok(!(await names("tenant-demo")).includes(SECRET));
    assert.deepEqual(await names(null), [], "no pharmacy set: nothing visible");
    assert.deepEqual(await scoped("tenant-demo", "UPDATE products SET name = 'x' WHERE id = 'prod-b1' RETURNING id"), [], "another pharmacy's row cannot be updated");
    await assert.rejects(
      scoped("tenant-b", "INSERT INTO customers (id, tenant_id, code, name, seq) VALUES ('cus-smuggle', 'tenant-demo', 'CUS-9999', 'Smuggled', 1)"),
      (error) => error.code === "42501",
    );
    const [{ bypass }] = await server.query("SELECT rolbypassrls AS bypass FROM pg_roles WHERE rolname = 'pharm_app'");
    assert.equal(bypass, false);
  });
});

describe("Sign-in rate limiting", () => {
  test("after 10 failed attempts an account name is locked for a while, even with the right password", async () => {
    const client = new Client(server.baseUrl);
    for (let attempt = 0; attempt < 10; attempt += 1) assert.ok(await client.login("staff.vi@web365.ng", "outlet-3", "Wrong#Pass1"));
    assert.match(await client.login("staff.vi@web365.ng", "outlet-3", "Admin@123"), /Too many requests/);
    const listed = await fetch(`${server.baseUrl}/api/auth/pharmacies`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: "staff.vi@web365.ng", password: "Admin@123" }) });
    assert.equal(listed.status, 429);
    await signedIn(server.baseUrl, "sales.vi@web365.ng", "outlet-3"); // other accounts are unaffected
  });
});
