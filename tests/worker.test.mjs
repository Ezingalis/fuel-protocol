/* Fuel Protocol — worker integration tests
   Boots `wrangler dev` against the LOCAL D1 database (never remote),
   then exercises the real HTTP surface: health, auth round trip,
   state sync, and input validation.
   Run: node --test tests/worker.test.mjs   (first run downloads workerd)
*/
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const MOCK_PORT = 8798;
let dev, mock;

/* Unique per run: local D1 persists in .wrangler/state between runs,
   and /api/auth/request rate-limits an email to one link per 60s. */
const EMAIL = `test-${Date.now()}@example.com`;

/* Stand-in for api.anthropic.com so the Claude import path runs end to end
   (Files upload -> streamed Messages call -> file delete) without a real key.
   `MOCK.mode` picks the canned reply for the next Messages call. */
const MOCK = { mode: "program", uploads: [], messages: [], deletes: [] };
const ex = (o) => Object.assign({ muscle: "chest", sets: 3, reps: 8, target: "", lb: 0, rest_sec: 120, notes: "" }, o);
const MOCK_PROGRAM = {
  program: "Test Block Program", notes: "Two days a week; loads by %1RM.", total_weeks: 5,
  blocks: [
    { label: "Week 1-2", weeks: 2, deload: false, sessions: [
      { name: "Day 1", days: [1, 9, 1], exercises: [
        ex({ name: "Barbell Bench Press", sets: 4, reps: 6, target: "6 reps @ 75-80% 1RM", lb: 137, rest_sec: 240 }),
        ex({ name: "Plank", muscle: "banana", sets: 50, reps: 500, lb: -20, rest_sec: 99999, notes: "60 s" })
      ] },
      { name: "Empty day", days: [], exercises: [] }
    ] },
    { label: "Week 3 - Deload", weeks: 1, deload: true, sessions: [
      { name: "Day 1", days: [], exercises: [ex({ name: "Barbell Bench Press", sets: 2, reps: 6 })] }
    ] },
    { label: "Nothing here", weeks: 1, deload: false, sessions: [] }
  ]
};
function sse(res, text, stopReason) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev("message_start", { message: { id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5",
    content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } });
  ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
  if (text) ev("content_block_delta", { index: 0, delta: { type: "text_delta", text } });
  ev("content_block_stop", { index: 0 });
  ev("message_delta", { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 20 } });
  ev("message_stop", {});
  res.end();
}
function startMock() {
  mock = createServer((req, res) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const path = req.url.split("?")[0];
      if (req.method === "POST" && path === "/v1/files") {
        MOCK.uploads.push({ hasPdf: body.includes("%PDF-"), auth: req.headers["x-api-key"] });
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ id: "file_mock1", type: "file", filename: "program.pdf",
          mime_type: "application/pdf", size_bytes: body.length, created_at: new Date().toISOString(),
          downloadable: false, expires_at: null }));
      }
      if (req.method === "POST" && path === "/v1/messages") {
        MOCK.messages.push({ body: JSON.parse(body.toString()), beta: req.headers["anthropic-beta"] || "" });
        if (MOCK.mode === "refusal") return sse(res, "", "refusal");
        return sse(res, JSON.stringify(MOCK_PROGRAM), "end_turn");
      }
      if (req.method === "DELETE" && path.startsWith("/v1/files/")) {
        MOCK.deletes.push(path.slice("/v1/files/".length));
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ id: "file_mock1", type: "file_deleted" }));
      }
      res.writeHead(404); res.end();
    });
  });
  return new Promise(res => mock.listen(MOCK_PORT, "127.0.0.1", res));
}

before(async () => {
  execSync("npx wrangler d1 execute fuel-protocol-db --local --file=./schema.sql", {
    cwd: root, stdio: "pipe"
  });
  await startMock();
  dev = spawn("npx", ["wrangler", "dev", "--port", String(PORT),
    "--var", "ANTHROPIC_API_KEY:test-key",
    "--var", `ANTHROPIC_BASE_URL:http://127.0.0.1:${MOCK_PORT}`], {
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
  mock?.close();
});

/* ---------- health + static ---------- */

test("health: accounts on (local D1 + dev secret), email/fs off, Claude importer on", async () => {
  const j = await (await fetch(`${BASE}/api/health`)).json();
  assert.equal(j.ok, true);
  assert.equal(j.accounts, true);
  assert.equal(j.email, false);
  assert.equal(j.fs, false);
  assert.equal(j.importer, "claude");
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

/* ---------- plan sharing ---------- */

let planCode;

test("plan share: create returns an 8-char code", async () => {
  const r = await fetch(`${BASE}/api/plan/share`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ plan: { name: "Test cut", days: [
      { name: "Day 1", meals: { bf: [{ id: "a1", name: "Oats", unit: "g", step: 20, base: 60, amt: 60, cal: 230, p: 7.5, c: 40, f: 4 }], lu: [], di: [], sn: [] } }
    ] } })
  });
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.match(j.code, /^[A-Z2-9]{8}$/);
  planCode = j.code;
});

test("plan share: fetch by code round-trips the plan", async () => {
  const j = await (await fetch(`${BASE}/api/plan/shared?code=${planCode}`, { headers: { Cookie: cookie } })).json();
  assert.equal(j.plan.name, "Test cut");
  assert.equal(j.plan.days.length, 1);
  assert.equal(j.plan.days[0].meals.bf[0].name, "Oats");
});

test("plan share: signed-out access denied both directions", async () => {
  assert.equal((await fetch(`${BASE}/api/plan/shared?code=${planCode}`)).status, 401);
  const r = await fetch(`${BASE}/api/plan/share`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
  });
  assert.equal(r.status, 401);
});

