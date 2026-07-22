/* Fuel Protocol — worker integration tests
   Boots `wrangler dev` against the LOCAL D1 database (never remote),
   then exercises the real HTTP surface: health, auth round trip,
   state sync, and input validation.
   Run: node --test tests/worker.test.mjs   (first run downloads workerd)
*/
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
let dev;

/* Unique per run: local D1 persists in .wrangler/state between runs,
   and /api/auth/request rate-limits an email to one link per 60s. */
const EMAIL = `test-${Date.now()}@example.com`;

before(async () => {
  execSync("npx wrangler d1 execute fuel-protocol-db --local --file=./schema.sql", {
    cwd: root, stdio: "pipe"
  });
  dev = spawn("npx", ["wrangler", "dev", "--port", String(PORT)], {
    cwd: root, stdio: "pipe", detached: true
  });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise(res => setTimeout(res, 500));
  }
  throw new Error("wrangler dev did not become ready within 90s");
});

after(() => {
  if (dev?.pid) {
    try { process.kill(-dev.pid, "SIGTERM"); } catch { try { dev.kill("SIGTERM"); } catch {} }
  }
});

/* ---------- health + static ---------- */

test("health: accounts on (local D1 + dev secret), email/fs off", async () => {
  const j = await (await fetch(`${BASE}/api/health`)).json();
  assert.equal(j.ok, true);
  assert.equal(j.accounts, true);
  assert.equal(j.email, false);
  assert.equal(j.fs, false);
});

test("static: root serves the app", async () => {
  const r = await fetch(BASE + "/");
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Fuel Protocol/);
});

test("api: CORS preflight answered", async () => {
  const r = await fetch(`${BASE}/api/search`, { method: "OPTIONS" });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
});

test("api: unknown route is 404", async () => {
  const r = await fetch(`${BASE}/api/nope`);
  assert.equal(r.status, 404);
});

/* ---------- input validation ---------- */

test("search: empty query returns empty items without upstream calls", async () => {
  const j = await (await fetch(`${BASE}/api/search?q=`)).json();
  assert.deepEqual(j, { items: [] });
});

test("barcode: missing code is 400", async () => {
  const r = await fetch(`${BASE}/api/barcode`);
  assert.equal(r.status, 400);
});

test("food: missing id is 400; unknown id without FS keys is empty", async () => {
  assert.equal((await fetch(`${BASE}/api/food`)).status, 400);
  const j = await (await fetch(`${BASE}/api/food?id=123`)).json();
  assert.deepEqual(j, { items: [] });
});

test("auth: invalid email rejected", async () => {
  const r = await fetch(`${BASE}/api/auth/request`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "not-an-email" })
  });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, "email");
});

/* ---------- full auth + sync round trip ---------- */

let devLink, cookie;

test("auth: request returns dev link when email is unconfigured", async () => {
  const r = await fetch(`${BASE}/api/auth/request`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL })
  });
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.ok(j.devLink?.includes("/api/auth/verify?token="), "devLink missing");
  devLink = j.devLink.replace(/^https?:\/\/[^/]+/, BASE);
});

test("auth: immediate second request is rate limited", async () => {
  const r = await fetch(`${BASE}/api/auth/request`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL })
  });
  assert.equal(r.status, 429);
});

test("auth: verify sets session cookie and redirects signed in", async () => {
  const r = await fetch(devLink, { redirect: "manual" });
  assert.equal(r.status, 302);
  assert.match(r.headers.get("location"), /signedin=1/);
  const setCookie = r.headers.get("set-cookie");
  assert.match(setCookie, /fp_session=/);
  assert.match(setCookie, /HttpOnly/);
  cookie = setCookie.split(";")[0];
});

test("auth: magic link is single-use", async () => {
  const r = await fetch(devLink, { redirect: "manual" });
  assert.equal(r.status, 302);
  assert.match(r.headers.get("location"), /expired=1/);
});

test("me: session cookie identifies the user", async () => {
  const j = await (await fetch(`${BASE}/api/me`, { headers: { Cookie: cookie } })).json();
  assert.equal(j.email, EMAIL);
  assert.ok(j.uid);
});

test("me: no cookie is signed out", async () => {
  assert.equal((await fetch(`${BASE}/api/me`)).status, 401);
});

test("me: tampered signature is rejected", async () => {
  const forged = cookie.slice(0, -1) + (cookie.endsWith("A") ? "B" : "A");
  const r = await fetch(`${BASE}/api/me`, { headers: { Cookie: forged } });
  assert.equal(r.status, 401);
});

test("state: PUT then GET round-trips the diary blob", async () => {
  const state = { settings: { kcal: 2200 }, days: { "2026-07-21": { meals: [["oats"]] } } };
  const put = await fetch(`${BASE}/api/state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ state, updatedAt: 1753000000000 })
  });
  assert.equal((await put.json()).ok, true);

  const got = await (await fetch(`${BASE}/api/state`, { headers: { Cookie: cookie } })).json();
  assert.deepEqual(got.state, state);
  assert.equal(got.updatedAt, 1753000000000);
});

test("state: malformed bodies rejected", async () => {
  const hdrs = { "Content-Type": "application/json", Cookie: cookie };
  const bad = await fetch(`${BASE}/api/state`, { method: "PUT", headers: hdrs, body: "{oops" });
  assert.equal(bad.status, 400);
  const noState = await fetch(`${BASE}/api/state`, {
    method: "PUT", headers: hdrs, body: JSON.stringify({ state: "not-an-object" })
  });
  assert.equal(noState.status, 400);
});

test("state: unauthenticated access denied", async () => {
  assert.equal((await fetch(`${BASE}/api/state`)).status, 401);
});

test("logout: clears the cookie", async () => {
  const r = await fetch(`${BASE}/api/auth/logout`, { headers: { Cookie: cookie } });
  assert.equal((await r.json()).ok, true);
  assert.match(r.headers.get("set-cookie"), /Max-Age=0/);
});
