# Architecture

One HTML file, one Worker, one database. No build step, no framework.

```
Browser (public/index.html)
   │  localStorage: fuelprotocol:v5:<uid>   ← instant, offline-first
   │
   ├── /api/auth/*  /api/me  /api/state     ← same-origin, cookie auth
   └── /api/search  /api/barcode  /api/food ← open, CORS *
   │
Cloudflare Worker (worker.js)
   ├── D1 (users, state, magic_links)
   ├── Resend (sign-in emails)
   └── FatSecret → Open Food Facts (food data, automatic fallback)
```

## The app (public/index.html)

The entire UI and logic in one file served as a static asset. State lives in a
single JSON blob per user. Storage key is versioned (`fuelprotocol:v5:<uid>`);
a v4 → v5 migration path runs on load. The only external resource is the
`@zxing/library` barcode scanner from unpkg.

## Sync model

Each account's diary is **one JSON blob** stored twice:

- **Local**: `localStorage` — the app reads/writes this synchronously, so it is
  instant and works offline.
- **Server**: the `state` table in D1, one row per user (`user_id`, `json`,
  `updated_at`).

Conflict rule: **newer `updatedAt` wins** on load. Edits push to
`PUT /api/state` a couple of seconds after the user stops changing things
(debounced). Blob size is capped at 4 MB server-side.

## Auth: magic links, no passwords

1. `POST /api/auth/request` — creates the account if new. Generates a 32-byte
   random token; stores **only its SHA-256 hash** in `magic_links` with a
   15-minute expiry. Rate limit: one link per email per 60 seconds.
2. Resend emails the link. If sending fails **and** `ALLOW_DEV_LINK=1`, the
   link is returned in the response instead (first-run testing only).
3. `GET /api/auth/verify?token=` — looks up the hash, checks expiry and
   `used_at` (single-use), then sets the session cookie and redirects to
   `/?signedin=1` (or `/?expired=1` on any failure).

## Sessions

The cookie `fp_session` is `payload.signature`:

- payload: base64url of `{ uid, exp }` (90-day expiry)
- signature: HMAC-SHA-256 of the payload keyed by `SESSION_SECRET`

Flags: `HttpOnly; Secure; SameSite=Lax`. Verification is constant-time.
There is no server-side session table — rotating `SESSION_SECRET` instantly
signs everyone out.

## Food data

`/api/search` tries FatSecret first (OAuth 1.0a HMAC-SHA1 request signing, done
in the Worker with Web Crypto), falling back to Open Food Facts if keys are
missing or the call fails. `/api/barcode` goes OFF-first, then FatSecret.
Every source is normalized to one item shape:

```json
{ "name": "", "brand": "", "unit": "g|serving", "step": 25, "base": 100,
  "cal": 0, "p": 0, "c": 0, "f": 0, "src": "fatsecret|off", "fsid": null }
```

## Plan sharing

User-created meal plans live inside the diary blob (private by default). Sharing
copies a snapshot into the `shared_plans` table behind a random 8-character code;
anyone signed in can import it by code. Imports are sanitized field-by-field
(fresh ids, coerced numbers, capped sizes) since the payload is another user's
content. Applied plans tag each diary entry with an application id (`ap`), which
is what makes "remove this plan's foods from my calendar" possible without
touching manually logged food.

## Weights

Each diary day stores `weights: [{ t, w }]` — every weigh-in keeps its exact
timestamp, so a 9 AM and a 10 PM entry coexist. The progress chart plots the
daily average. (Migrated automatically from the old single `weight` field.)

## Workouts

