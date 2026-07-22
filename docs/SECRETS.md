# Secrets & Variables

Everything lives in Cloudflare — nothing sensitive is in the code or repo
(the test suite enforces this). Set via terminal:

```bash
npx wrangler secret put <NAME>     # prompts for the value, then redeploy
```

or dashboard: **Worker → Settings → Variables and Secrets**.

## Secrets (encrypted)

| Name | Purpose | Notes |
|---|---|---|
| `SESSION_SECRET` | Signs `fp_session` cookies (HMAC-SHA-256) | 40+ random chars. **Rotating it signs everyone out instantly** — that's the emergency logout button. This project set it via `openssl rand -base64 48 \| wrangler secret put`, so no human has ever seen it. |
| `RESEND_KEY` | Sends sign-in emails | Create at resend.com → API Keys, **sending access only** |
| `FS_KEY` | FatSecret Consumer Key | Optional — without it, search/barcode run on Open Food Facts |
| `FS_SECRET` | FatSecret Consumer Secret | Pairs with `FS_KEY` |

## Plain variables (in `wrangler.jsonc` → `vars`)

| Name | Purpose | Notes |
|---|---|---|
| `MAIL_FROM` | Sender for sign-in emails | Must be Resend-verified. `onboarding@resend.dev` delivers **only to your own Resend account email** |
| `ALLOW_DEV_LINK` | `"1"` shows sign-in links on screen when email fails | **First-run testing only. Delete before anyone else uses the app** — while on, anyone can request a link for any address and read it |

## Local development

`wrangler dev` reads `.dev.vars` (gitignored — copy from `.dev.vars.example`).
Local values never touch production; production secrets never touch disk.

## If a key leaks

1. Regenerate at the provider (Resend / FatSecret dashboards).
2. `npx wrangler secret put <NAME>` with the new value → `npx wrangler deploy`.
3. For `SESSION_SECRET`: set a fresh random one — all sessions revoked.
