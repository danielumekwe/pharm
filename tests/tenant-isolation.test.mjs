// Phase 1 tenancy: a second pharmacy ("tenant-b") is written straight into the database next to the demo
// pharmacy. The app (running as the demo tenant) must never show, change or link to tenant B's records, and
// PostgreSQL itself (composite foreign keys + Row Level Security) must refuse cross-tenant reads and writes.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { Client, signedIn } from "./helpers/client.mjs";
import { startServer } from "./helpers/server.mjs";

const TENANT_TABLES = [
  "outlets", "user_outlets", "products", "product_packaging", "product_barcodes", "batches", "stock_movements",
  "stock_ledger", "price_history", "held_sales", "stock_transfers", "customers", "suppliers", "sales", "sale_lines",
  "purchase_orders", "purchase_order_lines", "payments", "expenses", "audit_events", "product_registrations",
  "regulatory_documents", "regulatory_files", "inventory_alerts", "notifications", "notification_deliveries",
  "sale_returns", "sale_return_lines", "impersonation_sessions", "app_state",
];
const SECRET = "Tenant B Secret Paracetamol";

let server;
let demoOutlet;
before(async () => {
  server = await startServer();
  [demoOutlet] = await server.query("SELECT id, code FROM outlets WHERE tenant_id = 'tenant-demo' ORDER BY seq LIMIT 1");
  const [admin] = await server.query("SELECT password_hash FROM users WHERE email = 'admin@web365.ng'");
  // Tenant B reuses the demo outlet's code on purpose: business codes are unique per tenant, not globally.
  await server.query("INSERT INTO tenants (id, slug, name) VALUES ('tenant-b', 'pharmacy-b', 'Pharmacy B')");
  await server.query("INSERT INTO outlets (id, tenant_id, name, code, status, seq) VALUES ('outlet-b1', 'tenant-b', 'Pharmacy B Main', ?, 'OPEN', 1)", demoOutlet.code);
  await server.query("INSERT INTO products (id, tenant_id, name, outlet_id, stock, seq) VALUES ('prod-b1', 'tenant-b', ?, 'outlet-b1', 50, 1)", SECRET);
  await server.query("INSERT INTO batches (id, tenant_id, batch_number, product_id, assigned_outlet_id, expiry_date, available_quantity, seq) VALUES ('bat-b1', 'tenant-b', 'B-LOT-1', 'prod-b1', 'outlet-b1', '2030-01-01', 50, 1)");
  await server.query("INSERT INTO customers (id, tenant_id, code, name, seq) VALUES ('cus-b1', 'tenant-b', 'CUS-0001', 'Tenant B Customer', 1)");
  await server.query("INSERT INTO users (id, name, email, role, status, password_hash, seq) VALUES ('user-b1', 'Pharmacy B Owner', 'owner@pharmacy-b.ng', 'SUPER_ADMIN', 'ACTIVE', ?, 999)", admin.password_hash);
  await server.query("INSERT INTO tenant_memberships (id, tenant_id, user_id, role, staff_id) VALUES ('mem-tenant-b-user-b1', 'tenant-b', 'user-b1', 'SUPER_ADMIN', 'W365-0001')");
  await server.query("INSERT INTO user_outlets (tenant_id, user_id, position, outlet_id) VALUES ('tenant-b', 'user-b1', 0, 'outlet-b1')");
  await server.query("INSERT INTO app_state (tenant_id, key, value) VALUES ('tenant-b', 'settings', ?)", JSON.stringify({ businessName: "Pharmacy B" }));
});
after(async () => {
  await server?.stop();
});

