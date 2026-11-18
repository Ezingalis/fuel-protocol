/* Adds Everkinetic's line drawings to the exercise library.
   Source: github.com/everkinetic/data, drawings by Greg Priday (everkinetic.com), CC BY-SA 4.0.

   Each exercise is drawn twice, at the start and at the end of the movement. This keeps only the ink
   (the white background layer is dropped, so the drawing sits on any theme) and puts both frames in one
   SVG that switches between them every 1.2 s, like a two-frame GIF: public/lib/ek/<number>.svg. That's an
   adaptation, so the drawings stay under CC BY-SA 4.0 (see CREDITS.md). They're gitignored like the photos.

   Library exercises that match a drawing get "ek": "<number>". Everkinetic exercises the library doesn't
   have are added as new entries (id "ek_<number>", with Everkinetic's steps, also CC BY-SA 4.0).
   Matching uses the app's own exFind, so it agrees with how programs find library exercises.

   Run after build-library.mjs (it rewrites exercises.json); running this twice gives the same result.
     git clone --depth 1 --filter=blob:none --sparse https://github.com/everkinetic/data /tmp/ek
     (cd /tmp/ek && git sparse-checkout set --no-cone dist/svg/ /dist/exercises.json)
     node scripts/build-everkinetic.mjs /tmp/ek            add --dry to only print the matches */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = process.argv[2], dry = process.argv.includes("--dry");
if (!src || !existsSync(join(src, "dist", "exercises.json"))) {
  console.error("usage: node scripts/build-everkinetic.mjs <path to an everkinetic/data checkout> [--dry]");
  process.exit(1);
}
const ek = JSON.parse(readFileSync(join(src, "dist", "exercises.json"), "utf8"));
const libPath = join(root, "public", "exercises.json");
/* start clean: drop what an earlier run added */
const lib = JSON.parse(readFileSync(libPath, "utf8")).filter(x => !String(x.id).startsWith("ek_"));
lib.forEach(x => { delete x.ek; });

/* the app's matching code, straight from index.html */
const html = readFileSync(join(root, "public", "index.html"), "utf8");
const block = html.slice(html.indexOf("/* ================= exercise library, equipment, swaps"), html.indexOf("/* ---------- equipment: where you train"));
const stubs = "var EXDB=__lib,DB={gym:{logs:{}}};function todayStr(){return '2026-01-01';}function dateAdd(d){return d;}function logDate(k){return k;}" +
  "function exVideos(){return [];}function esc(s){return String(s);}function lastSets(){return null;}";
const app = new Function("__lib", stubs + block + "; libIndex(); return {exFind:exFind,exWords:exWords,exPattern:exPattern,j:function(){return EXF_J;}};")(lib);

const MUS = { "biceps brachii": "biceps", "triceps brachii": "triceps", "pectoralis major": "chest", quadriceps: "quadriceps", deltoid: "shoulders",
  abdominals: "abdominals", obliques: "abdominals", "latissimus dorsi": "lats", gastrocnemius: "calves", soleus: "calves",
  "ischiocrural muscles": "hamstrings", "erector spinae": "lower back", trapezius: "traps", "glutaeus maximus": "glutes" };
const EQ = e => {
  const s = e.join(" ").toLowerCase();
  return /smith|machine|t-bar/.test(s) ? "machine" : /barbell|\bbar\b/.test(s) && !/pull-up|parallel/.test(s) ? "barbell" : /dumbbell/.test(s) ? "dumbbell" :
    /cable/.test(s) ? "cable" : /band/.test(s) ? "bands" : /medicine/.test(s) ? "medicine ball" : /ball/.test(s) ? "exercise ball" :
    /body|pull-up|parallel/.test(s) ? "body only" : "other";
};
const title = s => s.replace(/\b\w/g, c => c.toUpperCase());
/* "decline-dumbbell-bench-press" reads like the library's names; the title ("Bench Press: Dumbbell (Decline)") is the fallback */
const EQW = e => { const s = e.join(" ").toLowerCase();
  return /smith/.test(s) ? "smith machine" : /barbell/.test(s) ? "barbell" : /dumbbell/.test(s) ? "dumbbell" : /cable/.test(s) ? "cable" : /band/.test(s) ? "band" : ""; };
