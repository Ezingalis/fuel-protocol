/* Real demo videos for library exercises, from wger (wger.de, exercise videos under CC BY-SA 4.0, each by
   the author wger names). One video per exercise is fetched, cut to a short square loop like the program
   demo clips (480 × 480, H.264, no sound, about 0.6 MB) with a poster frame, and saved as
   public/media/ex/wger<exercise>.mp4 and .jpg (gitignored with the other clips). The library exercise gets
   "v" (the clip) and "va" (the author, for the credit line). Needs ffmpeg.

   Run after build-library.mjs and build-everkinetic.mjs:
     node scripts/build-wger-videos.mjs            add --force to fetch again, --dry to only check the list
   Originals are downloaded one at a time to a temporary folder and deleted once cut. */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, statSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const force = process.argv.includes("--force"), dry = process.argv.includes("--dry");
const libPath = join(root, "public", "exercises.json"), out = join(root, "public", "media", "ex");
const lib = JSON.parse(readFileSync(libPath, "utf8"));
lib.forEach(x => { if (String(x.v || "").startsWith("wger")) { delete x.v; delete x.va; } });
const byName = {}; lib.forEach(x => { byName[x.n] = x; });

/* wger exercise id -> the library exercise it shows, checked by hand against each clip. Left out: 475 (an
   assisted pull-up machine), 477 (the same clip), 659 (unclear which triceps move), 206, 374 (a second clip of
   something already covered). 507 uses dumbbells, so it's the dumbbell stiff-legged deadlift; 211 is seated. */
const MAP = {
  12: "Thigh Adductor", 46: "Barbell Lunge", 73: "Barbell Bench Press - Medium Grip", 75: "Dumbbell Bench Press",
  82: "Seated Bent-Over Rear Delt Raise", 91: "Barbell Curl", 92: "Dumbbell Bicep Curl", 95: "Standing Biceps Cable Curl",
  194: "Dips - Chest Version", 205: "Dumbbell Lunges", 211: "Seated Triceps Press", 222: "Face Pull",
  245: "Lying Dumbbell Tricep Extension", 246: "EZ-Bar Skullcrusher", 257: "Front Squat (Clean Grip)", 272: "Hammer Curls",
  275: "Cable Hammer Curls - Rope Attachment", 294: "Barbell Hip Thrust", 341: "Smith Machine Squat", 348: "Side Lateral Raise",
  349: "Standing Low-Pulley Deltoid Raise", 365: "Lying Leg Curls", 366: "Seated Leg Curl", 367: "Standing Leg Curl", 371: "Leg Press",
  375: "Hack Squat", 465: "Preacher Curl", 507: "Stiff-Legged Dumbbell Deadlift", 512: "Seated Cable Rows",
  537: "Incline Dumbbell Press", 538: "Barbell Incline Bench Press - Medium Grip", 543: "Machine Shoulder (Military) Press",
  567: "Dumbbell Shoulder Press", 570: "Barbell Shrug", 575: "Smith Machine Shoulder Shrugs", 584: "One Arm Dumbbell Preacher Curl",
  590: "Seated Calf Raise", 622: "Standing Calf Raises", 655: "Tricep Dumbbell Kickback",
  802: "Barbell Walking Lunge", 803: "Cable One Arm Tricep Extension" };
for (const n of Object.values(MAP)) if (!byName[n]) throw new Error("not in the library: " + n);

const api = async u => { const r = await fetch(u, { headers: { Accept: "application/json" } }); if (!r.ok) throw new Error(u + " " + r.status); return r.json(); };
const vids = (await api("https://wger.de/api/v2/video/?limit=200")).results.filter(v => v.license === 2);
/* one per exercise: the main one, else the smallest that's at least 720p (no 4K originals) */
const pick = {};
for (const v of vids) {
  if (!MAP[v.exercise]) continue;
  const cur = pick[v.exercise], ok = x => Math.min(x.width, x.height) >= 720 && Math.max(x.width, x.height) <= 1920;
  const better = !cur || (v.is_main && !cur.is_main) || (v.is_main === cur.is_main && (ok(v) && !ok(cur) || ok(v) === ok(cur) && v.size < cur.size));
  if (better) pick[v.exercise] = v;
}
if (!dry) mkdirSync(out, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "wger-"));
let done = 0, bytes = 0;
for (const [eid, v] of Object.entries(pick)) {
  const id = "wger" + eid, mp4 = join(out, id + ".mp4"), jpg = join(out, id + ".jpg"), x = byName[MAP[eid]];
  x.v = id; x.va = String(v.license_author || "wger contributors").trim();
  if (dry) { console.log(`${id}  ${MAP[eid]}  ${v.width}x${v.height} ${Math.round(v.size / 1e6)} MB  by ${x.va}`); continue; }
  if (force || !existsSync(mp4) || !existsSync(jpg)) {
    const src = join(tmp, "src" + (/\.\w+$/.exec(v.video) || [".mp4"])[0]);
    const r = await fetch(v.video);
    if (!r.ok) { console.error(`skip ${id}: ${r.status}`); delete x.v; delete x.va; continue; }
    writeFileSync(src, Buffer.from(await r.arrayBuffer()));
    /* the middle of the clip, at most 10 s, cropped square from the center, like the program clips */
    const len = Math.min(10, +v.duration || 10), start = Math.max(0, ((+v.duration || 0) - len) / 2);
    const sq = "crop='min(iw,ih)':'min(iw,ih)',scale=480:480:flags=lanczos,fps=30,format=yuv420p";
    execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", String(start), "-t", String(len), "-i", src, "-an", "-vf", sq,
      "-c:v", "libx264", "-profile:v", "main", "-crf", "30", "-preset", "slow", "-movflags", "+faststart", mp4]);
    execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", String(Math.min(len / 2, 2)), "-i", mp4, "-frames:v", "1", "-q:v", "5", jpg]);
    rmSync(src);
  }
  bytes += statSync(mp4).size; done++;
}
rmSync(tmp, { recursive: true, force: true });
if (!dry) writeFileSync(libPath, JSON.stringify(lib));
console.log(`${Object.keys(pick).length} wger videos` + (dry ? " (dry run)" : `, ${done} clips, ${(bytes / 1048576).toFixed(1)} MB`));
