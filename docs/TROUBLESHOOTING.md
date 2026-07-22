# Troubleshooting

First stop, always: **`/api/health`**

```json
{ "ok": true, "fs": true, "accounts": true, "email": true }
```

Any `false` tells you which subsystem to look at.

## `accounts: false`
`SESSION_SECRET` missing or the D1 binding is broken. Check
**Worker → Settings → Variables and Secrets** and that `wrangler.jsonc` has the
real `database_id`. Auth routes return `503 not_configured` in this state.

## `email: false`
`RESEND_KEY` isn't set. Sign-in still works if `ALLOW_DEV_LINK=1` (link shows
on screen).

## Sign-in email never arrives
- Check **Spam** and Gmail's **Promotions** tab.
- Using `onboarding@resend.dev`? It only delivers to **your own Resend account
  email** — any other recipient silently goes nowhere. Verify a real domain
  (resend.com → Domains) and point `MAIL_FROM` at it.
- Check resend.com → **Emails** — every send attempt is logged with its
  delivery status. This is the definitive answer to "did it send?"

## "Link expired" when clicking a sign-in link
Links are single-use and die after 15 minutes. Email apps that "preview" links
can consume them. Request a fresh one; if it persists, check the device clock.

## `429` when requesting sign-in links
One link per email per 60 seconds, by design — wait a minute. There's also a
per-IP cap of 15 requests per 24 h (`IP_LINKS_PER_DAY`) so strangers can't
drain the email quota; legitimate users won't hit it.

## Everyone got signed out
`SESSION_SECRET` changed. That's the designed behavior (emergency logout).
Sessions otherwise last 90 days.

## Food search returns nothing / no FS-tagged results
- `fs: false` → FatSecret keys not set; everything comes from Open Food Facts
  (tagged **OFF**). That's the designed fallback, not an outage.
- `fs: true` but still no FS results → FatSecret may be rejecting calls
  (IP allowlist). Workers have no fixed egress IP: disable IP restrictions in
  the FatSecret dashboard if your plan allows. The OFF fallback keeps the app
  working regardless.

## Sync conflicts / stale data across devices
The newer `updatedAt` wins, whole-blob. If a device was offline for long, its
older blob loses to the server copy on next load. Settings → Export before
doing anything drastic.

## Local dev quirks
- Local D1 state persists in `.wrangler/state` — delete that folder for a
  clean slate.
- Tests boot `wrangler dev` on port **8799**; a stale process there will fail
  the suite: `lsof -ti:8799 | xargs kill`.
- First `wrangler dev`/test run downloads the `workerd` runtime — slow once,
  fast after.
