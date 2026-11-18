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
  assert.ok(html.includes('["gym","Train"]'), "Train tab missing from tab bar");
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
  assert.ok(worker.includes('if (row.email !== normalizeEmail(env.OWNER_EMAIL)) return null;'), "sign-in must not create accounts for strangers");
  assert.ok(worker.includes("if (!uid) return Response.redirect") && worker.includes('if (!uid) return json({ error: "expired" }'), "link and code both refuse strangers");
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
  assert.match(read("public/sw.js"), /startsWith\("\/media\/"\)\) \{\s*e\.respondWith\(fromMedia/, "service worker must serve saved clips, else the network");
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

test("workout: one Start card, a full-screen player outside the render tree, screen kept awake", () => {
  assert.ok(html.includes("function sessionHero("), "today's session is one card with one Start button");
  assert.ok(html.includes('root.id="player"') && html.includes("document.body.appendChild(root)"), "the player lives outside #app");
  assert.ok(html.includes("if(key!==PL.mkey)"), "the video is only replaced when the exercise changes");
  assert.ok(html.includes('if(V.sheet&&(V.sheet.kind==="gymlog"||V.sheet.kind==="gymprev")){paintPlayer();return;}'), "ticking a set repaints the player, not the page");
  assert.ok(html.includes('navigator.wakeLock.request("screen")'), "the screen stays on mid-workout");
  for (const a of ["plgo", "pllist", "plclose", "gymrest30", "prevopen", "prevstart", "prevdone", "prevundone", "gymdel", "plmenu", "progopts", "vsave", "install"])
    assert.ok(html.includes(`act==="${a}"`), `missing action ${a}`);
});

test("offline: install guide, code sign-in for the Home Screen app, saved clips survive updates", () => {
  assert.ok(html.includes('autocomplete="one-time-code"'), "the code box should take iOS autofill");
  assert.ok(html.includes('"/api/auth/code"'), "the app must be able to sign in with a code");
  assert.ok(html.includes("Add to Home Screen"), "install steps missing");
  assert.ok(html.includes('MEDIA_CACHE="fuel-media"'), "saved clips cache missing");
  const sw = read("public/sw.js");
  assert.match(sw, /const MEDIA = "fuel-media"/);
  assert.match(sw, /k !== VERSION && k !== MEDIA/, "an app update must not wipe saved clips");
  assert.match(sw, /setTimeout\(r, 3000, null\)/, "a hanging network must fall back to the saved app within 3 s");
  assert.ok(html.includes('withTimeout(api("/api/me"),8000)'), "sign-in check must give up on a hanging network");
  assert.ok(html.includes('if(lu){AUTH.state="in"'), "a device that signed in before opens from its own data first");
  assert.ok(worker.includes('path === "/api/auth/code"') && worker.includes("CODE_TRIES"), "code route must cap guesses");
  assert.ok(html.includes("function offlineStatusHtml()") && html.includes('row("App works offline"'), "the install sheet must show this device's offline status");
});

test("offline: the service worker cuts a saved clip to the byte range the player asks for", async () => {
  const sw = read("public/sw.js");
  const sliced = new Function(sw.slice(sw.indexOf("async function sliced"), sw.indexOf("/* reminders (see push.js)")) + "; return sliced;")();
  const clip = () => new Response(new Uint8Array(Array.from({ length: 100 }, (_, i) => i)), { headers: { "Content-Type": "video/mp4" } });
  const a = await sliced(clip(), "bytes=10-19");
  assert.equal(a.status, 206);
  assert.equal(a.headers.get("content-range"), "bytes 10-19/100");
  assert.deepEqual([...new Uint8Array(await a.arrayBuffer())], Array.from({ length: 10 }, (_, i) => i + 10));
  assert.equal((await sliced(clip(), "bytes=90-")).headers.get("content-range"), "bytes 90-99/100");
  assert.equal((await sliced(clip(), "bytes=-5")).headers.get("content-range"), "bytes 95-99/100");
  assert.equal((await sliced(clip(), "bytes=500-")).status, 416);
});

test("sets: typed numbers flow forward only, and stop at a ticked set or one already changed", () => {
  const src = html.slice(html.indexOf("function setField("), html.indexOf("function setInput("));
  const setField = new Function(src + "; return setField;")();
  const ex = { sets: [{ lb: 0, reps: 10 }, { lb: 0, reps: 10 }, { lb: 0, reps: 10 }, { lb: 0, reps: 10 }] };
  setField(ex, 0, "lb", 20);
  assert.deepEqual(ex.sets.map(x => x.lb), [20, 20, 20, 20], "set 1 fills the rest");
  setField(ex, 1, "lb", 25);
  assert.deepEqual(ex.sets.map(x => x.lb), [20, 25, 25, 25], "set 2 never touches set 1");
  setField(ex, 0, "lb", 22);
  assert.deepEqual(ex.sets.map(x => x.lb), [22, 25, 25, 25], "a set already changed stops the flow");
  ex.sets[2].done = true; setField(ex, 1, "lb", 30);
  assert.deepEqual(ex.sets.map(x => x.lb), [22, 30, 25, 25], "a ticked set is never overwritten");
  const drop = { sets: [{ g: 1, p: 0, lb: 0 }, { g: 1, p: 1, lb: 0 }, { g: 2, p: 0, lb: 0 }, { g: 2, p: 1, lb: 0 }] };
  setField(drop, 0, "lb", 50);
  assert.deepEqual(drop.sets.map(x => x.lb), [50, 0, 50, 0], "a drop set's Top flows to the next round's Top only");
  const rp = { sets: [{ g: 1, p: 0, k: "Main", lb: 0, reps: 15 }, { g: 1, p: 1, k: "Mini 1", lb: 0, reps: 6 }, { g: 2, p: 0, k: "Main", lb: 0, reps: 12 }] };
  setField(rp, 0, "lb", 40);
  assert.deepEqual(rp.sets.map(x => x.lb), [40, 40, 40], "rest-pause minis share the main set's weight");
  setField(rp, 0, "reps", 14);
  assert.deepEqual(rp.sets.map(x => x.reps), [14, 6, 12], "but reps stay per row");
  assert.match(html, /html\{touch-action:manipulation\}/, "double-tap zoom must be off");
  assert.match(html, /\.setin\{[^}]*font-size:16px/, "number boxes under 16px make iPhone zoom in");
});

test("days and programs: several workouts a day, and a missed day never holds the program up", () => {
  const helpers = html.slice(html.indexOf("function progState("), html.indexOf("/* best set per exercise"));
  const make = DB => new Function("DB", "progById", helpers + "; return { progState, logDate, logsOn, newLogKey };")(DB, () => DB.p);
  const ses = n => ({ name: n, ex: [] });
  const p = { id: "p", weeks: [{ sessions: ["A", "B", "C"].map(ses) }, { sessions: ["A2", "B2", "C2"].map(ses) }] };
  const DB = { p, gym: { active: { pid: "p", w: 0, done: { "0|0": "2026-11-09", "0|1": "2026-11-10" } },
    logs: { "2026-11-16": {}, "2026-11-16~2": {}, "2026-11-17": {} } } };
  const f = make(DB);
  assert.deepEqual(f.logsOn("2026-11-16"), ["2026-11-16", "2026-11-16~2"]);
  assert.equal(f.newLogKey("2026-11-16"), "2026-11-16~3");
  assert.equal(f.newLogKey("2026-11-18"), "2026-11-18");
  assert.equal(f.logDate("2026-11-16~2"), "2026-11-16");
  let st = f.progState();
  assert.deepEqual([st.up.w, st.up.s], [0, 2], "next after the last done");
  DB.gym.active.done = { "0|0": "x", "0|1": "x", "1|0": "2026-11-16" }; DB.gym.active.w = 1;
  st = f.progState();
  assert.deepEqual([st.up.w, st.up.s], [1, 1], "week 1's missed C doesn't block week 2");
  DB.gym.active = { pid: "p", w: 0, done: { "0|0": "x", "0|2": "x" } };
  st = f.progState();
  assert.deepEqual([st.up.w, st.up.s], [1, 0], "nothing left after the last done moves on to the next week");
  assert.deepEqual(st.missed, [1], "and remembers what was missed");
});

test("workouts: end early, discard, or delete any of them, with undo", () => {
  assert.ok(html.includes('act==="gymdel"') && html.includes("UNDO.glogs=sl"), "deleting a workout must be undoable");
  assert.ok(html.includes('if(UNDO.glogs!=null){DB.gym.logs=JSON.parse(UNDO.glogs);recomputePRs();}'), "undo must restore the workout and PRs");
  assert.ok(html.includes('"Finish workout now"') && html.includes('"Discard this workout"') && html.includes('"Delete this workout"'));
  assert.ok(html.includes("function recomputePRs()"), "PRs must be rebuilt from what's left");
});

test("analytics: records, last-same-workout comparison, and next-time bumps come from the workouts themselves", () => {
  const src = html.slice(html.indexOf("function e1rm("), html.indexOf("/* plates for each side"));
  const make = DB => new Function("DB", "logDate", "fmtVol", src + "; return { logStats, exMetrics, exHist, logPRs, prevSame, nextBumps, sessKey };")(
    DB, k => String(k).slice(0, 10), v => String(Math.round(v)));
  const set = (lb, reps, extra) => Object.assign({ lb, reps, done: true }, extra || {});
  const push = (lb, extra) => ({ prog: { pid: "p", w: 0, s: 0 }, name: "Push A · Week 1", t0: 1000, t1: 3601000,
    ex: [{ n: "Press", m: "chest", sets: [set(lb, 10, extra), set(lb, 10, extra)] }] });
  const DB = { gym: { logs: { "2026-11-09": push(40), "2026-11-16": push(45, { tr: 10 }), "2026-11-16~2": { name: "Open", t1: 0, ex: [] } } } };
  const f = make(DB);
  assert.deepEqual(f.logStats(DB.gym.logs["2026-11-16"]), { vol: 900, sets: 2, reps: 20, min: 60 });
  assert.equal(f.prevSame("2026-11-16"), "2026-11-09", "same program session, earlier week");
  const prs = f.logPRs("2026-11-16");
  assert.deepEqual(prs.map(p => p.t), ["Heaviest weight", "Best set"]);
  assert.equal(f.logPRs("2026-11-09").length, 0, "a first-ever exercise isn't a record");
  assert.deepEqual(f.nextBumps("2026-11-16"), [{ n: "Press", from: 45, add: 5 }], "every target hit: add 5 lb");
  DB.gym.logs["2026-11-16"].feel = { effort: 5 };
  assert.deepEqual(f.nextBumps("2026-11-16"), [], "all out holds the weight");
  DB.gym.logs["2026-11-16"].feel = {}; DB.gym.logs["2026-11-16"].ex[0].sets[1].reps = 8;
  assert.deepEqual(f.nextBumps("2026-11-16"), [], "a missed target holds the weight");
  assert.equal(f.exHist("Press").length, 2, "unfinished workouts don't count");
});

test("analytics: summary, stats screen, plates, live records are wired in", () => {
  for (const a of ["sumdone", "sumsets", "feel", "gymstats", "strange", "stmetric", "stex", "exmetric"]) assert.ok(html.includes(`act==="${a}"`), `missing ${a}`);
  assert.ok(html.includes("V.sheet={kind:\"gymlog\",ds:V.sheet.ds,sum:true}"), "finishing must open the summary");
  assert.ok(html.includes("function applyBumps(k)") && html.includes("L.bumped=true"), "next-time bumps apply once");
  const src = html.slice(html.indexOf("function plateText("), html.indexOf("/* what you did last time"));
  const plateText = new Function(src + "; return plateText;")();
  assert.match(plateText("Barbell Bench Press", 135), /<b>45<\/b>/);
  assert.match(plateText("Barbell Squat", 185), /<b>45 · 25<\/b>/);
  assert.equal(plateText("Dumbbell Press", 135), "", "no plates for dumbbells");
});

test("import: Hevy and Strong CSV exports become workouts; a second import skips what's there", () => {
  const src = html.slice(html.indexOf("/* ---------------- cardio ----------------"), html.indexOf("/* ---------------- training stats ----------------"));
  const DB = { profile: { weightLb: 180 }, gym: { logs: {} } };
  const f = new Function("DB", src + "; return { importPlan, parseCSV, cardioCal };")(DB);
  const hevy = [
    '"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_lbs","reps","distance_miles","duration_seconds","rpe"',
    '"Push A","28 Mar 2025, 18:05","28 Mar 2025, 19:10","felt good","Bench Press (Barbell)","","","0","warmup","95","10","","",""',
    '"Push A","28 Mar 2025, 18:05","28 Mar 2025, 19:10","felt good","Bench Press (Barbell)","","","1","normal","185","8","","","8"',
    '"Push A","28 Mar 2025, 18:05","28 Mar 2025, 19:10","felt good","Lateral Raise (Dumbbell)","","","0","normal","20","15","","",""',
    '"Morning Run","29 Mar 2025, 07:00","29 Mar 2025, 07:31","","Running","","","0","normal","","","3.1","1860",""'].join("\n");
  const p = f.importPlan(hevy, "lb");
  assert.equal(p.src, "Hevy");
  assert.equal(p.items.length, 2);
  const push = p.items[0];
  assert.equal(push.ds, "2025-03-28");
  assert.equal(push.log.name, "Push A");
  assert.equal((push.log.t1 - push.log.t0) / 60000, 65);
  assert.deepEqual(push.log.ex.map(e => [e.n, e.m, e.sets.length]), [["Bench Press (Barbell)", "chest", 2], ["Lateral Raise (Dumbbell)", "shoulders", 1]]);
  assert.deepEqual(push.log.ex[0].sets, [{ reps: 10, lb: 95, done: true, k: "W" }, { reps: 8, lb: 185, done: true, rpe: 8 }]);
  assert.deepEqual([p.items[1].log.cardio.type, p.items[1].log.cardio.min, p.items[1].log.cardio.mi], ["run", 31, 3.1]);
  p.items.forEach((it, i) => { DB.gym.logs["k" + i] = it.log; });
  const again = f.importPlan(hevy, "lb");
  assert.deepEqual([again.items.length, again.skip], [0, 2], "already imported workouts are skipped");
  const strong = ["Date;Workout Name;Duration;Exercise Name;Set Order;Weight;Reps;Distance;Seconds;Notes;Workout Notes;RPE",
    "2024-01-15 18:30:00;Legs;1h 5m;Squat (Barbell);1;100;5;0;0;;;", "2024-01-15 18:30:00;Legs;1h 5m;Squat (Barbell);2;100;5;0;0;;;"].join("\n");
  const sp = f.importPlan(strong, "kg");
  assert.equal(sp.src, "Strong");
  assert.equal(sp.unitAsk, true, "Strong files without a unit column ask lb or kg");
  assert.deepEqual(sp.items[0].log.ex[0].sets.map(x => x.lb), [220.5, 220.5], "kg converted to lb");
  assert.equal((sp.items[0].log.t1 - sp.items[0].log.t0) / 60000, 65);
  assert.deepEqual(f.parseCSV('a,"b, ""c""",d\n1,2,3'), [["a", 'b, "c"', "d"], ["1", "2", "3"]]);
  assert.equal(f.cardioCal("run", 30, 2), 400, "MET 9.8 × 81.6 kg × 0.5 h");
  assert.match(f.importPlan("x,y\n1,2", "lb").err, /Hevy or Strong/);
});

test("muscles: helpers count half, a drop round counts once, and recovery fades with time", () => {
  const src = html.slice(html.indexOf("function workSets("), html.indexOf("function finishedKeys("));
  const src2 = html.slice(html.indexOf("/* The main muscle gets a full set"), html.indexOf("function fmtSets("));
  const f = new Function(src + src2 + "; return { workSets, muscleSets, helperMuscles };")();
  const sets = n => Array.from({ length: n }, () => ({ done: true }));
  const L = { ex: [{ n: "Incline Dumbbell Press", m: "chest", sets: sets(3) }, { n: "Barbell Row", m: "lats", sets: sets(2) },
    { n: "Lateral Raise", m: "shoulders", sets: [{ g: 1, p: 0, done: true }, { g: 1, p: 1, done: true }, { g: 2, p: 0, done: true }] }] };
  assert.deepEqual(f.muscleSets(L), { chest: 3, triceps: 1.5, shoulders: 3.5, lats: 2, biceps: 1, "middle back": 1 });
  assert.deepEqual(f.helperMuscles("Cable Fly", "chest"), [], "a fly has no helpers");
  const rec = html.slice(html.indexOf("var LEGS_RE="), html.indexOf("/* under a ticked row"));
  assert.ok(rec.includes("Math.pow(0.5,hrs/(LEGS_RE.test(m)?48:36))"), "sets fade by half every 36 h, 48 h for legs");
});

test("training tools: per-set effort, rough-day lighter, cardio, CSV, quick start are wired in", () => {
  for (const a of ["rpe", "rpeskip", "rpeoff", "rpeon", "lighter", "cardio", "cdsave", "cdstart", "cdstop", "cdcancel", "csvexport", "csvgo"])
    assert.ok(html.includes(`act==="${a}"`), `missing ${a}`);
  assert.ok(html.includes('data-src="empty"') && html.includes('if(src==="empty")'), "empty workout quick start");
  assert.ok(html.includes("function volTarget()"), "weekly targets follow the diet");
});

test("layout: four tabs, settings behind a gear, Train/Food/Progress split into views", () => {
  assert.ok(html.includes('var tb=[["diary","Diary"],["food","Food"],["gym","Train"],["progress","Progress"]];'), "four tabs");
  assert.match(html, /grid-template-columns:repeat\(4,1fr\)/);
  assert.ok(html.includes('data-act="nav" data-v="settings" aria-label="Settings"'), "settings is a gear in the header");
  assert.ok(html.includes('segCtl("trainsub",tsub,[["today","Today"],["plan","Plan"],["history","History"],["library","Library"]])'));
  assert.ok(html.includes('segCtl("foodsub",cur,[["plans","Meal plans"],["recipes","Recipes"]])'));
  assert.ok(html.includes('segCtl("progsub",V.progSub||"body",[["body","Body & food"],["training","Training"]])'));
  assert.ok(html.includes('<div id="resume"></div>') && html.includes("function paintResume()"), "an open workout shows above the tab bar");
  assert.ok(html.includes('<button class="plfin" data-act="gymfinish">Finish</button>'), "Finish sits top right in the workout");
  const row = html.slice(html.indexOf("    h+='<div class=\"setrow'+cls+'\">'+sn+"), html.indexOf("rowSub(ei,s,si,prev);"));
  assert.ok(row.indexOf('data-f="lb"') < row.indexOf('data-f="reps"'), "weight comes before reps, like 135×8");
});

test("programs: week controls exist and every move is undoable", () => {
  for (const act of ["prognext", "progskip", "progback", "progredo", "progrestart", "progend", "progstart", "gimstart"]) {
    assert.ok(html.includes(`"${act}"`), `missing program action ${act}`);
  }
  assert.ok(html.includes('id="progjump"'), "jump-to-week picker missing");
  assert.ok(html.includes("UNDO.gym=snap"), "program changes must snapshot for undo");
  assert.ok(html.includes("programs:[],active:null"), "program state missing from freshDB");
});

test("schema: defines the eleven tables", () => {
  for (const t of ["users", "state", "magic_links", "shared_plans", "gym_imports", "approvals", "code_tries", "push_subs", "push_due", "push_plan", "push_msg"]) {
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

/* ---------- muscle map, check-in, workout time, reminders ---------- */

const fnFrom = (start, end, ret, args = [], vals = []) =>
  new Function(...args, html.slice(html.indexOf(start), html.indexOf(end)) + "; return " + ret + ";")(...vals);

test("muscle map: MuscleMap artwork, credited under its MIT license, draws every tracked muscle", () => {
  assert.ok(html.includes("MuscleMap by Melih Colpan") && html.includes("Permission is hereby granted, free of charge"), "MIT notice kept with the artwork");
  const m = fnFrom("var MM_FRONT=", "function bodyMapSvg(", "{MM_FRONT,MM_BACK}");
  const drawn = new Set([...m.MM_FRONT, ...m.MM_BACK].map(x => x[0]));
  const MAIN = fnFrom("var MAIN_MUSCLES=", "function recovery(", "MAIN_MUSCLES");
  for (const mu of MAIN) assert.ok(drawn.has(mu), `no shape for ${mu}`);
  assert.ok(m.MM_FRONT.some(x => x[0] === "chest") && m.MM_BACK.some(x => x[0] === "lats"), "chest in front, lats behind");
  const svg = fnFrom("var MM_FRONT=", "/* the map as a card", "bodyMapSvg")({ chest: "hard" }, "chest");
  assert.match(svg, /class="mu hard sel" data-act="bmsel" data-m="chest"/);
  assert.match(svg, /class="mu idle" data-act="bmsel" data-m="lats"/);
});

test("muscle map: recovery gives each muscle a state and how long until it's ready", () => {
  const now = Date.now(), sets = n => Array.from({ length: n }, () => ({ done: true }));
  const DB = { gym: { logs: {
    a: { t0: now - 13 * 36e5, t1: now - 12 * 36e5, ex: [{ n: "Cable Fly", m: "chest", sets: sets(8) }] },
    b: { t0: now - 51 * 36e5, t1: now - 50 * 36e5, ex: [{ n: "Leg Extension", m: "quadriceps", sets: sets(4) }] } } } };
  const src = html.slice(html.indexOf("function workSets("), html.indexOf("function finishedKeys(")) +
    html.slice(html.indexOf("/* The main muscle gets a full set"), html.indexOf("function ymdOf("));
  const rec = new Function("DB", src + "; return recovery;")(DB)();
  assert.equal(rec.by.chest.st, "hard", "8 sets 12 h ago is still a lot");
  assert.ok(Math.abs(rec.by.chest.eta - 36 * Math.log2(8 * Math.pow(0.5, 12 / 36) / 2)) < 0.01);
  assert.equal(rec.by.quadriceps.st, "ready", "4 sets fade below 2 after 50 h (legs halve every 48 h)");
  assert.equal(rec.by.lats.st, "idle");
  assert.ok(rec.hard.includes("chest") && rec.idle.includes("lats"));
});

test("check-in: lighter rounds to real plates, one set less comes off the last round and goes back", () => {
  const f = fnFrom("/* ---------------- readiness check-in", "function ckChanged(",
    "{setLighter,setFewer,roundsOf,canFewer,ckAdvice}", ["recovery"], [() => ({ by: { chest: { st: "hard" } } })]);
  const plain = n => Array.from({ length: n }, () => ({ lb: 185, reps: 8, done: false }));
  const L = { ex: [
    { n: "Bench", m: "chest", sets: plain(4) },
    { n: "Fly", m: "chest", sets: [1, 1, 2, 2, 3, 3].map((g, i) => ({ g, p: i % 2, lb: 20, reps: 10, done: false })) },
    { n: "Curl", m: "biceps", sets: plain(2) }] };
  f.setLighter(L, true);
  assert.deepEqual([L.ex[0].sets[0].lb, L.ex[0].sets[0].lb0, L.ex[1].sets[0].lb], [165, 185, 17.5], "5 lb steps on a bar, 2.5 on light weights");
  f.setFewer(L, true);
  assert.deepEqual(L.ex.map(e => e.sets.length), [3, 4, 2], "a round of a drop set goes whole; two-set exercises stay");
  f.setFewer(L, false); f.setLighter(L, false);
  assert.deepEqual(L.ex.map(e => e.sets.length), [4, 6, 2]);
  assert.deepEqual(L.ex[1].sets.map(x => x.g), [1, 1, 2, 2, 3, 3]);
  assert.equal(L.ex[0].sets[0].lb, 185);
  assert.equal(L.lighter, false);
  assert.equal(L.fewer, undefined);
  assert.equal(f.ckAdvice(L, { s: 1, so: 1, e: 1 }).lvl, 2, "slept poorly, very sore, low energy");
  assert.equal(f.ckAdvice(L, { s: 3, so: 3, e: 3 }).lvl, 0);
  assert.equal(f.ckAdvice(L, { s: 3, so: 2, e: 2 }).lvl, 1, "fine but chest is still fatigued: take it easier");
  assert.deepEqual(f.ckAdvice(L, { s: 3, so: 3, e: 3 }).tired, ["chest"]);
  for (const a of ["ck", "ckskip", "ckredo", "ckgo", "ckundo", "ckoff", "ckon"]) assert.ok(html.includes(`act==="${a}"`), `missing ${a}`);
});

test("check-in: a lighter day doesn't lower next time or earn a bump", () => {
  const DB = { gym: { logs: { "2026-11-16": { lighter: true, t1: 1, ex: [{ n: "Bench", sets: [{ lb: 165, lb0: 185, reps: 8, done: true }] }] } } } };
  const lastSets = new Function("DB", html.slice(html.indexOf("function lastSets("), html.indexOf("function gymVol(")) + "; return lastSets;")(DB);
  assert.equal(lastSets("Bench")[0].lb, 185);
  assert.ok(html.includes("if(f.effort===5||f.pain===2||L.lighter||L.fewer)return out;"));
});

test("workout time: 10 quiet minutes before Finish ends it at the last entry; the time can be edited", () => {
  const end = fnFrom("var IDLE_MS=", "function finishWorkout(", "workoutEnd");
  const M = 60000;
  assert.equal(end({ t0: 0, ta: 50 * M }, 75 * M), 51 * M, "25 quiet minutes: ends a minute after the last entry");
  assert.equal(end({ t0: 0, ta: 70 * M }, 75 * M), 75 * M, "5 quiet minutes: ends now");
  assert.equal(end({ t0: 0 }, 500 * M), 500 * M, "no entry time (older workouts): ends now");
  assert.ok(html.includes("wl.ta=DB.updatedAt"), "every save in an open workout records the entry time");
  assert.ok(html.includes("setInterval(autoFinishStale,60000)") && html.includes("STALE_MS=3*36e5"), "left open 3 h, it finishes itself");
  for (const a of ["duredit", "durset", "dursave"]) assert.ok(html.includes(`act==="${a}"`), `missing ${a}`);
  assert.ok(html.includes('sumTile("Time",st.min+" min",pv&&pv.min,st.min,"duredit")'), "tap Time on the summary to change it");
});

test("reminders: due an hour in, after 10 quiet minutes; only the newest open workout counts", async () => {
  const { openWorkout, okEndpoint } = await import("../push.js");
  const M = 60000;
  const w = openWorkout({ gym: { logs: {
    a: { name: "Old", t0: 1000, t1: 5000 },
    b: { name: "Push A", t0: 10 * M, ta: 65 * M, t1: 0 },
    c: { name: "Run", t0: 20 * M, t1: 0, cardio: { type: "run" } },
    d: { name: "Outside", t0: 30 * M, t1: 0, off: true } } } });
  assert.equal(w.name, "Push A");
  assert.equal(w.due, 75 * M, "last entry at 65 min: 10 quiet minutes later");
  assert.equal(openWorkout({ gym: { logs: { b: { name: "x", t0: 10 * M, ta: 12 * M } } } }).due, 70 * M, "never before the hour");
  assert.equal(openWorkout({ gym: { logs: {} } }), null);
  assert.equal(openWorkout(null), null);
  assert.ok(okEndpoint({}, "https://web.push.apple.com/QGx") && okEndpoint({}, "https://fcm.googleapis.com/fcm/send/x"));
  assert.ok(!okEndpoint({}, "https://push.apple.com.evil.io/x") && !okEndpoint({}, "http://127.0.0.1:1/x"), "localhost only in tests");
});

test("reminders: the phone opts in from a tap, the service worker shows them, the cron sends them", () => {
  const on = html.slice(html.indexOf("function remOn("), html.indexOf("function remOff("));
  assert.ok(on.indexOf("Notification.requestPermission()") < on.indexOf("navigator.serviceWorker.ready"), "iOS only asks inside the tap");
  assert.ok(html.includes('act==="remon"') && html.includes("h+=remindCard();"));
  const sw = read("public/sw.js");
  assert.ok(sw.includes('addEventListener("push"') && sw.includes("/api/push/pending") && sw.includes("showNotification"));
  assert.ok(sw.includes('addEventListener("notificationclick"') && html.includes("openFromReminder(e.data.open)") && html.includes("openFromReminder(fromRem)"));
  assert.match(wranglerCfg, /"crons":\s*\["\*\/2 \* \* \* \*"\]/);
  assert.ok(worker.includes("async scheduled(") && worker.includes("syncDue(db, uid, body.state)"));
  assert.ok(!/VAPID_JWK\s*[:=]\s*["'{]/.test(wranglerCfg + worker), "the signing key is a secret, never in code");
});

test("reminders: food and weigh-in times, in the phone's time zone, skipped when already logged", async () => {
  const { planItems, localNow, alreadyLogged, dueItems } = await import("../push.js");
  const rem = { open: true, w: { on: true, t: "07:30", d: [1, 3, 5] }, bf: { on: true, t: "08:15" }, lu: { on: false, t: "12:00" }, di: { on: true, t: "bad" } };
  assert.deepEqual(planItems(rem).map(i => [i.kind, i.at]), [["w", 450], ["bf", 495]], "off and malformed times are left out");
  assert.deepEqual(planItems(rem)[0].days, [1, 3, 5]);
  const t = Date.UTC(2026, 10, 18, 13, 0);   // Wed 18 Nov 2026, 13:00 UTC = 08:00 in New York
  assert.deepEqual(localNow(t, "America/New_York"), { date: "2026-11-18", min: 480, dow: 3 });
  assert.equal(localNow(t, "Not/AZone").min, 480, "a bad zone falls back to New York");
  const row = { tz: "America/New_York", plan: JSON.stringify(rem), sent: "{}" };
  assert.deepEqual(dueItems(row, t).items.map(i => i.kind), ["w"], "07:30 has come up; 08:15 hasn't");
  assert.deepEqual(dueItems({ ...row, sent: JSON.stringify({ w: "2026-11-18" }) }, t).items, [], "already sent today");
  assert.deepEqual(dueItems(row, t + 3 * 36e5).items, [], "more than 90 minutes late: let it go");
  assert.deepEqual(dueItems(row, t + 864e5).items, [], "Thursday isn't a weigh-in day");
  const st = { log: { "2026-11-18": { meals: { bf: [{}], lu: [] }, weights: [] } } };
  assert.equal(alreadyLogged(st, "2026-11-18", "bf"), true);
  assert.equal(alreadyLogged(st, "2026-11-18", "lu"), false);
  assert.equal(alreadyLogged(st, "2026-11-18", "w"), false);
  assert.equal(alreadyLogged(st, "2026-11-19", "w"), false);
  for (const a of ["remtog", "remopen", "remday"]) assert.ok(html.includes(`act==="${a}"`), `missing ${a}`);
  assert.ok(html.includes('contains("remt")') && html.includes("DB.profile.tz=tzn"), "times save on change; the phone's zone goes with them");
  assert.ok(worker.includes("await syncPlan(db, uid, body.state)"));
  for (const t2 of ["push_plan", "push_msg"]) assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${t2}`));
});


/* ---------- exercise library, equipment, swaps ---------- */

const libData = JSON.parse(read("public/exercises.json"));
function libFns(DB) {
  const src = html.slice(html.indexOf("/* ================= exercise library, equipment, swaps"), html.indexOf("/* ---------- equipment: where you train"));
  const stubs = "var EXDB=__lib;function todayStr(){return '2026-11-18';}function dateAdd(d,n){var t=new Date(d+'T12:00:00');t.setDate(t.getDate()+n);return t.toISOString().slice(0,10);}" +
    "function logDate(k){return k.slice(0,10);}function exVideos(){return [];}function esc(s){return String(s);}function lastSets(){return null;}";
  const f = new Function("__lib", "DB", stubs + src + "; libIndex(); return {exEquip,exPattern,exFind,exInfoOf,exClean,swapCands,canDo,missingAt,curLoc,locs,doSwap,EXDB};");
  return f(JSON.parse(JSON.stringify(libData)), DB);
}

test("library: free-exercise-db with steps, helper muscles, levels and two photos each, photos kept out of git", () => {
  assert.ok(libData.length >= 850, `only ${libData.length} exercises`);
  for (const x of libData) {
    assert.ok(x.id && /^[A-Za-z0-9_-]+$/.test(x.id) && x.n && x.m && typeof x.lv === "number", JSON.stringify(x).slice(0, 80));
  }
  assert.ok(libData.filter(x => x.st && x.st.length).length / libData.length > 0.95, "nearly all have steps");
  assert.ok(libData.filter(x => x.ph).length / libData.length > 0.95, "nearly all have photos");
  assert.ok(libData.some(x => x.s && x.s.length), "helper muscles kept");
  assert.match(gitignore, /^public\/lib\/$/m, "photos are rebuilt, not committed");
  assert.ok(existsSync(join(root, "scripts/build-library.mjs")));
  const sw = read("public/sw.js");
  assert.ok(sw.includes('const LIBC = "fuel-lib"') && sw.includes("k !== LIBC") && sw.includes('url.pathname.startsWith("/lib/")'), "photos stay on the phone across updates");
});

test("library: equipment and movement are read from the exercise", () => {
  const f = libFns({ gym: { logs: {} } });
  const eq = n => f.exEquip({ n }).sort().join(",");
  assert.equal(eq("Barbell Bench Press"), "bb,bench,rack");
  assert.equal(eq("Incline Dumbbell Press"), "adj,db");
  assert.equal(eq("Lat Pulldown"), "cable");
  assert.equal(eq("Smith Machine Squat"), "smith");
  assert.equal(eq("Hip Dominant Barbell Good Morning"), "bb,rack", "'t bar' inside a word isn't a T-bar");
  assert.equal(eq("Pull-Ups"), "pullup");
  assert.equal(eq("Push-Ups"), "bw");
  assert.equal(eq("Band Pull Apart"), "band");
  const pat = (n, m) => f.exPattern({ n, m });
  assert.equal(pat("Barbell Row", "middle back"), "hpull");
  assert.equal(pat("Upright Barbell Row", "shoulders"), "raise");
  assert.equal(pat("Romanian Deadlift", "hamstrings"), "hinge");
  assert.equal(pat("Lying Leg Curls", "hamstrings"), "legcurl");
  assert.equal(pat("Cable Crossover", "chest"), "fly");
  assert.equal(pat("Overhead Press", "shoulders"), "vpush");
  assert.equal(pat("Bulgarian Split Squat", "quadriceps"), "lunge");
});

test("library: program names find their library match, cues and all", () => {
  const f = libFns({ gym: { logs: {} } });
  const m = (n, mu) => (f.exInfoOf(n, mu).x || {}).n;
  assert.equal(m("Barbell Row"), "Bent Over Barbell Row");
  assert.equal(m("Pull Up", "lats"), "Pullups");
  assert.equal(m("Lateral Raise", "shoulders"), "Side Lateral Raise", "not the band version");
  assert.equal(m("Skull Crusher", "triceps"), "EZ-Bar Skullcrusher");
  assert.equal(m("Flat Dumbbell Press", "chest"), "Dumbbell Bench Press");
  assert.equal(m('Hammer Curls "Dumbbells Touching"', "biceps"), "Hammer Curls");
  assert.equal(f.exClean('Dips "Weighted" (Dumbbell Between Knees) + 2 more'), "Dips");
  assert.deepEqual(f.exInfoOf("Romanian Deadlift", "hamstrings").eq, ["bb"], "a bare name borrows the library's equipment");
  assert.deepEqual(f.exInfoOf("Poor Man's Calf Raise", "calves").eq, [], "a loose match doesn't lend a machine");
  assert.deepEqual(f.exInfoOf("Chest Supported Row", "middle back").eq, [], "unknown is unknown, not bodyweight");
});

test("swaps: same muscle always, what you have first, your swaps and preferences count, never means never", () => {
  const DB = { gym: { logs: {}, locs: [{ id: "g", name: "Garage", eq: ["bb", "rack", "bench", "adj", "db", "pullup", "band", "kb"] }], loc: "g",
    swaps: { "Leg Press": { "Goblet Squat": 3 } }, pref: { "Barbell Full Squat": -9, "Dumbbell Squat": 1 } } };
  const f = libFns(DB);
  const c = f.swapCands({ n: "Leg Press", m: "quadriceps" }, false, 15);
  assert.ok(c.length >= 5);
  assert.ok(c.every(o => o.x.m === "quadriceps"), "same main muscle");
  assert.ok(c.every(o => f.canDo(o.x.eq, f.curLoc())), "only what the garage has");
  assert.equal(c[0].x.n, "Goblet Squat", "what you've swapped to before comes first");
  assert.ok(!c.some(o => o.x.n === "Barbell Full Squat"), "never suggested");
  assert.ok(c.findIndex(o => o.x.n === "Dumbbell Squat") < 5, "more often moves it up");
  assert.ok(f.swapCands({ n: "Leg Press", m: "quadriceps" }, true, 40).some(o => !o.ok), "show-all includes ones you can't do here");
  assert.deepEqual(f.missingAt(["legpress", "bw"], f.curLoc()), ["legpress"]);
  /* doing the swap: new name, old one remembered, the structure kept, the old clip dropped, the swap counted */
  const log = { ex: [{ n: "Leg Press", m: "quadriceps", sets: [{ lb: 300, reps: 10 }], st: [{ n: "Leg Press", v: "clip1", r: "10" }] }] };
  f.doSwap(log, 0, f.EXDB.find(x => x.n === "Goblet Squat"), true);
  assert.equal(log.ex[0].n, "Goblet Squat");
  assert.equal(log.ex[0].was, "Leg Press");
  assert.equal(log.ex[0].st[0].v, undefined);
  assert.equal(log.ex[0].st[0].r, "10");
  assert.equal(DB.gym.swaps["Leg Press"]["Goblet Squat"], 4);
  assert.equal(DB.gym.subs["Leg Press"], "Goblet Squat", "every time");
});

test("swaps and equipment are wired in: player, programs, Library tab, planner", () => {
  for (const a of ["swapopen", "swapdo", "swapall", "swapalways", "swapclose", "subdel", "exinfo", "expref", "equip", "locpick", "locadd", "locedit", "loceq", "locpreset", "libopen", "libset", "libsave"])
    assert.ok(html.includes(`act==="${a}"`), `missing ${a}`);
  assert.ok(html.includes('["history","History"],["library","Library"]'), "Library is a Train view");
  assert.ok(html.includes("var subs=DB.gym.subs||{};") && html.includes("e.n=subs[e0.n];e.was=e0.n;"), "programs use swap-every-time");
  assert.ok(html.includes("sesNeeds(ex)"), "the session card says what it needs");
  assert.ok(html.includes("Photos and steps: free-exercise-db (public domain)"), "credit on the exercise page");
});

/* ---------- build a workout ---------- */

function genFns(DB) {
  const lib = html.slice(html.indexOf("/* ================= exercise library, equipment, swaps"), html.indexOf("/* ---------- equipment: where you train"));
  const gen = html.slice(html.indexOf("/* ---------------- build a workout (the Fitbod idea)"), html.indexOf("/* rest timer between sets */"));
  const stubs = "var EXDB=__lib;function todayStr(){return '2026-11-18';}function dateAdd(d,n){var t=new Date(d+'T12:00:00');t.setDate(t.getDate()+n);return t.toISOString().slice(0,10);}" +
    "function logDate(k){return k.slice(0,10);}function exVideos(){return [];}function esc(s){return String(s);}function lastSets(n){return (DB.__last||{})[n]||null;}" +
    "function recovery(){return DB.__rc||{by:{},hard:[]};}function weekMuscleSets(){return {};}function volTarget(){return {lo:10,hi:20};}" +
    "function finishedKeys(){return Object.keys(DB.gym.logs).filter(function(k){return DB.gym.logs[k].t1;});}function e1rm(lb,r){return lb>0&&r>0?lb*(1+r/30):0;}" +
    "function capFirst(t){return t.charAt(0).toUpperCase()+t.slice(1);}function andList(a){return a.length<2?a.join(''):a.slice(0,-1).join(', ')+' and '+a[a.length-1];}";
  const f = new Function("__lib", "DB", stubs + lib + gen + "; libIndex(); return {genAuto,genBuild,genCtx,genOwn,genLoad,genMin,genRepick,warmupFor,canDo,curLoc,GEN_SPLITS,EXDB};");
  return f(JSON.parse(JSON.stringify(libData)), DB);
}
const garage = { id: "g", name: "Garage", eq: ["bb", "rack", "bench", "adj", "db", "pullup", "band", "kb"] };
const half = () => 0.5;

test("build a workout: fills the time with lifts the place has, big ones first", () => {
  const DB = { gym: { logs: {}, locs: [garage], loc: "g" }, profile: {} };
  const f = genFns(DB);
  assert.equal(f.genAuto().k, "full", "no history: full body");
  const r = f.genBuild("full", 60, f.genCtx(1, half), true);
  const it = r.items;
  assert.ok(it.length >= 6 && it.length <= 8, `${it.length} exercises in an hour`);
  assert.ok(it.every(x => f.canDo(x.x.eq, f.curLoc())), "only what the garage has");
  assert.equal(it[0].m, "quadriceps");
  assert.equal(it[0].n, "Barbell Squat", "a staple lift, not an oddity");
  assert.ok(Math.abs(f.genMin(it) - 60) <= 5, `about an hour, got ${f.genMin(it)}`);
  assert.ok(new Set(it.map(x => x.n)).size === it.length, "no repeats");
  const short = f.genBuild("push", 30, f.genCtx(1, half), false).items, long = f.genBuild("push", 90, f.genCtx(1, half), false).items;
  assert.ok(short.length >= 3 && short.length <= 5, `${short.length} in half an hour`);
  assert.ok(long.length > it.length && long[0].sets === 4, "a long session: more exercises, 4 sets on the first lifts");
  assert.ok(short.every(x => x.m === "chest" || x.m === "shoulders" || x.m === "triceps"), "push is chest, shoulders, triceps");
  const pull = f.genBuild("pull", 45, f.genCtx(1, half), false).items.map(x => x.n);
  assert.ok(!(pull.includes("Pullups") && pull.includes("Chin-Up")), "not the same lift twice: " + pull.join(", "));
});

test("build a workout: bodyweight place, never and more, rested muscles, your own lifts and weights", () => {
  const DB = { gym: { logs: {}, locs: [{ id: "b", name: "Hotel", eq: [] }], loc: "b", pref: { "Pushups": -9, "Push-Up Wide": 1 } }, profile: {} };
  let f = genFns(DB);
  const bw = f.genBuild("push", 45, f.genCtx(1, half), false).items;
  assert.ok(bw.length >= 2 && bw.every(x => x.x.eq.every(k => k === "bw")), "bodyweight only: " + bw.map(x => x.n).join(", "));
  assert.ok(!bw.some(x => x.n === "Pushups"), "never means never");
  assert.equal(bw[0].n, "Push-Up Wide", "more often moves it up");
  /* chest still fatigued: auto leaves it out */
  const DB2 = { gym: { logs: { "2026-11-17": { t1: 1, ex: [{ n: "Barbell Bench Press", m: "chest", sets: [{ lb: 185, reps: 8, done: true }] }] } }, locs: [garage], loc: "g" }, profile: {},
    __rc: { by: { chest: { st: "hard" }, triceps: { st: "hard" }, shoulders: { st: "recovering" } }, hard: ["chest", "triceps"] },
    __last: { "Barbell Bench Press": [{ lb: 185, reps: 8, done: true }, { lb: 185, reps: 6, done: true }] } };
  f = genFns(DB2);
  const a = f.genAuto();
  assert.ok(!["push", "upper", "full"].includes(a.k), `fatigued chest picks ${a.k}`);
  assert.match(a.why, /chest and triceps are still recovering/);
  const up = f.genBuild("upper", 60, f.genCtx(1, half), true);
  assert.ok(!up.items.some(x => x.m === "chest") && up.skipped.includes("chest"));
  /* your program's name for a lift is used, and stands in for the library's version of it */
  assert.ok(f.genOwn().some(x => x.n === "Barbell Bench Press"));
  const push = f.genBuild("push", 60, f.genCtx(1, half), false).items.map(x => x.n);
  assert.ok(push.includes("Barbell Bench Press") && !push.includes("Barbell Bench Press - Medium Grip"), push.join(", "));
  assert.deepEqual(f.genLoad("Barbell Bench Press", 8), { lb: 185, reps: 8 }, "last time's weight for the same reps");
  assert.equal(f.genLoad("Barbell Bench Press", 12).lb, 165, "fewer pounds for more reps (from the estimated max)");
  assert.deepEqual(f.genLoad("Goblet Squat", 8), { lb: 0, reps: 8 }, "never done: you fill it in");
  const sh = { k: "push", items: f.genBuild("push", 60, f.genCtx(1, half), false).items }, before = sh.items[0].n;
  assert.ok(f.genRepick(sh, 0) && sh.items[0].n !== before && sh.items[0].m === "chest", "reshuffle one: same muscle, different lift");
});

test("warm-up: a ramp before the first big lift for a muscle, never counted", () => {
  const DB = { gym: { logs: {} }, profile: {} };
  const f = genFns(DB);
  const s = lb => [{ lb, reps: 8, done: false }];
  const log = { ex: [{ n: "Barbell Squat", m: "quadriceps", sets: s(205) }, { n: "Leg Press", m: "quadriceps", sets: s(300) },
    { n: "Dumbbell Bench Press", m: "chest", sets: s(60) }, { n: "Barbell Curl", m: "biceps", sets: s(95) }, { n: "Romanian Deadlift", m: "hamstrings", sets: s(115) }] };
  assert.deepEqual(f.warmupFor(log, 0), [{ lb: 45, reps: 10 }, { lb: 105, reps: 8 }, { lb: 145, reps: 5 }, { lb: 175, reps: 3 }]);
  assert.equal(f.warmupFor(log, 1), null, "quads are already warm");
  assert.equal(f.warmupFor(log, 2), null, "light dumbbells need no ramp");
  assert.equal(f.warmupFor(log, 3), null, "curls aren't a big lift");
  assert.deepEqual(f.warmupFor(log, 4), [{ lb: 45, reps: 10 }, { lb: 60, reps: 8 }, { lb: 85, reps: 4 }], "lighter: two steps");
  DB.profile.noWarmup = true;
  assert.equal(f.warmupFor(log, 0), null, "off from the menu");
  for (const a of ["genopen", "genmin", "genfocus", "genvar", "genshuf", "genre", "gendel", "genstart", "wuoff", "wuon"]) assert.ok(html.includes(`act==="${a}"`), `missing ${a}`);
  assert.ok(html.includes('k==="gen"?genBody()') && html.includes("warmupHtml(log,sh.i)"), "sheet and player wired");
});
