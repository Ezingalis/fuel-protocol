/* Fuel Protocol — app + config structural tests
   Fast, no network, no server: validates the shipped files agree with
   the architecture (single-file app, secrets only in env, hashed tokens).
   Run: node --test tests/app.test.mjs
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = f => readFileSync(join(root, f), "utf8");

const html = read("public/index.html");
const worker = read("worker.js");
const schema = read("schema.sql");
const wranglerCfg = read("wrangler.jsonc");
const pkg = JSON.parse(read("package.json"));
const gitignore = read(".gitignore");

/* ---------- public/index.html ---------- */

test("app: file exists and is substantial", () => {
  assert.ok(existsSync(join(root, "public/index.html")));
  assert.ok(html.length > 40_000, `index.html is only ${html.length} bytes`);
});

test("app: is a complete single-file document", () => {
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<\/html>\s*$/i);
  assert.match(html, /<title>Fuel Protocol/);
  assert.match(html, /<meta name="viewport"/);
});

test("app: uses the v5 storage key (and migrates v4)", () => {
  assert.ok(html.includes("fuelprotocol:v5"), "missing v5 storage key");
  assert.ok(html.includes("fuelprotocol:v4"), "v4 migration path removed");
});

test("app: calls every worker endpoint it depends on", () => {
  for (const ep of [
    "/api/health", "/api/search", "/api/barcode",
    "/api/auth/request", "/api/auth/logout", "/api/me", "/api/state",
    "/api/plan/share", "/api/plan/shared"
  ]) {
    assert.ok(html.includes(ep), `app never references ${ep}`);
  }
});

test("workouts: exercise library is present and well-shaped", () => {
  const ex = JSON.parse(read("public/exercises.json"));
  assert.ok(Array.isArray(ex) && ex.length > 800, `only ${ex.length} exercises`);
  for (const item of [ex[0], ex[ex.length - 1]]) {
    for (const k of ["n", "m", "e", "c"]) assert.ok(k in item, `exercise missing field ${k}`);
  }
});

test("workouts: tab, library fetch, and session flow wired in", () => {
  assert.ok(html.includes("/exercises.json"), "app never loads the exercise library");
  assert.ok(html.includes('["gym","Workout"]'), "Workout tab missing from tab bar");
  for (const act of ["gymstart", "gymfinish", "gymset", "grsave", "gppick"]) {
    assert.ok(html.includes(`"${act}"`), `missing workout action ${act}`);
  }
  assert.ok(html.includes("gym:{week:{}"), "gym state missing from freshDB");
});

test("app: tab bar steps aside for sheets and the keyboard", () => {
  assert.match(html, /body\.has-sheet \.tabbar/, "open sheets must hide the tab bar (it paints over them otherwise)");
  assert.ok(html.includes('classList.toggle("has-sheet"'), "render must toggle has-sheet");
  assert.match(html, /body\.kb \.tabbar/, "focused inputs must hide the tab bar");
});

test("design: dark mode, self-hosted font, no emoji icons or em-dashes in UI copy", () => {
  assert.match(html, /@media \(prefers-color-scheme:dark\)/, "dark-mode tokens missing");
  assert.ok(existsSync(join(root, "public/fonts/Geist-Variable.woff2")), "Geist font file missing");
  assert.match(html, /url\("\/fonts\/Geist-Variable\.woff2"\)/, "font must be self-hosted");
  const script = html.slice(html.indexOf("<script>"))
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(script, /\u2014|\\u2014/, "em-dash in UI strings");
  assert.doesNotMatch(script, /[\u{1F300}-\u{1FAFF}]|\\ud83d/u, "emoji used as an icon");
  assert.ok(html.includes("function IC("), "icon helper missing");
});

test("app: undo toast wired up", () => {
  assert.ok(html.includes('id="toast"'), "toast container missing");
  assert.ok(html.includes('data-act="undo"'), "undo action missing");
});

test("app: swipe delete is leftward with right-side delete zone", () => {
  assert.ok(html.includes("dx<-12"), "swipe should activate on leftward drag");
  assert.match(html, /justify-content:flex-end/, "delete zone should sit on the right");
});