const names = x => {
  const slug = title(x.name.replace(/-/g, " ")), w = EQW(x.equipment || []);
  const out = [slug, x.title.replace(/\(([^)]*)\)/g, " $1 ").replace(/:/g, " ").replace(/\s+/g, " ").trim()];
  /* "Seated Military Press" on a barbell is the library's "Seated Barbell Military Press" */
  if (w && !slug.toLowerCase().includes(w.split(" ")[0])) out.push(title(w) + " " + slug);
  return out;
};

/* the ink layer of one drawing, with its own viewBox */
function ink(file) {
  const s = readFileSync(join(src, "dist", file), "utf8");
  const vb = /viewBox="([^"]+)"/.exec(s)[1].split(/\s+/).map(Number);
  const groups = [...s.matchAll(/<g fill="([^"]+)">([\s\S]*?)<\/g>/g)].filter(m => !/^#f{3}(f{3})?$/i.test(m[1]));
  if (!groups.length) throw new Error("no ink in " + file);
  return { vb, body: groups.map(m => m[2]).join("") };
}
function animated(a, b) {
  const W = Math.max(a.vb[2], b.vb[2]), H = Math.max(a.vb[3], b.vb[3]);
  const frame = (f, cls) => `<g class="${cls}"><svg width="${W}" height="${H}" viewBox="${f.vb.join(" ")}"><g fill="#333">${f.body}</g></svg></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><style>.a,.b{animation:2.4s steps(1) infinite}.a{animation-name:a}.b{animation-name:b}` +
    `@keyframes a{50%{opacity:0}}@keyframes b{0%{opacity:0}50%{opacity:1}}</style>${frame(a, "a")}${frame(b, "b")}</svg>`;
}

/* checked by hand: the library exercise each drawing shows ("" = not in the library, add it; "-" = a second
   drawing of something already covered, leave it out) */
const OVERRIDE = {
  "0001": "Isometric Neck Exercise - Front And Back", "0002": "Isometric Neck Exercise - Sides", "0016": "Standing Dumbbell Upright Row",
  "0018": "Side Lateral Raise", "0028": "Barbell Rear Delt Row", "0029": "T-Bar Row with Handle", "0031": "", "0035": "", "0041": "", "0044": "",
  "0045": "Bent-Arm Barbell Pullover", "0049": "Close-Grip Barbell Bench Press", "0061": "-", "0070": "One Arm Floor Press", "0086": "Inverted Row",
  "0092": "Straight-Arm Pulldown", "0095": "-", "0099": "Barbell Deadlift", "0101": "Good Morning", "0103": "Hyperextensions (Back Extensions)",
  "0114": "Barbell Lunge", "0118": "Romanian Deadlift", "0121": "Dumbbell Lunges", "0128": "", "0140": "Iron Cross", "0141": "Jefferson Squats",
  "0146": "Narrow Stance Squats", "0151": "Overhead Squat", "0158": "Weighted Sissy Squat", "0161": "Zercher Squats", "0171": "Dip Machine",
  "0172": "Dips - Triceps Version", "0177": "-", "0183": "Lying Triceps Press", "0192": "", "0193": "", "0214": "Alternate Incline Dumbbell Curl",
  "0222": "Drag Curl", "0223": "Dumbbell Alternate Bicep Curl", "0224": "Dumbbell Bicep Curl", "0226": "EZ-Bar Curl", "0227": "Hammer Curls",
  "0239": "Preacher Curl", "0245": "Spider Curl", "0267": "", "0273": "Calf Press On The Leg Press Machine", "0278": "Rocking Standing Calf Raise",
  "0279": "Seated Calf Raise", "0282": "Standing Calf Raises", "0017": "Bent Over Low-Pulley Side Lateral", "0026": "Reverse Grip Bent-Over Rows",
  "0060": "Incline Cable Flye", "0109": "Butt Lift (Bridge)", "0132": "One Leg Barbell Squat", "0213": "Alternate Hammer Curl",
  "0231": "Incline Inner Biceps Curl", "0243": "Seated Dumbbell Curl", "0246": "Standing Inner-Biceps Curl" };
