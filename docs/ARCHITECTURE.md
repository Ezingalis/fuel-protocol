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

## Why D1 (vs. Supabase & friends)

The data model is one blob per user — no relational queries, no realtime, no
row-level security needed. D1 rides in the same `wrangler deploy`, costs
nothing at this scale, and the free tier (5 GB / 5M row reads/day) is orders of
magnitude above what 30 users of diary JSON can generate.
