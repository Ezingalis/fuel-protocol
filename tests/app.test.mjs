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

test("design: appearance setting can force light or dark", () => {
  assert.match(html, /:root\[data-theme="dark"\]/, "forced-dark tokens missing");
  assert.match(html, /:root:not\(\[data-theme="light"\]\)/, "system dark must yield to a forced light choice");
  for (const v of ["auto", "light", "dark"]) assert.ok(html.includes('data-act="theme" data-v="\'+o[0]+\'"') || html.includes(`"${v}"`), `theme option ${v} missing`);
  assert.ok(html.includes('localStorage.getItem("fuelprotocol:theme")'), "theme must apply before first render");
});

test("programs: any week or single day can be scheduled onto dates, undoably", () => {
  for (const act of ["wksched", "schedgo", "schedprev", "schednext", "schedgap", "planrm"]) {
    assert.ok(html.includes(`"${act}"`), `missing schedule action ${act}`);
  }
  assert.ok(html.includes("plan:{}"), "gym.plan missing from freshDB");
  assert.ok(html.includes('data-src="plan"'), "scheduled sessions must be startable");
  assert.ok(html.includes("UNDO.gymPlan=snap"), "scheduling must be undoable");
});

test("installable: manifest, PNG icons, launch screens, offline worker", () => {
  const man = JSON.parse(read("public/manifest.webmanifest"));
  assert.equal(man.display, "standalone");
  assert.equal(man.start_url, "/");
  assert.ok(man.icons.some(i => i.purpose === "maskable"), "maskable icon missing");
  for (const i of man.icons) assert.ok(existsSync(join(root, "public", i.src)), `missing ${i.src}`);
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png">/, "iOS needs a PNG home-screen icon");
  const splashes = [...html.matchAll(/apple-touch-startup-image" href="([^"]+)"/g)].map(m => m[1]);
  assert.ok(splashes.length >= 8, "launch screens missing");
  for (const f of splashes) assert.ok(existsSync(join(root, "public", f)), `missing ${f}`);
  assert.ok(html.includes('serviceWorker.register("/sw.js")'), "service worker not registered");
  assert.ok(html.includes('addEventListener("online",resync)'), "must resync when the connection returns");
});

test("installable: the worker never caches API calls or writes", () => {
  const sw = read("public/sw.js");
  assert.match(sw, /url\.pathname\.startsWith\("\/api\/"\)/, "API requests must bypass the cache");
  assert.match(sw, /req\.method !== "GET"/, "non-GET requests must bypass the cache");
  assert.match(sw, /caches\.match\("\/"\)/, "app page must open offline");
});

test("invite-only: owner configured, only the owner auto-creates an account", () => {
  assert.match(wranglerCfg, /"OWNER_EMAIL":\s*"[^"@]+@[^"]+"/, "OWNER_EMAIL missing");
  assert.ok(worker.includes('if (row.email !== normalizeEmail(env.OWNER_EMAIL)) return Response.redirect'), "verify must not create accounts for strangers");
  assert.ok(worker.includes('return json({ ok: true, pending: true });'), "new people must get the pending reply");
  assert.ok(html.includes("res.j.pending"), "sign-in screen must show the request-sent state");
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

test("routines: a fuel.routine/v1 export becomes a program whose blocks keep their steps and clips", async () => {
  const { routineToProgram, cleanProgram } = await import("../program.js");
  const routine = { schema: "fuel.routine/v1", name: "Test PPL", author: "coach", schedule: "6 on / 1 off (Sun\u2013Fri, Saturday rest)",
    exercises: {
      press: { name: "Dumbbell Press", category: "Chest / Intermediate", video: "videos/AbCdEfGh1234.mp4" },
      fly: { name: "Cable Fly", category: null, video: "videos/../../etc.mp4" },
      curl: { name: "Barbell Curl", category: null, video: "videos/CurlClip5678.mp4" },
      drag: { name: "Barbell Drag Curl", category: null, video: "videos/DragClip9012.mp4" },
      warm: { name: "Warm Up Routine", video: "videos/WarmClip3456.mp4" } },
    weeks: [{ week: 1, theme: "DROP SET WEEK", days: [
      { dayIndex: 0, title: 'DROP SET WEEK: PUSH DAY A "Chest Biased"', blocks: [
        { title: "Warm Up Routine", rounds: null, steps: [{ exerciseId: "warm", sets: 1, reps: null, timeSeconds: 66 }] },
        { title: "Exercise 1 (Drop Set - 2 Drops)", rounds: 2, note: "Use dumbbells", steps: [
          { exerciseId: "press", sets: 2, reps: "12,10", note: "Fail at the target" },
          { exerciseId: "press", sets: 2, reps: "10,5", note: "Drop the weight" },
          { exerciseId: "press", sets: 2, reps: "10,5", note: "Drop the weight", restSeconds: 100 }] },
        { title: "Exercise 2 - SET 1 / MECHANICAL DROP", rounds: 3, steps: [
          { exerciseId: "curl", sets: 3, reps: "20", alternates: [{ exerciseId: "fly" }] },
          { exerciseId: "drag", sets: 3, reps: null, restSeconds: 65 }] }] }] }] };
  const p = cleanProgram(routineToProgram(routine));
  assert.equal(p.weeks[0].label, "Week 1 · Drop Set Week");
  assert.match(p.notes, /^6 days on, 1 off \(Sun-Fri/);
  const s = p.weeks[0].sessions[0];
  assert.equal(s.name, "Push Day A (Chest Biased)");
  const [warm, press, curl] = s.exercises;
  assert.equal(warm.steps[0].reps, "1:06");
  assert.equal(warm.sets, 1);
  assert.deepEqual([press.name, press.muscle, press.sets, press.reps, press.rest, press.target, press.notes],
    ["Dumbbell Press", "chest", 2, 12, 100, "Drop Set - 2 Drops", "Use dumbbells"]);
  assert.deepEqual(press.steps.map(x => [x.reps, x.times, x.video]),
    [["12, 10 reps", 1, "AbCdEfGh1234"], ["10, 5 reps", 2, "AbCdEfGh1234"]], "identical drops merge into one step");
  assert.deepEqual([curl.name, curl.muscle, curl.target], ["Barbell Curl + Barbell Drag Curl", "biceps", "Set 1 / Mechanical Drop"]);
  assert.equal(curl.steps[1].reps, "to failure");
  assert.deepEqual(curl.steps[0].alt, { name: "Cable Fly", video: "" }, "a clip path that isn't a plain id is dropped");
  assert.throws(() => routineToProgram({ weeks: [] }), /not_routine/);
});

test("programs: steps survive the gate; anything that isn't a clip id never becomes a path", async () => {
  const { cleanProgram } = await import("../program.js");
  const e = { name: "Row", muscle: "lats", sets: 3, reps: 10, target: "", lb: 0, rest_sec: 60, notes: "",
    steps: [{ name: "Row", video: "../../secret", reps: "10 reps", note: "", times: 99 }, { name: "", video: "AbCdEfGh1234" }] };
  const p = cleanProgram({ program: "X", notes: "", total_weeks: 1, blocks: [{ label: "", weeks: 1, deload: false,
    sessions: [{ name: "A", days: [], exercises: Array.from({ length: 25 }, () => e) }] }] });
  const ex = p.weeks[0].sessions[0].exercises;
  assert.equal(ex.length, 20, "sessions hold up to 20 exercises");
  assert.deepEqual(ex[0].steps, [{ name: "Row", video: "", reps: "10 reps", note: "", times: 10 }]);
  assert.ok(!("steps" in cleanProgram({ program: "Y", notes: "", total_weeks: 1, blocks: [{ label: "", weeks: 1, deload: false,
    sessions: [{ name: "A", days: [], exercises: [Object.assign({}, e, { steps: undefined })] }] }] }).weeks[0].sessions[0].exercises[0]));
});

test("videos: demo clips play from a player outside the render tree, never cached, never committed", () => {
  assert.ok(html.includes("if(st.length)o.st=st"), "program codes must keep exercise steps");
  assert.ok(html.includes("function vidId(v)"), "clip ids must be checked before they become URLs");
  assert.ok(html.includes('el.id="vbox"') && html.includes('document.body.appendChild(el)'), "player is created on demand outside #app");
  assert.ok(html.includes('act==="vid"'), "thumbnails must open the player");
  assert.ok(html.includes("playsinline muted loop autoplay"), "clips must play inline on iPhone");
  assert.match(read("public/sw.js"), /startsWith\("\/media\/"\)\) return/, "service worker must leave clips to the network");
  assert.match(wranglerCfg, /"run_worker_first":\s*\["\/media\/\*"\]/, "clips must go through the worker's sign-in check");
  assert.ok(worker.includes("readSession(env, request)") && worker.includes("MEDIA_RE"), "media route must check the session");
  assert.ok(gitignore.includes("public/media/"), "licensed clips must never be committed");
});

test("drop sets: every drop, mini-set, partner, and hold is its own labeled row, grouped by round", () => {
  const src = html.slice(html.indexOf("function blockRows"), html.indexOf("function planFor"));
  const { blockRows, repsFor, lastRow, labRange } = new Function(src + "; return { blockRows, repsFor, lastRow, labRange };")();
  const labels = e => blockRows(e).map(r => r.k);
  assert.deepEqual(labels({ target: "Drop Set - 2 Drops", st: [{ n: "P", r: "12, 10 reps", x: 1 }, { n: "P", r: "10, 5 reps", x: 2 }] }),
    ["Top", "Drop 1", "Drop 2"]);
  assert.deepEqual(labels({ target: "Rest-Pause - 2 Pushes", st: [{ n: "P", r: "15 reps", x: 1 }, { n: "P", r: "to failure", x: 2 }] }),
    ["Main", "Mini 1", "Mini 2"]);
  assert.deepEqual(labels({ target: "ClusterFuck", st: [{ n: "P", r: "15 reps", x: 1 }, { n: "P", r: "to failure", x: 4 }] }),
    ["Main", "Mini 1", "Mini 2", "Mini 3", "Mini 4"]);
  assert.deepEqual(labels({ target: "Superset", st: [{ n: "Curl", r: "12 reps", x: 1 }, { n: "Dip", r: "12 reps", x: 1 }] }), ["A", "B"]);
  assert.deepEqual(labels({ target: "Drops + Extreme Stretch Hold", st: [{ n: "Dip W", r: "15 reps" }, { n: "Dip", r: "to failure" }, { n: "Stretch", r: "0:20" }] }),
    ["Top", "Drop 1", "Hold"]);
  assert.deepEqual(labels({ target: "", st: [{ n: "Warm Up", r: "1:06", x: 1 }] }), [""], "a lone step needs no label");
  assert.equal(repsFor({ r: "12, 10 reps" }, 0), 12);
  assert.equal(repsFor({ r: "12, 10 reps" }, 1), 10);
  assert.equal(repsFor({ r: "12, 10 reps" }, 5), 10, "later rounds reuse the last number");
  assert.equal(repsFor({ r: "to failure" }, 0), 0);
  assert.equal(labRange("Drop 1", "Drop 2"), "Drop 1-2");
  assert.equal(labRange("Mini 1", "Mini 4"), "Mini 1-4");
  assert.equal(labRange("Top", "Top"), "Top");
  const last = [{ g: 1, p: 0, lb: 50 }, { g: 1, p: 1, lb: 40 }, { g: 2, p: 0, lb: 45 }, { g: 2, p: 1, lb: 35 }];
  assert.equal(lastRow(last, 2, 1, 3).lb, 35, "same round and position first");
  assert.equal(lastRow(last, 3, 1, 5).lb, 40, "then the same position");
  assert.ok(html.includes('data-act="gymaddround"') && html.includes('act==="gymdelround"'), "grouped blocks add and remove whole rounds");
  assert.ok(html.includes('gymRest(/rest.?pause/i.test(gx.target||"")?15:0)'), "no full rest between drops");
});

test("programs: week controls exist and every move is undoable", () => {
  for (const act of ["prognext", "progskip", "progback", "progredo", "progrestart", "progend", "progstart", "gimstart"]) {
    assert.ok(html.includes(`"${act}"`), `missing program action ${act}`);
  }
  assert.ok(html.includes('id="progjump"'), "jump-to-week picker missing");
  assert.ok(html.includes("UNDO.gym=snap"), "program changes must snapshot for undo");
  assert.ok(html.includes("programs:[],active:null"), "program state missing from freshDB");
});

test("schema: defines the six tables", () => {
  for (const t of ["users", "state", "magic_links", "shared_plans", "gym_imports", "approvals"]) {
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