/* Everkinetic's main muscle is off for a few pulling moves ("Wide Grip Chin Up": trapezius) */
const fixMuscle = (n, m) => /chin.?up|pull.?up|pull ?down/i.test(n) ? "lats" : /\brows?\b/i.test(n) && !/upright/i.test(n) ? "middle back" : m;
const byName = {}; lib.forEach(y => { byName[y.n] = y; });
const outDir = join(root, "public", "lib", "ek");
if (!dry) { rmSync(outDir, { recursive: true, force: true }); mkdirSync(outDir, { recursive: true }); }
let matched = 0, added = 0, bytes = 0;
const taken = {}, report = [], todo = [];
for (const x of ek) {
  const svg = (x.svg || []).filter(Boolean);
  if (svg.length < 2) continue;
  const num = String(x.id), m = MUS[(x.primary || [])[0]] || "other";
  let best = null, bj = 0;
  if (num in OVERRIDE) { best = byName[OVERRIDE[num]] || null; bj = best ? 2 : OVERRIDE[num] === "-" ? -1 : 0; if (OVERRIDE[num] && OVERRIDE[num] !== "-" && !best) throw new Error("no library exercise " + OVERRIDE[num]); }
  else for (const n of names(x)) {
    /* the same muscle first; Everkinetic and the library sometimes disagree on it, so a near-exact name also counts */
    let hit = app.exFind(n, m), j = app.j();
    if (hit && j > bj) { best = hit; bj = j; }
    hit = app.exFind(n); j = app.j() - 0.15;
    if (hit && j > bj && j >= 0.75) { best = hit; bj = j; }
  }
  todo.push({ x, svg, num, m, best, bj });
}
/* the best matches claim their exercise first; one drawing per exercise */
todo.sort((a, b) => b.bj - a.bj);
for (const { x, svg, num, m, best, bj } of todo) {
  if (bj < 0) { report.push(`- ${num} ${x.title}: left out`); continue; }
  const draw = () => { if (dry) return; const out = animated(ink(svg[0]), ink(svg[1])); writeFileSync(join(outDir, num + ".svg"), out); bytes += out.length; };
  /* a close match (most words shared) gets the drawing; a loose one is a different exercise */
  if (best && bj >= 0.66) {
    if (taken[best.id]) { report.push(`- ${num} ${x.title}: ${best.n} already has a drawing`); continue; }
    taken[best.id] = 1; best.ek = num; matched++; draw();
    report.push(`= ${num} ${x.title}  ->  ${best.n}  (${bj > 1 ? "by hand" : bj.toFixed(2)})`);
    continue;
  }
  const n = names(x)[0].replace(/\s+\d+$/, "").replace(/\bDead Lifts?\b/g, "Deadlift");
  if (lib.some(y => y.n.toLowerCase() === n.toLowerCase())) { report.push(`skip ${x.title}: name taken`); continue; }
  const sec = [...new Set((x.secondary || []).map(s => MUS[s]).filter(s => s && s !== fixMuscle(n, m)))];
  const e = { id: "ek_" + num, n, m: fixMuscle(n, m) };
  if (sec.length) e.s = sec;
  e.e = EQ(x.equipment || []);
  e.c = "strength";
  e.lv = 0;
  /* Everkinetic calls a chin-up "isolation"; the movement says otherwise */
  e.mc = /^(squat|hinge|hpush|vpush|hpull|vpull|lunge|thrust)$/.test(app.exPattern({ n, m: e.m })) || /compound/.test(x.type || "") ? "c" : "i";
  const st = (x.steps || []).map(s => String(s).trim()).filter(Boolean);
  if (st.length) e.st = st;
  e.ek = num;
  lib.push(e); added++; draw();
  report.push(`+ ${num} ${x.title}  as  ${n} [${m}; ${(x.equipment || []).join(", ")}]` + (best ? `  (closest: ${best.n}, ${bj.toFixed(2)})` : ""));
}
lib.sort((a, b) => a.n.localeCompare(b.n));
if (process.argv.includes("--report")) console.log(report.join("\n"));
if (!dry) writeFileSync(libPath, JSON.stringify(lib));
console.log(`${matched} library exercises got a drawing, ${added} added from Everkinetic, ${lib.length} in all` +
  (dry ? " (dry run)" : `, drawings ${Math.round(bytes / 1024)} KB`));