`DB.gym` rides the same blob: `week` (weekday → routine id), `routines`,
`logs` (one per date: exercises → sets `{reps, lb, done}`), and `prs` (best set
per exercise by Epley e1RM; plain reps for bodyweight). Guided sessions pre-fill
each set from the most recent log of the same exercise. The exercise library is
`public/exercises.json` — 876 entries trimmed (name / muscle / equipment /
category) from the public-domain
[free-exercise-db](https://github.com/yuhonas/free-exercise-db) (Unlicense),
served as a static asset and fetched lazily. No worker or schema changes;
feature design inspired by [openGym](https://github.com/DuarteSantos8/openGym)
(AGPL) but implemented clean-room — no code or data from it.

## Programs and PDF import

`DB.gym.programs` holds multi-week programs: `weeks[] → sessions[] → ex[]`, each
exercise carrying sets, reps, a `target` line (%1RM / RPE / rep range as written),
load, and prescribed `rest` (which drives the rest timer). `DB.gym.active`
tracks the running program: current week `w` and `done` marks keyed `"week|session"`.
Sessions within a week run **in order, not by weekday** — missing a day never
breaks the program, the next session is just the first one not done. Redo / skip /
back / jump / restart / end all mutate only `active`, snapshot it first, and offer
Undo; workout logs are never touched.

`POST /api/gym/import` turns a PDF into that structure. With `ANTHROPIC_API_KEY`
it uploads the PDF through the Files API (deleted right after, 1 h expiry as a
backstop), asks Claude for JSON matching a strict schema (structured outputs,
server-side refusal fallback), and streams heartbeats so the minutes-long read
never idles out. Without a key — or if Claude fails — Workers AI converts the PDF
to markdown and Llama fills the same schema from the first block of weeks. Either
way the worker rebuilds the output field by field with hard bounds and expands
"Week 1-2"-style blocks into individual weeks. Imports are capped per user per day
in `gym_imports`.

## Why D1 (vs. Supabase & friends)

The data model is one blob per user — no relational queries, no realtime, no
row-level security needed. D1 rides in the same `wrangler deploy`, costs
nothing at this scale, and the free tier (5 GB / 5M row reads/day) is orders of
magnitude above what 30 users of diary JSON can generate.

## Program codes

A program can also arrive as an 8-character code (Workout tab → "Have a program
code?"). The code points at a `shared_plans` row whose JSON is
`{ "kind": "program", "program": <cleanProgram output> }`; the client coerces it
through `programDraftFrom()` and opens the same review screen as a PDF import.
This is how PDFs converted outside the app (for example in a Claude Code chat,
validated with `program.js`) reach an account without spending the in-app
import quota. Meal-plan codes and program codes share the table; each import
box rejects the other kind with a pointer to the right tab.

## Installable + offline (PWA)

`public/manifest.webmanifest` plus PNG icons and per-iPhone launch screens in
`public/icons/` make "Add to Home Screen" install Fuel as a full-screen app.
`public/sw.js` caches the app shell (page, font, icons) and the exercise
library, serving the page network-first so updates arrive on the next open.
It never caches `/api/*` or any non-GET request: diary data stays in
localStorage + `/api/state`. When the connection returns (`online` event, or
the app coming back to the foreground after a failed sync) the page calls
`pullState()`, which pushes local changes if they're newer.

## Exercise videos

A program exercise can carry `steps`: a drop set's drops, a cluster's mini-sets, a
superset's partner. Each step names its movement, the reps per round ("12, 10 reps",
"to failure", "1:06"), a cue, and a demo clip id. The workout card shows the steps with
tap-to-play thumbnails above the rows you log. The player is a fixed overlay outside
the render tree, so ticking sets never restarts a clip.

Every step is its own logged row, grouped by round (`set.g` round, `set.p` position,
`set.k` label): drop sets read Top, Drop 1, Drop 2; rest-pause and clusters Main,
Mini 1...; supersets A, B; timed steps are Hold rows with a check only. Reps prefill
per round from the step ("12, 10 reps"), weights from last time's row in the same round
and position. The full rest timer starts only after a round's last row; rest-pause gets
a 15 s breather between mini-sets, drops and clusters none. Add/Remove work by whole round.

- Clips are 480×480 H.264 MP4s plus JPG thumbnails at `public/media/ex/<id>.mp4|.jpg`.
  They're licensed for personal use: `public/media/` is gitignored and ships only from
  the machine that holds the files. A deploy from a fresh clone has no clips (thumbnails
  hide themselves; the player says the video is unavailable).
- `run_worker_first: ["/media/*"]` sends clip requests through the worker, which
  requires a valid session and answers byte ranges with 206 (iPhone video needs them).
  The service worker never caches `/media/`.
- Remux clips with `ffmpeg -i in.mp4 -map 0 -c copy -movflags +faststart out.mp4`:
  exports from streaming services can carry a bogus duration that breaks looping on iOS.
- `routineToProgram()` in `program.js` turns a `fuel.routine/v1` export (weeks > days >
  blocks > steps, plus an exercise library) into the program format; each block becomes
  one exercise. The result passes through `cleanProgram()` and is delivered as a program
  code. D1 caps one SQL statement at 100 KB, so long programs are inserted as an INSERT
  plus `json = json || '…'` appends.

## Workout flow

Workouts live in `DB.gym.logs`, keyed by date; a second workout that day is `"<date>~2"`, then `~3`
(`logsOn`, `newLogKey`, `logDate`). The Workout tab shows, in order: a workout in progress
(Continue / Finish now / Discard), what's done today, **Up next** (Start or Preview), the
program's week, and recent workouts. Any of them opens in the player.

**Up next** is the session after the last one done in the current week, moving into the next week
when the current one runs out (`progState().up`). A missed day never holds the program up: it shows
as Missed (or "left undone in earlier weeks") and can still be done, or marked done outside the
app, from its preview. Doing a later week's session moves the program's week forward.

The player (`#player`) shows one exercise at a time: the demo looping on top, the rows below, rest
timer and Next/Finish pinned to the bottom, a list view, and a menu (finish now, discard, delete,
edit sets). The same screen previews any program session read-only (`kind: "gymprev"`) with
Start at the bottom; the program view lists weeks and sessions and opens these previews. It
renders into its own root outside `#app` and repaints only what changed (`paintPlayer`), never
the number box being typed in, so ticking a set or the rest timer never reloads the video. The
screen is kept awake (Screen Wake Lock) while a workout is open.

Reps and weight can be typed or stepped. A change flows forward only (`setField`): later sets
that still hold the old value follow it; a ticked set or one already set to something else stops
it. In a drop set only the same row of later rounds follows; rest-pause and cluster mini-sets
share the main set's weight. `touch-action: manipulation` and 16 px inputs stop iOS zooming.

Deleting or discarding a workout, and marking a session done or not done, go through
`gymChange`: one undo restores both the workouts and the program, and PRs are rebuilt from the
remaining workouts (`recomputePRs`).

## Home Screen app and offline videos

On iPhone, a Home Screen web app keeps its own cookies, so a link opened from Mail signs
in Safari, not the app. Every sign-in email therefore carries a 6-digit code as well
(`POST /api/auth/code`). The code is an HMAC of the link's stored hash with
`SESSION_SECRET`, so nothing extra is stored; wrong guesses are counted in `code_tries`:
5 per code, 20 a day per address, then the code is burned.

"Save videos to this phone" downloads the active program's clips into the
`fuel-media` cache. The service worker answers `/media/*` from that cache when it can,
cutting the byte range the video player asks for (206), and otherwise goes to the
network. Thumbnails are cached as they're seen. App updates clear the shell cache but
never `fuel-media`.

## Training analytics

Every number is computed from the workouts in `DB.gym.logs`, so deleting or editing one updates
everything. The only stored extras are each workout's answers (`log.feel`: effort 1-5, energy 1-3,
pain 1-3, note) and next-time weight bumps (`gym.bump[exercise]`).

- **Summary** (opens when a workout is finished, or when a finished one is opened): time, volume,
  sets and reps against the last time the same session was done (`prevSame`: same program session
  in any week, same routine, or same name), new records, each exercise's best set and est. 1RM
  change, sets per muscle, the "how did it feel" questions, and next-time weights.
- **Records** (`logPRs`), against every earlier workout; a first-ever exercise isn't a record:
  heaviest weight, else best est. 1RM (Epley), else most reps (bodyweight); plus best set volume,
  else most volume in a workout. Ticking a set that beats history shows a live record toast and a
  trophy on the set.
- **Next time** (`nextBumps`): when every row with a target was done at or above its target reps,
  and the workout wasn't marked All out or that something hurt, the top weight goes up 5 lb
  (2.5 under 30 lb). Applied once on leaving the summary, and used up by the next workout that
  starts with that exercise.
- **In the workout**: a "Last time" line per exercise, and plates per side for barbell lifts.
- **Stats** (Workout tab → Stats, or Progress): a range against the one before it, weekly or
  monthly bars (volume, sets, time, workouts), a 12-week calendar and weekly streak, working sets
  per muscle in the last 7 days against 10-20 (a drop set or rest-pause round counts once), the
  strongest lifts, and a page per exercise with charts (est. 1RM, heaviest, best set, volume,
  reps), records and history.

## Training tools

- **Effort per set**: after ticking a set, a strip asks RPE 6-10 (stored as `set.rpe`; "Stop asking"
  sets `profile.noRPE`, and the player menu turns it back on). Ticked rows show an arrow against the
  same row last time (`prevExSets` + `lastRow`).
- **Muscle credit** (`muscleSets`): the main muscle counts a full working set, muscles that help count
  half (`helperMuscles`, by movement pattern); a drop/rest-pause/cluster round counts once
  (`workSets`). Weekly targets follow the diet (`volTarget`): 8-16 below maintenance, 10-20 at it,
  12-22 above.
- **Recovery** (`recovery`): sets from the last two weeks fade by half every 36 h (48 h for legs and
  lower back): worked hard (6+), recovering (2-6), ready, or not trained in 10 days.
- **Rough day**: before the first set, "Go 10% lighter" scales today's weights (originals kept in
  `set.lb0`, one tap puts them back).
