// API protection is exercised through the production proxy with an atomic Redis-REST test double.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, pbkdf2Sync } from "node:crypto";
import { createServer as createHttpsServer } from "node:https";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { encode } from "next-auth/jwt";

import { Client } from "./helpers/client.mjs";
import { startServer } from "./helpers/server.mjs";

const AUTH_SECRET = "test-secret-not-for-production";
const certDir = mkdtempSync(path.join(tmpdir(), "pharmerp-rate-limit-cert-"));
let redis;
let redisUnavailable = false;
let server;
let admin;
const counters = new Map();

function redisResult(command) {
  const keyCount = Number(command[2]);
  const keys = command.slice(3, 3 + keyCount);
  const now = Number(command[3 + keyCount]);
  const checks = keys.map((key, index) => {
    const offset = 5 + keyCount + index * 3;
    const limit = Number(command[offset]);
    const windowMs = Number(command[offset + 1]);
    const entries = (counters.get(key) ?? []).filter((timestamp) => timestamp > now - windowMs);
    counters.set(key, entries);
    return { key, limit, windowMs, entries, member: command[offset + 2] };
  });

  for (const [index, check] of checks.entries()) {
    if (check.entries.length >= check.limit) {
      return [0, index + 1, check.limit, 0, check.entries[0] + check.windowMs];
    }
  }

  let bestRemaining = Number.POSITIVE_INFINITY;
  let bestLimit = 0;
  let bestReset = now;
  for (const check of checks) {
    check.entries.push(now);
    counters.set(check.key, check.entries);
    const remaining = check.limit - check.entries.length;
    if (remaining < bestRemaining) {
      bestRemaining = remaining;
      bestLimit = check.limit;
      bestReset = now + check.windowMs;
    }
  }
  return [1, 0, bestLimit, bestRemaining, bestReset];
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const listener = createNetServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const { port } = listener.address();
      listener.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function mobileToken(id, tenantId) {
  return encode({
    token: { id, tenantId, mobile: true, signedInAt: Date.now() },
    secret: AUTH_SECRET,
    maxAge: 60 * 60,
  });
}

async function request(pathname, { ip, id = "anonymous", tenantId = "tenant-demo", method = "GET" }) {
  const token = id === "anonymous" ? null : await mobileToken(id, tenantId);
  const response = await fetch(`${server.baseUrl}${pathname}`, {
    method,
    headers: {
      "x-rate-limit-test-ip": ip,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    redirect: "manual",
  });
  return response;
}

async function savePolicy(scopeType, scopeValue, { requestsPerMinute, burst = 0, windowSeconds = 60, blockSeconds = 0 }, id, category = "api_general") {
  const result = await admin.post("/api/platform/rate-limits", {
    action: "policy",
    policy: {
      ...(id ? { id } : {}),
      category,
      label: `Test ${scopeType} policy`,
      scopeType,
      scopeValue,
      enabled: true,
      requestsPerMinute,
      burst,
      windowSeconds,
      blockSeconds,
    },
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

before(async () => {
  const keyPath = path.join(certDir, "key.pem");
  const certPath = path.join(certDir, "cert.pem");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath,
    "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ], { stdio: "ignore" });
  const redisPort = await freePort();
  redis = createHttpsServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, (incoming, outgoing) => {
    const chunks = [];
    incoming.on("data", (chunk) => chunks.push(chunk));
    incoming.on("end", () => {
      if (redisUnavailable) {
        outgoing.writeHead(503).end();
        return;
      }
      const command = JSON.parse(Buffer.concat(chunks).toString());
      outgoing.writeHead(200, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ result: redisResult(command) }));
    });
  });
  await new Promise((resolve) => redis.listen(redisPort, "127.0.0.1", resolve));

  server = await startServer({
    UPSTASH_REDIS_REST_URL: `https://127.0.0.1:${redisPort}`,
    UPSTASH_REDIS_REST_TOKEN: "test-only-token",
    NODE_EXTRA_CA_CERTS: certPath,
    RATE_LIMIT_TRUSTED_PROXY_HEADER: "x-rate-limit-test-ip",
    RATE_LIMITING_FORCE_OFF: "0",
  });
  const salt = randomBytes(16).toString("hex");
  const password = "Test-Platform-2026";
  const passwordHash = `${salt}:${pbkdf2Sync(password, salt, 310000, 32, "sha256").toString("hex")}`;
  await server.query(
    "INSERT INTO platform_users (id, email, name, role, password_hash) VALUES ('rate-limit-admin', 'rate-limits@test.invalid', 'Rate Limit Admin', 'PLATFORM_SUPER_ADMIN', ?)",
    passwordHash,
  );
  await server.query(
    "INSERT INTO tenants (id, slug, name) VALUES ('tenant-rate-a', 'rate-a', 'Rate Test A'), ('tenant-rate-b', 'rate-b', 'Rate Test B'), ('tenant-rate-c', 'rate-c', 'Rate Test C')",
  );
  admin = new Client(server.baseUrl);
  const login = await admin.post("/api/platform/login", { email: "rate-limits@test.invalid", password });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  admin.headers["x-rate-limit-test-ip"] = "198.51.100.254";

  await savePolicy("global", "", { requestsPerMinute: 100_000 }, "rlp-api-general");
  const enabled = await admin.post("/api/platform/rate-limits", { action: "config", enabled: true });
  assert.equal(enabled.status, 200, JSON.stringify(enabled.data));
});

after(async () => {
  await server?.stop();
  if (redis?.listening) await new Promise((resolve) => redis.close(resolve));
  rmSync(certDir, { recursive: true, force: true });
});

describe("distributed API rate limiting", () => {
  test("allows requests below the limit, applies burst allowance, and returns standard 429 headers", async () => {
    const ip = "198.51.100.10";
    await savePolicy("ip", ip, { requestsPerMinute: 1, burst: 1 });
    assert.notEqual((await request("/api/burst-check", { ip })).status, 429);
    assert.notEqual((await request("/api/burst-check", { ip })).status, 429);
    const limited = await request("/api/burst-check", { ip });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) >= 1);
    assert.ok(Number(limited.headers.get("ratelimit-limit")) >= 2);
    assert.equal(limited.headers.get("ratelimit-remaining"), "0");
    assert.ok(Number(limited.headers.get("ratelimit-reset")) > 0);
    assert.match((await limited.json()).error, /too many requests/i);
  });

  test("applies the configured registration category before the registration handler", async () => {
    const ip = "198.51.100.12";
    await savePolicy("ip", ip, { requestsPerMinute: 1 }, undefined, "registration");
    const first = await request("/api/register", { ip, method: "POST" });
    assert.notEqual(first.status, 429);
    assert.equal((await request("/api/register", { ip, method: "POST" })).status, 429);
  });

  test("applies the stricter login category before credential handlers", async () => {
    const ip = "198.51.100.14";
    await savePolicy("ip", ip, { requestsPerMinute: 1 }, undefined, "login");
    const first = await request("/api/platform/login", { ip, method: "POST" });
    assert.notEqual(first.status, 429);
    assert.equal((await request("/api/platform/login", { ip, method: "POST" })).status, 429);
  });

  test("applies the public-forms category to the existing plural contacts API route", async () => {
    const ip = "198.51.100.13";
    await savePolicy("ip", ip, { requestsPerMinute: 1 }, undefined, "public_forms");
    const first = await request("/api/contacts", { ip, method: "POST" });
    assert.notEqual(first.status, 429);
    assert.equal((await request("/api/contacts", { ip, method: "POST" })).status, 429);
  });

  test("expires sliding-window counters", async () => {
    const ip = "198.51.100.11";
    await savePolicy("ip", ip, { requestsPerMinute: 1, windowSeconds: 1 });
    assert.notEqual((await request("/api/window-check", { ip })).status, 429);
    assert.equal((await request("/api/window-check", { ip })).status, 429);
    await wait(1_100);
    assert.notEqual((await request("/api/window-check", { ip })).status, 429);
  });

  test("isolates tenant and user limits using signed mobile credentials", async () => {
    await savePolicy("tenant", "tenant-rate-a", { requestsPerMinute: 1 });
    assert.notEqual((await request("/api/tenant-check", { ip: "198.51.100.20", id: "shared-user", tenantId: "tenant-rate-a" })).status, 429);
    assert.equal((await request("/api/tenant-check", { ip: "198.51.100.21", id: "shared-user", tenantId: "tenant-rate-a" })).status, 429);
    assert.notEqual((await request("/api/tenant-check", { ip: "198.51.100.22", id: "shared-user", tenantId: "tenant-rate-b" })).status, 429);

    await savePolicy("user", "rate-limited-user", { requestsPerMinute: 1 });
    assert.notEqual((await request("/api/user-check", { ip: "198.51.100.23", id: "rate-limited-user" })).status, 429);
    assert.equal((await request("/api/user-check", { ip: "198.51.100.24", id: "rate-limited-user" })).status, 429);
    assert.notEqual((await request("/api/user-check", { ip: "198.51.100.25", id: "different-user" })).status, 429);
  });

  test("applies role overrides to the live tenant membership role", async () => {
    const [superAdmin] = await server.query(
      "SELECT m.user_id, m.role FROM tenant_memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = 'tenant-demo' AND u.email = 'admin@web365.ng'",
    );
    const [cashier] = await server.query(
      "SELECT m.user_id, m.role FROM tenant_memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = 'tenant-demo' AND u.email = 'cashier@web365.ng'",
    );
    await savePolicy("role", superAdmin.role, { requestsPerMinute: 1 });
    assert.notEqual((await request("/api/role-check", { ip: "198.51.100.26", id: superAdmin.user_id })).status, 429);
    assert.equal((await request("/api/role-check", { ip: "198.51.100.27", id: superAdmin.user_id })).status, 429);
    assert.notEqual((await request("/api/role-check", { ip: "198.51.100.28", id: cashier.user_id })).status, 429);
  });

  test("enforces an endpoint override independently for each tenant", async () => {
    const endpoint = "/api/endpoint-override-check";
    await savePolicy("endpoint", endpoint, { requestsPerMinute: 1 });
    assert.notEqual((await request(endpoint, { ip: "198.51.100.30", id: "endpoint-user", tenantId: "tenant-rate-c" })).status, 429);
    assert.equal((await request(endpoint, { ip: "198.51.100.31", id: "endpoint-user", tenantId: "tenant-rate-c" })).status, 429);
    assert.notEqual((await request(endpoint, { ip: "198.51.100.32", id: "endpoint-user", tenantId: "tenant-rate-b" })).status, 429);
  });

  test("enforces IP-specific limits and skips only that dimension for allowlisted addresses", async () => {
    const ip = "198.51.100.40";
    await savePolicy("ip", ip, { requestsPerMinute: 1 });
    assert.notEqual((await request("/api/ip-check", { ip })).status, 429);
    assert.equal((await request("/api/ip-check", { ip })).status, 429);
    const allowlisted = await admin.post("/api/platform/rate-limits", {
      action: "ip-rule",
      address: ip,
      effect: "allow",
      reason: "Rate-limit integration test",
    });
    assert.equal(allowlisted.status, 200, JSON.stringify(allowlisted.data));
    assert.notEqual((await request("/api/ip-check", { ip })).status, 429);
  });

  test("atomically limits concurrent requests", async () => {
    const ip = "198.51.100.50";
    await savePolicy("ip", ip, { requestsPerMinute: 2 });
    const responses = await Promise.all(Array.from({ length: 4 }, () => request("/api/concurrent-check", { ip })));
    assert.equal(responses.filter((response) => response.status === 429).length, 2);
    assert.ok(responses.every((response) => response.status === 429 || response.status === 404));
  });

  test("expires automatic temporary blocks", async () => {
    const ip = "198.51.100.60";
    await savePolicy("ip", ip, { requestsPerMinute: 1, windowSeconds: 1, blockSeconds: 1 });
    assert.notEqual((await request("/api/temporary-block-check", { ip })).status, 429);
    assert.equal((await request("/api/temporary-block-check", { ip })).status, 429);
    assert.equal((await request("/api/temporary-block-check", { ip })).status, 429);
    await wait(1_100);
    assert.notEqual((await request("/api/temporary-block-check", { ip })).status, 429);
  });

  test("fails closed with 503 when distributed Redis storage is unavailable", async () => {
    redisUnavailable = true;
    try {
      assert.equal((await request("/api/redis-outage-check", { ip: "198.51.100.70" })).status, 503);
    } finally {
      redisUnavailable = false;
    }
  });
});
