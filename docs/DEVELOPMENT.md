# Development

## Prerequisites

Node 20+ (this machine runs 24 via nvm). Then:

```bash
npm install          # wrangler, locally pinned
cp .dev.vars.example .dev.vars   # local-only secrets, gitignored
```

## Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Local server on :8787 — real Worker runtime, **local** D1, `.dev.vars` secrets |
| `npm test` | Full suite: structural checks + integration tests against a throwaway `wrangler dev` |
| `npm run deploy` | Ship to production |
| `npm run db:schema` | Apply `schema.sql` to the **remote** D1 (idempotent — `IF NOT EXISTS`) |

For local D1 schema (first `npm run dev` on a machine):

```bash
npx wrangler d1 execute fuel-protocol-db --local --file=./schema.sql
```

## The loop

1. Edit `public/index.html` (app) or `worker.js` (API) — no build step.
2. `npm run dev` hot-reloads on save. With `.dev.vars` defaults,
   `ALLOW_DEV_LINK=1` puts sign-in links on screen — no email needed locally.
3. `npm test` before shipping.
4. `npm run deploy` (or `git push` once Cloudflare Git integration is connected).

## Tests

- `tests/app.test.mjs` — fast structural checks, no network: the app is
  self-contained, endpoints it calls exist, secrets aren't inlined, schema and
  config are coherent.
- `tests/worker.test.mjs` — boots `wrangler dev` on port 8799 with **local**
  D1 (never remote), then exercises the real HTTP surface: health, the full
  magic-link → cookie → state-sync round trip, rate limiting, single-use links,
  forged-cookie rejection, input validation.

Remote/production data is never touched by tests.

## Production data

```bash
# Peek at users (remote!)
npx wrangler d1 execute fuel-protocol-db --remote --command "SELECT email, created_at FROM users"

# Live logs
npx wrangler tail
```

## Conventions

- One file per concern: app = `index.html`, API = `worker.js`, DB = `schema.sql`.
- Secrets only via `env.*` — the test suite fails if a key-shaped literal
  appears in code.
- New API routes: add to `worker.js`, document in `docs/API.md`, cover in
  `tests/worker.test.mjs`.