describe("Tenancy migration on a fresh database", () => {
  test("the demo tenant exists and every user has a membership", async () => {
    const [tenant] = await server.query("SELECT id, slug, is_demo FROM tenants WHERE id = 'tenant-demo'");
    assert.deepEqual(tenant, { id: "tenant-demo", slug: "demo", is_demo: true });
    const [{ n }] = await server.query("SELECT COUNT(*) AS n FROM users u WHERE NOT EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.user_id = u.id)");
    assert.equal(n, 0);
  });

  test("every tenant table has a required tenant_id and forced Row Level Security", async () => {
    const columns = await server.query("SELECT table_name, is_nullable FROM information_schema.columns WHERE column_name = 'tenant_id' AND table_schema = 'public'");
    for (const table of TENANT_TABLES) {
      assert.equal(columns.find((row) => row.table_name === table)?.is_nullable, "NO", `${table}.tenant_id is NOT NULL`);
    }
    const rls = await server.query("SELECT relname FROM pg_class WHERE relrowsecurity AND relforcerowsecurity AND relnamespace = 'public'::regnamespace");
    assert.deepEqual(rls.map((row) => row.relname).sort(), [...TENANT_TABLES].sort());
  });
});

describe("Application isolation (the app runs as the demo tenant)", () => {
  test("no API response or page contains tenant B's records", async () => {
    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    for (const path of ["/api/products", "/api/catalog", "/api/stock-levels", "/api/pos/catalog", "/api/dashboard", "/api/stock-ledger", "/api/alerts"]) {
      const response = await admin.request("GET", path, undefined, { raw: true });
      const body = await response.text();
      assert.ok(response.status < 500, `${path} answered ${response.status}`);
      for (const marker of [SECRET, "prod-b1", "outlet-b1", "bat-b1", "Tenant B Customer", "Pharmacy B"]) {
        assert.ok(!body.includes(marker), `${path} leaked ${marker}`);
      }
    }
    for (const path of ["/", "/dashboard", "/products", "/outlets", "/contacts", "/users"]) {
      const html = await admin.request("GET", path, undefined, { raw: true }).then((response) => response.text());
      assert.ok(!html.includes(SECRET) && !html.includes("Pharmacy B Main") && !html.includes("Pharmacy B Owner"), `${path} leaked tenant B data`);
    }
  });

  test("a user who belongs only to tenant B cannot sign in to the demo pharmacy", async () => {
    const client = new Client(server.baseUrl);
    assert.ok(await client.login("owner@pharmacy-b.ng"), "sign-in is refused");
    assert.ok(await client.login("owner@pharmacy-b.ng", "outlet-b1"), "naming tenant B's outlet does not help");
  });

  test("tenant B's IDs in a request are treated as unknown", async () => {
    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    const product = await admin.get("/api/products/prod-b1");
    assert.ok([403, 404].includes(product.status), `GET product answered ${product.status}`);
    const edit = await admin.patch("/api/products/prod-b1", { name: "Hijacked" });
    assert.ok(edit.status >= 400, `PATCH product answered ${edit.status}`);
    const [row] = await server.query("SELECT name, tenant_id FROM products WHERE id = 'prod-b1'");
    assert.deepEqual(row, { name: SECRET, tenant_id: "tenant-b" });
  });

  test("new records are stamped with the demo tenant, and the same codes may exist in tenant B", async () => {
    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    const created = await admin.post("/api/contacts", { kind: "customer", name: "Isolation Test Customer", type: "Walk-in", phone: "", email: "", creditLimit: 0, outletId: null });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const [row] = await server.query("SELECT tenant_id FROM customers WHERE name = 'Isolation Test Customer'");
    assert.equal(row.tenant_id, "tenant-demo");
    const [{ n }] = await server.query("SELECT COUNT(*) AS n FROM outlets WHERE code = ?", demoOutlet.code);
    assert.equal(n, 2, "both tenants hold an outlet with the same code");
  });

  test("users created in the app get a membership of the demo tenant", async () => {
    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    const created = await admin.post("/api/users", {
      name: "Membership Test", email: "membership.test@web365.ng", phone: "08012345678", role: "CASHIER", outletIds: [demoOutlet.id],
      primaryOutletId: demoOutlet.id, status: "ACTIVE", credential: { mode: "password", password: "Strong#Pass123" },
    });
    assert.ok(created.status < 300, JSON.stringify(created.data));
    const [membership] = await server.query(
      "SELECT m.tenant_id, m.role, m.default_outlet_id FROM tenant_memberships m JOIN users u ON u.id = m.user_id WHERE u.email = 'membership.test@web365.ng'",
    );
    assert.deepEqual(membership, { tenant_id: "tenant-demo", role: "CASHIER", default_outlet_id: demoOutlet.id });
    const [assignment] = await server.query("SELECT uo.tenant_id FROM user_outlets uo JOIN users u ON u.id = uo.user_id WHERE u.email = 'membership.test@web365.ng'");
    assert.equal(assignment.tenant_id, "tenant-demo");
  });

  test("a record ID already owned by tenant B is never overwritten; the whole request is rolled back", async () => {
    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    const [{ value }] = await server.query("SELECT value FROM app_state WHERE tenant_id = 'tenant-demo' AND key = 'counters'");
    const nextAudit = `aud-${JSON.parse(value).audit ?? 1}`;
    // Plant tenant B's row on the ID the next demo audit entry will use.
    await server.query("INSERT INTO audit_events (id, tenant_id, at, summary, seq) VALUES (?, 'tenant-b', '2026-01-01T00:00:00Z', 'tenant B audit row', 1)", nextAudit);
    try {
      const response = await admin.post("/api/contacts", { kind: "customer", name: "Collision Customer", type: "Walk-in", phone: "", email: "", creditLimit: 0, outletId: null });
      assert.ok(response.status >= 500, `expected the write to be refused, got ${response.status}`);
      const [audit] = await server.query("SELECT tenant_id, summary FROM audit_events WHERE id = ?", nextAudit);
      assert.deepEqual(audit, { tenant_id: "tenant-b", summary: "tenant B audit row" });
      const [{ n }] = await server.query("SELECT COUNT(*) AS n FROM customers WHERE name = 'Collision Customer'");
      assert.equal(n, 0, "nothing from the refused request was saved");
    } finally {
      await server.query("DELETE FROM audit_events WHERE id = ? AND tenant_id = 'tenant-b'", nextAudit);
    }
    const retry = await admin.post("/api/contacts", { kind: "customer", name: "Collision Customer", type: "Walk-in", phone: "", email: "", creditLimit: 0, outletId: null });
    assert.equal(retry.status, 201, "the app recovers once the ID is free");
  });

  test("tenant B's data is unchanged after all of the above", async () => {
    const rows = await server.query(
      "SELECT (SELECT COUNT(*) FROM products WHERE tenant_id = 'tenant-b') AS products, (SELECT COUNT(*) FROM customers WHERE tenant_id = 'tenant-b') AS customers, (SELECT available_quantity FROM batches WHERE id = 'bat-b1') AS quantity, (SELECT COUNT(*) FROM audit_events WHERE tenant_id = 'tenant-b') AS audit",
    );
    assert.deepEqual(rows[0], { products: 1, customers: 1, quantity: 50, audit: 0 });
  });
  test("one person can belong to both pharmacies; each keeps its own role and outlets", async () => {
    const [admin] = await server.query("SELECT id FROM users WHERE email = 'admin@web365.ng'");
    const before = await server.query("SELECT outlet_id FROM user_outlets WHERE user_id = ? AND tenant_id = 'tenant-demo' ORDER BY position", admin.id);
    await server.query("INSERT INTO tenant_memberships (id, tenant_id, user_id, role, staff_id) VALUES ('mem-tenant-b-admin', 'tenant-b', ?, 'CASHIER', 'B-0002')", admin.id);
    await server.query("INSERT INTO user_outlets (tenant_id, user_id, position, outlet_id) VALUES ('tenant-b', ?, 0, 'outlet-b1')", admin.id);

    const client = await signedIn(server.baseUrl, "admin@web365.ng");
    const session = await client.session();
    assert.equal(session.user.role, "SUPER_ADMIN", "the demo role is unchanged by the tenant B membership");
    assert.ok(!JSON.stringify(session).includes("outlet-b1"), "tenant B's outlet is not in the demo session");
    // A write in the demo pharmacy rewrites the admin's demo assignments only.
    const touched = await client.post("/api/contacts", { kind: "customer", name: "Dual Membership Customer", type: "Walk-in", phone: "", email: "", creditLimit: 0, outletId: null });
    assert.equal(touched.status, 201);
    assert.deepEqual(await server.query("SELECT outlet_id FROM user_outlets WHERE user_id = ? AND tenant_id = 'tenant-demo' ORDER BY position", admin.id), before);
    const [membershipB] = await server.query("SELECT role, staff_id FROM tenant_memberships WHERE tenant_id = 'tenant-b' AND user_id = ?", admin.id);
    assert.deepEqual(membershipB, { role: "CASHIER", staff_id: "B-0002" });
    assert.deepEqual(await server.query("SELECT outlet_id FROM user_outlets WHERE user_id = ? AND tenant_id = 'tenant-b'", admin.id), [{ outlet_id: "outlet-b1" }]);
  });
});

