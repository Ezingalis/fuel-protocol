/* Builds the exercise library from free-exercise-db (github.com/yuhonas/free-exercise-db,
   public domain under the Unlicense): public/exercises.json (text, committed) and two photos per
   exercise in public/lib/<id>/ (start and end position, resized, gitignored like the demo clips).

     git clone --depth 1 https://github.com/yuhonas/free-exercise-db /tmp/fedb
     node scripts/build-library.mjs /tmp/fedb

   Equipment lists and movement patterns aren't stored here: the app works them out from each
   exercise's name and fields (exEquip / exPattern in index.html), the same way for library
   exercises and for anything in a program, so swaps can compare the two. */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = process.argv[2];
if (!src || !existsSync(join(src, "dist", "exercises.json"))) {
  console.error("usage: node scripts/build-library.mjs <path to a free-exercise-db checkout>");
  process.exit(1);
}
const force = process.argv.includes("--force");
const list = JSON.parse(readFileSync(join(src, "dist", "exercises.json"), "utf8"));
const LEVEL = { beginner: 0, intermediate: 1, expert: 2 };
let hasSips = true;
try { execFileSync("sips", ["--help"], { stdio: "ignore" }); } catch { hasSips = false; }

const out = [];
let photos = 0;
for (const x of list) {
  const id = String(x.id || x.name).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  const prim = (x.primaryMuscles || [])[0] || "other";
  const sec = [...new Set([...(x.primaryMuscles || []).slice(1), ...(x.secondaryMuscles || [])])].filter(m => m !== prim);
  const e = { id, n: x.name, m: prim };
  if (sec.length) e.s = sec;
  e.e = x.equipment || "";
  e.c = x.category || "strength";
  e.lv = LEVEL[x.level] ?? 0;
  if (x.force) e.f = x.force;
  if (x.mechanic) e.mc = x.mechanic === "compound" ? "c" : "i";
  if (x.instructions && x.instructions.length) e.st = x.instructions.map(s => s.trim()).filter(Boolean);
  /* two photos, start and end; 400 px wide is plenty on a phone and keeps the whole set near 25 MB */
  const imgs = (x.images || []).slice(0, 2);
  if (imgs.length === 2) {
    const dir = join(root, "public", "lib", id);
    mkdirSync(dir, { recursive: true });
    imgs.forEach((rel, i) => {
      const from = join(src, "exercises", rel), to = join(dir, i + ".jpg");
      if (!existsSync(from) || (existsSync(to) && !force)) return;
      if (hasSips) execFileSync("sips", ["-Z", "400", "-s", "format", "jpeg", "-s", "formatOptions", "45", from, "--out", to], { stdio: "ignore" });
      else copyFileSync(from, to);
    });
    if (existsSync(join(dir, "0.jpg")) && existsSync(join(dir, "1.jpg"))) { e.ph = 1; photos++; }
  }
  out.push(e);
}
out.sort((a, b) => a.n.localeCompare(b.n));
writeFileSync(join(root, "public", "exercises.json"), JSON.stringify(out));
console.log(`${out.length} exercises, ${photos} with photos`);