test("plan share: malformed and unknown codes rejected", async () => {
  assert.equal((await fetch(`${BASE}/api/plan/shared?code=abc`, { headers: { Cookie: cookie } })).status, 400);
  assert.equal((await fetch(`${BASE}/api/plan/shared?code=ZZZZZZZZ`, { headers: { Cookie: cookie } })).status, 404);
});

test("plan share: empty plan rejected", async () => {
  const r = await fetch(`${BASE}/api/plan/share`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ plan: { name: "x", days: [] } })
  });
  assert.equal(r.status, 400);
});

/* ---------- workout PDF import ---------- */

const PDF = new TextEncoder().encode("%PDF-1.4\n% mock program\n");
const importPdf = (body, headers) => fetch(`${BASE}/api/gym/import`, {
  method: "POST", headers: { "Content-Type": "application/pdf", ...headers }, body
});
const lastLine = t => JSON.parse(t.split("\n").filter(l => l.trim()).pop());

test("import: signed out is 401", async () => {
  assert.equal((await importPdf(PDF)).status, 401);
});

test("import: non-PDF and empty bodies rejected", async () => {
  const notPdf = await importPdf(new TextEncoder().encode("hello world"), { Cookie: cookie });
  assert.equal(notPdf.status, 415);
  assert.equal((await notPdf.json()).error, "not_pdf");
  assert.equal((await importPdf(new Uint8Array(0), { Cookie: cookie })).status, 400);
});

test("import: Claude path returns a cleaned week-by-week program and deletes the upload", async () => {
  MOCK.mode = "program";
  const r = await importPdf(PDF, { Cookie: cookie });
  assert.equal(r.status, 200);
  const out = lastLine(await r.text());
  assert.equal(out.ok, true);
  assert.equal(out.engine, "claude");
  const p = out.program;
  assert.equal(p.program, "Test Block Program");
  assert.deepEqual(p.weeks.map(w => w.label), ["Week 1-2", "Week 1-2", "Week 3 - Deload", "Week 3 - Deload", "Week 3 - Deload"],
    "2-week block expands, empty block dropped, short program padded to total_weeks");
  assert.equal(p.padded, true);
  assert.deepEqual(p.weeks.map(w => w.deload), [false, false, true, true, true]);
  const day1 = p.weeks[0].sessions;
  assert.equal(day1.length, 1, "session with no exercises must be dropped");
  assert.deepEqual(day1[0].days, [1], "days deduped and out-of-range dropped");
  const [bench, plank] = day1[0].exercises;
  assert.deepEqual([bench.lb, bench.rest, bench.target], [135, 240, "6 reps @ 75-80% 1RM"], "load rounded to 5 lb");
  assert.deepEqual([plank.muscle, plank.sets, plank.reps, plank.lb, plank.rest], ["other", 10, 100, 0, 900], "values clamped");

  assert.equal(MOCK.uploads.at(-1).hasPdf, true);
  assert.equal(MOCK.uploads.at(-1).auth, "test-key");
  const sent = MOCK.messages.at(-1);
  assert.equal(sent.body.model, "claude-opus-5-5");
  assert.equal(sent.body.fallbacks, "default");
  assert.match(sent.beta, /server-side-fallback-2026-07-01/);
  assert.equal(sent.body.output_config.format.type, "json_schema");
  assert.deepEqual(sent.body.messages[0].content[0], { type: "document", source: { type: "file", file_id: "file_mock1" } });
  assert.deepEqual(MOCK.deletes, ["file_mock1"], "uploaded PDF must be deleted");
});

test("import: a refusal surfaces as an error without retrying elsewhere", async () => {
  MOCK.mode = "refusal";
  const before = MOCK.messages.length;
  const out = lastLine(await (await importPdf(PDF, { Cookie: cookie })).text());
  assert.equal(out.error, "refused");
  assert.equal(MOCK.messages.length, before + 1);
  assert.equal(MOCK.deletes.length, 2, "file deleted even when the read fails");
  MOCK.mode = "program";
});

test("logout: clears the cookie", async () => {
  const r = await fetch(`${BASE}/api/auth/logout`, { headers: { Cookie: cookie } });
  assert.equal((await r.json()).ok, true);
  assert.match(r.headers.get("set-cookie"), /Max-Age=0/);
});
