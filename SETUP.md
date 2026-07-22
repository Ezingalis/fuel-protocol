# Fuel Protocol — Setup Checklist

Live checklist from this folder to a deployed app. Click-by-click detail for every step lives in [DEPLOY.md](DEPLOY.md).

## 0. Local tools

- [ ] Node.js 20+ installed (`node --version`)
- [ ] `npm install` (installs wrangler locally)
- [ ] `npx wrangler login` (opens a browser to authorize Cloudflare)

## 1. Cloudflare account

- [ ] Create free account at cloudflare.com
- [ ] Note your Account ID: ___________

## 2. D1 database

- [ ] Create it: `npx wrangler d1 create fuel-protocol-db`
      (or dashboard → Storage & Databases → D1 → Create)
- [ ] Copy the database_id: ___________
- [ ] Paste it into `wrangler.jsonc` (replaces `PASTE_YOUR_D1_DATABASE_ID_HERE`)
- [ ] Create the tables: `npm run db:schema`

## 3. Resend (sign-in emails)

- [ ] Sign up at resend.com (free tier: 3,000 emails/month)
- [ ] API Keys → Create API Key, **sending access only** — copy it, it's shown once
- [ ] Pick a sender:
  - Testing: `Fuel Protocol <onboarding@resend.dev>` — works immediately, but only delivers to your own Resend email
  - Real users: Domains → Add Domain → add the DNS records → `Fuel Protocol <hello@yourdomain.com>`

## 4. Secrets

Terminal: `npx wrangler secret put NAME` — or dashboard: Worker → Settings → Variables and Secrets.

- [ ] `SESSION_SECRET` (Secret) — long random string you invent, 40+ chars
- [ ] `RESEND_KEY` (Secret) — the Resend API key
- [ ] `MAIL_FROM` (Variable) — your verified sender
- [ ] `FS_KEY` / `FS_SECRET` (Secrets) — FatSecret keys. Optional: without them, search and barcode run on Open Food Facts
- [ ] `ALLOW_DEV_LINK` = `1` (Variable) — first-run testing only. **DELETE BEFORE ANYONE ELSE USES THE APP**

## 5. Deploy

- [ ] `npm run deploy`
- [ ] Visit `https://fuel-protocol.<subdomain>.workers.dev/api/health`
      → want `"ok":true`, `"accounts":true`, `"email":true`, `"fs":true`

## 6. Verify

- [ ] Enter your email in the app → sign-in link arrives → click → land back signed in
- [ ] Settings tab → Account shows your email and "All changes saved"
- [ ] Search "banza" in Add food — results tagged **FS** (FatSecret) and **OFF** (Open Food Facts)
- [ ] Sign in on a second device — diary follows you
- [ ] iPhone: Safari → Share → Add to Home Screen

## 7. Before other people use it

- [ ] Delete the `ALLOW_DEV_LINK` variable
- [ ] Sender is a verified domain in Resend (not `onboarding@resend.dev`)
- [ ] `SESSION_SECRET` is long and random (changing it later signs everyone out)