test("app: only allowed external resource is the zxing barcode lib", () => {
  const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map(m => m[1]);
  for (const url of external) {
    assert.ok(url.startsWith("https://unpkg.com/@zxing/"),
      `unexpected external resource: ${url}`);
  }
});

test("app: barcode lib is version-pinned with SRI integrity", () => {
  assert.match(html, /unpkg\.com\/@zxing\/library@0\.20\.0\/umd\/index\.min\.js/,
    "zxing must pin the exact file, not a bare package URL");
  assert.match(html, /integrity="sha384-[A-Za-z0-9+/=]+"/, "SRI hash missing");
  assert.match(html, /crossOrigin="anonymous"/, "crossOrigin required for SRI");
});

test("app: no API keys or bearer tokens baked into the page", () => {
  assert.doesNotMatch(html, /re_[A-Za-z0-9]{16,}/, "looks like a Resend key");
  assert.doesNotMatch(html, /Bearer\s+[A-Za-z0-9_\-.]{20,}/, "looks like a bearer token");
});

/* ---------- worker.js ---------- */

test("worker: secrets are read from env, never inlined", () => {
  for (const name of ["SESSION_SECRET", "RESEND_KEY", "FS_KEY", "FS_SECRET", "ANTHROPIC_API_KEY"]) {
    assert.ok(worker.includes("env." + name), `worker never reads env.${name}`);
  }
  assert.doesNotMatch(worker, /re_[A-Za-z0-9]{16,}/);
  assert.doesNotMatch(worker + html, /sk-ant-[A-Za-z0-9_-]{10,}/, "looks like an Anthropic key");
  assert.doesNotMatch(worker, /SESSION_SECRET\s*=\s*["']/, "SESSION_SECRET assigned a literal");
});

test("worker: session cookie is HttpOnly + Secure + SameSite", () => {
  assert.match(worker, /HttpOnly/);
  assert.match(worker, /Secure/);
  assert.match(worker, /SameSite=Lax/);
});

test("worker: magic-link tokens are stored only as hashes", () => {
  const insert = worker.match(/INSERT INTO magic_links[^"]*/);
  assert.ok(insert, "magic_links insert not found");
  assert.ok(insert[0].includes("token_hash"), "insert must use token_hash");
  assert.ok(worker.includes("sha256hex(token)"), "token must be hashed before storage");
});

test("worker: sign-in links are rate limited and single-use", () => {
  assert.match(worker, /60000/, "60s rate-limit window missing");
  assert.match(worker, /used_at/, "single-use marker missing");
});

test("worker: dev link only revealed behind ALLOW_DEV_LINK", () => {
  assert.match(worker, /ALLOW_DEV_LINK\s*===\s*"1"/);
});

test("worker: sign-in requests carry a per-IP daily cap", () => {
  assert.ok(worker.includes("ip_hash"), "IP hash column unused");
  assert.ok(worker.includes("IP_LINKS_PER_DAY"), "cap must be env-tunable");
  assert.match(worker, /CF-Connecting-IP/, "must read the client IP header");
});

test("worker: 500s return a generic error, not internals", () => {
  assert.ok(worker.includes('json({ error: "server_error" }, 500)'));
  assert.doesNotMatch(worker, /error:\s*String\(e/, "error messages must not be echoed");
});

/* ---------- schema.sql ---------- */

test("workouts: PDF import is session-gated, size-capped, and rate-limited", () => {
  const i = worker.indexOf('"/api/gym/import"');
  assert.ok(i > 0, "import route missing");
  const block = worker.slice(i, i + 1400);
  for (const must of ["readSession", "IMPORT_MAX_BYTES", "%PDF-", "IMPORTS_PER_DAY"]) {
    assert.ok(block.includes(must), `import route missing ${must}`);
  }
  assert.ok(html.includes("/api/gym/import"), "app never calls the import endpoint");
  assert.ok(html.includes('id="pdfin"'), "PDF picker missing");
});

test("programs: in-app imports capped at 1/day; program codes open in the Workout tab", () => {
  assert.match(wranglerCfg, /"IMPORTS_PER_DAY":\s*"1"/);
  assert.ok(html.includes('data-act="progcodeimp"'), "program code box missing");
  assert.ok(html.includes('kind==="program"'), "code import must check it's a program");
  assert.ok(html.includes("programDraftFrom(pl.program)"), "code imports must be coerced");
});

test("programs: chat-side conversions use the same gate as the in-app reader", async () => {
  const { cleanProgram, PROGRAM_SCHEMA } = await import("../program.js");
  assert.ok(worker.includes('from "./program.js"'), "worker must import the shared program module");
  assert.ok(PROGRAM_SCHEMA.properties.blocks, "schema missing blocks");
  const p = cleanProgram({ program: "X", notes: "", total_weeks: 3, blocks: [
    { label: "Week 1-2", weeks: 2, deload: false, sessions: [{ name: "Day 1", days: [], exercises: [
      { name: "Squat", muscle: "quadriceps", sets: 3, reps: 5, target: "5 @ RPE 8", lb: 0, rest_sec: 180, notes: "" }] }] }] });
  assert.equal(p.weeks.length, 3);
  assert.equal(p.weeks[2].repeated, true);
  assert.throws(() => cleanProgram({ blocks: [] }), /no_workouts/);
});

test("programs: week controls exist and every move is undoable", () => {
  for (const act of ["prognext", "progskip", "progback", "progredo", "progrestart", "progend", "progstart", "gimstart"]) {
    assert.ok(html.includes(`"${act}"`), `missing program action ${act}`);
  }
  assert.ok(html.includes('id="progjump"'), "jump-to-week picker missing");
  assert.ok(html.includes("UNDO.gym=snap"), "program changes must snapshot for undo");
  assert.ok(html.includes("programs:[],active:null"), "program state missing from freshDB");
});

test("schema: defines the five tables", () => {
  for (const t of ["users", "state", "magic_links", "shared_plans", "gym_imports"]) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${t}`), `missing table ${t}`);
  }
});

test("worker: plan sharing exists and requires a session", () => {
  assert.ok(worker.includes('"/api/plan/share"'), "share route missing");
  assert.ok(worker.includes('"/api/plan/shared"'), "shared-fetch route missing");
  const shareIdx = worker.indexOf('"/api/plan/share"');
  const block = worker.slice(shareIdx, shareIdx + 400);
  assert.ok(block.includes("readSession"), "share must check the session");
});

test("schema: magic_links keyed by token_hash, never raw token", () => {
  assert.match(schema, /token_hash\s+TEXT\s+PRIMARY KEY/);
  assert.doesNotMatch(schema, /\btoken\s+TEXT/, "raw token column must not exist");
});

test("schema: lookup indexes exist", () => {
  assert.match(schema, /idx_links_email/);
  assert.match(schema, /idx_links_expires/);
  assert.match(schema, /idx_links_ip/);
});

test("schema: IP stored only as a hash", () => {
  assert.match(schema, /ip_hash\s+TEXT/);
  assert.doesNotMatch(schema, /\bip\s+TEXT/, "raw IP column must not exist");
});

/* ---------- wrangler.jsonc ---------- */

test("config: no placeholder database id left behind", () => {
  assert.ok(!wranglerCfg.includes("PASTE_YOUR"), "database_id placeholder still present");
});

test("config: worker entry, assets dir, and DB binding wired", () => {
  assert.match(wranglerCfg, /"main":\s*"worker\.js"/);
  assert.match(wranglerCfg, /"directory":\s*"\.\/public"/);
  assert.match(wranglerCfg, /"binding":\s*"DB"/);
  assert.match(wranglerCfg, /"compatibility_date":\s*"\d{4}-\d{2}-\d{2}"/);
});

/* ---------- project hygiene ---------- */

test("hygiene: npm scripts present", () => {
  for (const s of ["dev", "deploy", "test", "db:schema"]) {
    assert.ok(pkg.scripts[s], `missing npm script "${s}"`);
  }
});

test("hygiene: gitignore shields secrets and local state", () => {
  for (const entry of [".dev.vars", "node_modules", ".wrangler"]) {
    assert.ok(gitignore.includes(entry), `.gitignore missing ${entry}`);
  }
});