describe("Database isolation", () => {
  test("a link to another tenant's record is rejected by the composite foreign keys", async () => {
    const [demoProduct] = await server.query("SELECT id FROM products WHERE tenant_id = 'tenant-demo' LIMIT 1");
    await assert.rejects(
      server.query("INSERT INTO batches (id, tenant_id, batch_number, product_id, assigned_outlet_id, expiry_date, seq) VALUES ('bat-cross', 'tenant-b', 'X', ?, 'outlet-b1', '2030-01-01', 2)", demoProduct.id),
      (error) => error.code === "23503",
    );
    await assert.rejects(
      server.query("INSERT INTO sale_lines (tenant_id, sale_id, position) SELECT 'tenant-b', id, 99 FROM sales WHERE tenant_id = 'tenant-demo' LIMIT 1"),
      (error) => error.code === "23503",
    );
  });

  test("Row Level Security shows and accepts only the scoped tenant's rows", async () => {
    // Superusers bypass RLS, so these checks run as an ordinary role, like the application should.
    await server.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rls_probe') THEN CREATE ROLE rls_probe NOLOGIN; END IF; END $$");
    await server.query("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rls_probe");
    const scoped = async (tenantId, sql, ...params) => {
      await server.query("BEGIN");
      try {
        await server.query("SET LOCAL ROLE rls_probe");
        if (tenantId !== null) await server.query("SELECT set_config('app.tenant_id', ?, true)", tenantId);
        return await server.query(sql, ...params);
      } finally {
        await server.query("ROLLBACK");
      }
    };
    const names = async (tenantId) => (await scoped(tenantId, "SELECT name FROM products")).map((row) => row.name);

    assert.deepEqual(await names("tenant-b"), [SECRET]);
    assert.ok(!(await names("tenant-demo")).includes(SECRET));
    assert.ok((await names("tenant-demo")).length > 0);
    assert.deepEqual(await names(null), [], "no tenant set: nothing visible");
    assert.deepEqual(await scoped("tenant-demo", "SELECT id FROM products WHERE id = 'prod-b1'"), [], "a known ID of another tenant is invisible");
    assert.deepEqual(await scoped("tenant-demo", "UPDATE products SET name = 'x' WHERE id = 'prod-b1' RETURNING id"), [], "and cannot be updated");
    await assert.rejects(
      scoped("tenant-b", "INSERT INTO customers (id, tenant_id, code, name, seq) VALUES ('cus-smuggle', 'tenant-demo', 'CUS-9999', 'Smuggled', 1)"),
      (error) => error.code === "42501",
      "writing a row for another tenant is refused",
    );
    const settings = await scoped("tenant-b", "SELECT tenant_id, key FROM app_state ORDER BY tenant_id, key");
    assert.ok(settings.every((row) => row.tenant_id === "tenant-b" || row.tenant_id === "_platform"), "app_state: own rows plus platform rows only");
  });
});
