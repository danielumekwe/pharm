// Email delivery failures are logged and queued for retry (not lost, not marked as sent).
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { after, before, test } from "node:test";

import { signedIn } from "./helpers/client.mjs";
import { startServer } from "./helpers/server.mjs";

let server;
before(async () => {
  // An SMTP port that refuses connections: every send fails at the transport level.
  const port = await new Promise((resolve) => {
    const probe = createServer().listen(0, () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
  server = await startServer({ EMAIL_TRANSPORT: "", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(port), ALERT_EMAIL_FROM: "alerts@pharmacy.test" });
});
after(async () => {
  await server?.stop();
});

test("failed alert emails are recorded and scheduled for retry with backoff", async () => {
  const admin = await signedIn(server.baseUrl, "admin@web365.ng");
  assert.equal((await admin.patch("/api/alerts/config", { action: "email", enabled: true, maxRetries: 3, recipients: ["procurement@example.com"] })).status, 200);
  assert.equal((await admin.patch("/api/alerts/thresholds", { productId: "prod-8", minStock: 140, maxStock: null })).status, 200);

  let rows = [];
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    rows = await server.query("SELECT d.status, d.attempts, d.next_attempt_at, d.detail, d.payload FROM notification_deliveries d JOIN inventory_alerts a ON a.id = d.alert_id WHERE d.channel = 'EMAIL' AND a.key = 'LOW_STOCK:outlet-1:prod-8'");
    if (rows.length && rows.every((row) => row.status !== null)) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(rows.length >= 1, "email attempts are logged");
  for (const row of rows) {
    assert.equal(row.status, "RETRYING", `not marked as sent: ${row.detail}`);
    assert.equal(row.attempts, 1);
    const delay = Date.parse(row.next_attempt_at) - Date.now();
    assert.ok(delay > 60_000 && delay <= 120_000, "first retry scheduled about 2 minutes later");
    assert.ok(JSON.parse(row.payload).text.includes("Artemether"), "content kept for an identical retry");
  }
});
