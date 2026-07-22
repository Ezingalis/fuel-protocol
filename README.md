# Fuel Protocol v2

A personal nutrition diary — MyFitnessPal-style — built as one HTML file plus one Cloudflare Worker.

## What's inside

| File | Purpose |
|---|---|
| `public/index.html` | The entire app (UI + logic, no build step) |
| `worker.js` | Serves the app, handles accounts + sync, proxies food APIs (FatSecret → Open Food Facts fallback) |
| `schema.sql` | D1 database tables (users, state, magic links) |
| `wrangler.jsonc` | Cloudflare config (static assets + D1 binding) |
| `DEPLOY.md` | Click-by-click deployment guide |

## Features

- **Diary** — real calendar dates, 4 meals, calorie ring (calories left), macro bars, water tracker, copy-meal-from-yesterday
- **Add food** — recents, frequents, favorites, custom foods, quick add (cal/macros), full-text search (local library + FatSecret + Open Food Facts), barcode scanner
- **Recipes** — build once from ingredients, auto per-serving macros, log by the serving
- **Plans** — built-in 3-Week Cut (21 days), save any 1–3 logged diary days as a reusable plan, apply a plan day in one tap
- **Progress** — 14-day calorie chart vs target, weight trend line, averages
- **Settings** — Mifflin-St Jeor BMR/TDEE, goal-rate → auto calorie target or custom, macro targets by grams or percent, export/import

## Accounts

Sign-in is a link emailed to you — no passwords. Requesting a link creates the account if it's new. The link works once, expires in 15 minutes, and sets a signed, httpOnly session cookie good for 90 days. Only a hash of each link token is ever stored.

## Data

Each account's diary is one JSON blob: a local copy in `localStorage` (`fuelprotocol:v5:<uid>`) so the app is instant and works offline, and a server copy in D1. On load the newer `updatedAt` wins; changes push back a couple of seconds after you stop editing. Settings → Export still works for manual backups.

## Secrets

Set as Cloudflare Worker secrets, never committed:

| Secret | Purpose |
|---|---|
| `SESSION_SECRET` | Signs session cookies. Changing it signs everyone out. |
| `RESEND_KEY` | Sends sign-in emails |
| `MAIL_FROM` | Verified sender address |
| `FS_KEY` / `FS_SECRET` | FatSecret API. Without them, search and barcode run entirely on Open Food Facts. |

`ALLOW_DEV_LINK=1` shows sign-in links on screen when email isn't configured — for first-run testing only, remove it before other people use the app.
