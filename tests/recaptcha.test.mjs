// reCAPTCHA v3 on the public forms, checked against a fake Google siteverify endpoint.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, describe, test } from "node:test";

import { Client } from "./helpers/client.mjs";
import { startServer } from "./helpers/server.mjs";

const SECRET = "test-recaptcha-secret";
// Token -> what the fake Google answers for it.
const answers = {
  "good-login": { success: true, score: 0.9, action: "login" },
  "good-forgot": { success: true, score: 0.9, action: "forgot_password" },
  "bot-login": { success: true, score: 0.1, action: "login" },
  "wrong-action": { success: true, score: 0.9, action: "register" },
};
const seen = [];

const fake = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    const form = new URLSearchParams(body);
    seen.push(form.get("response"));
    const answer = form.get("secret") === SECRET ? answers[form.get("response")] ?? { success: false, "error-codes": ["invalid-input-response"] } : { success: false, "error-codes": ["invalid-input-secret"] };
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(answer));
  });
});

let server;
before(async () => {
  await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
  server = await startServer({ RECAPTCHA: "on", RECAPTCHA_SECRET_KEY: SECRET, RECAPTCHA_VERIFY_URL: `http://127.0.0.1:${fake.address().port}` });
});
after(async () => {
  await server?.stop();
  fake.close();
});

const step1 = (recaptchaToken) =>
  fetch(`${server.baseUrl}/api/auth/pharmacies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "admin@web365.ng", password: "Admin@123", ...(recaptchaToken ? { recaptchaToken } : {}) }),
  });

async function credentialsSignIn(recaptchaToken) {
  const client = new Client(server.baseUrl);
  const csrfToken = await client.csrf();
  const response = await fetch(`${server.baseUrl}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { cookie: client.cookieHeader(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, identifier: "admin@web365.ng", password: "Admin@123", outletId: "HQ", json: "true", ...(recaptchaToken ? { recaptchaToken } : {}) }),
  });
  const location = response.headers.get("location") ?? (await response.json().catch(() => ({}))).url ?? "";
  return new URL(location, server.baseUrl).searchParams.get("error");
}

describe("reCAPTCHA", () => {
  test("sign-in step 1 needs a good token", async () => {
    assert.equal((await step1()).status, 400);
    assert.equal((await step1("nonsense")).status, 400);
    assert.equal((await step1("bot-login")).status, 400);
    assert.equal((await step1("wrong-action")).status, 400);
    const ok = await step1("good-login");
    assert.equal(ok.status, 200);
    assert.ok((await ok.json()).pharmacies.length);
  });

  test("the credentials sign-in cannot skip it", async () => {
    assert.match(await credentialsSignIn() ?? "", /robot/);
    assert.match(await credentialsSignIn("bot-login") ?? "", /automated/);
    assert.equal(await credentialsSignIn("good-login"), null);
  });

  test("registration and password reset need a token", async () => {
    const register = await fetch(`${server.baseUrl}/api/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    assert.equal(register.status, 422, "invalid fields are still reported first");
    const forgot = (recaptchaToken) => fetch(`${server.baseUrl}/api/auth/password/forgot`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@web365.ng", recaptchaToken }) });
    assert.equal((await forgot(undefined)).status, 400);
    assert.equal((await forgot("good-forgot")).status, 200);
  });

  test("the Control Centre sign-in needs a token", async () => {
    const response = await fetch(`${server.baseUrl}/api/platform/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "nobody@web365.ng", password: "x" }) });
    assert.equal(response.status, 400);
  });

  test("the secret key is sent to Google", () => {
    assert.ok(seen.includes("good-login"));
  });
});