- **Cardio**: a log with `log.cardio` {type, min, mi, hr, eff, cal, note}; live timer in
  `gym.cardioLive`. Calories = MET × kg × hours × effort (0.8 / 1 / 1.25).
- **CSV**: export is one row per set (and per cardio session). Import reads Hevy's or Strong's export,
  converts kg, groups rows back into workouts, skips anything already imported (`log.imp`), and goes
  through `gymChange` so one undo removes it.

## Layout

Four tabs: **Diary · Food · Train · Progress**. Settings is the gear in each header (`topBar`), with
Done returning to the tab you came from. Views inside a tab are a segmented control (`segCtl`):

- **Food**: Meal plans | Recipes.
- **Train**: **Today** (the workout in progress or Up next with Start, done today, quick start for an
  empty workout or cardio, this week's day dots, a one-line recovery summary) | **Plan** (the
  program's week, saved videos, scheduled sessions, sets per muscle, routines, programs, "Add a
  program" for PDF or code) | **History** (month calendar and every workout and cardio session,
  newest first).
- **Progress**: Body & food | Training (the stats).

An open workout or running cardio timer shows as a resume bar above the tab bar on every other
screen (`paintResume`). In the workout: Finish top right, the title toggles the exercise list, weight
before reps, "Use these" copies last time's numbers, rest has −15 / +15 / Skip with a draining
line, the demo shrinks once the exercise is under way, and a sideways swipe moves between
exercises. Effort is asked once per round, after its last row.
