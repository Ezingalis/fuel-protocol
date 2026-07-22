# Deploy Fuel Protocol to Cloudflare — every step

You'll end up with one URL that serves the app AND its food API, on Cloudflare's edge, with your FatSecret keys stored as encrypted secrets. There are two paths; **Path A needs no terminal at all.**

Your three files (keep this exact structure):

```
fuel-protocol/
├── wrangler.jsonc          ← tells Cloudflare how to run everything
├── worker.js               ← the API + static file server
└── public/
    └── index.html          ← the app
```

---

## Path A — All in the browser (recommended)

### 1. Put the code on GitHub

1. Go to **github.com** → **+** (top right) → **New repository**.
2. Name: `fuel-protocol` · Visibility: **Private** · click **Create repository**.
3. On the new repo page, click **uploading an existing file**.
4. Drag in `wrangler.jsonc` and `worker.js`. Commit ("Add worker files").
5. GitHub's drag-upload can't create folders from single files, so: click **Add file → Create new file**, type the filename as `public/index.html` (the slash creates the folder), then open your local `index.html` in a text editor, select all, copy, paste into the GitHub editor, and **Commit**.
   - (If you drag the whole `cloudflare-fuel` folder from Finder/Explorer instead, GitHub preserves the structure — either way works. Just confirm the repo shows `public/index.html`, not `index.html` at the root.)

### 2. Create the Worker from the repo

1. Go to **dash.cloudflare.com** (create the account if needed — free plan is fine to start).
2. In the left sidebar choose **Workers & Pages** (it may be under **Compute (Workers)**).
3. Click **Create** → stay on the **Workers** tab → **Import a repository** (connect to Git).
4. Click **Connect GitHub** → authorize Cloudflare → choose your account → grant access to **fuel-protocol** → **Install & Authorize**.
5. Back in Cloudflare, select the **fuel-protocol** repo.
6. Build settings:
   - **Project name:** `fuel-protocol`
   - **Build command:** leave **empty** (there is nothing to build)
   - **Deploy command:** `npx wrangler deploy` (usually pre-filled)
7. Click **Create and deploy** and wait ~1 minute.

Your app is now live at:

```
https://fuel-protocol.<your-subdomain>.workers.dev
```

Open it — the app works immediately (food search runs on Open Food Facts until you add FatSecret keys).

### 3. Add your FatSecret keys as secrets

1. Open your Worker: **Workers & Pages → fuel-protocol**.
2. Go to **Settings → Variables and Secrets** → **Add**.
3. Type: **Secret** · Name: `FS_KEY` · Value: *your FatSecret Consumer Key* → **Save**.
4. **Add** again → Type: **Secret** · Name: `FS_SECRET` · Value: *your Consumer Secret* → **Save**.
5. If a banner offers **Deploy** to apply changes, click it (otherwise go to **Deployments** and redeploy the latest).

> Never put these keys in the code or the repo. Secrets set here are encrypted and invisible after saving. If you ever pasted your keys anywhere public (including a chat), regenerate them at platform.fatsecret.com first, then paste the NEW ones here.

### 3b. Turn on accounts (D1 database + email sign-in links)

Without this, the app still runs but can't create accounts. Three things to set up: the database, the email sender, and the session secret.

**Create the database**

1. Cloudflare dashboard → **Storage & Databases → D1** → **Create database**.
2. Name it `fuel-protocol-db` → **Create**.
3. Copy the **Database ID** it shows you.
4. In GitHub, edit `wrangler.jsonc` and paste that ID over `PASTE_YOUR_D1_DATABASE_ID_HERE`. Commit — Cloudflare redeploys automatically.
5. Create the tables: open the database → **Console** tab → paste the entire contents of `schema.sql` → **Execute**.
   - Terminal alternative: `npx wrangler d1 execute fuel-protocol-db --remote --file=./schema.sql`

**Set up email (Resend)**

1. Sign up at **resend.com** (free tier covers 3,000 emails/month — far more than 30 users need).
2. **API Keys → Create API Key**, sending permission. Copy it (shown once).
3. For real sending you need a verified sender. Either:
   - **Fastest:** skip domain setup and use Resend's shared `onboarding@resend.dev` sender — works immediately, but only delivers to *your own* Resend account email. Fine for testing, not for other users.
   - **For real users:** **Domains → Add Domain**, enter a domain you own, and add the DNS records Resend gives you. If the domain is already on Cloudflare, adding the records takes two minutes. Then your sender is something like `Fuel Protocol <hello@yourdomain.com>`.

**Add the secrets**

Worker → **Settings → Variables and Secrets → Add**, type **Secret** each time:

| Name | Value |
|---|---|
| `SESSION_SECRET` | A long random string you invent — this signs sign-in cookies. 40+ characters, never share it. |
| `RESEND_KEY` | The Resend API key from above |
| `MAIL_FROM` | Your verified sender, e.g. `Fuel Protocol <hello@yourdomain.com>` |

Deploy again so the secrets take effect.

> Changing `SESSION_SECRET` later signs everyone out — that's also your emergency "log everyone out" button.

**Testing before email works:** add one more variable, `ALLOW_DEV_LINK` = `1` (a plain Variable, not a Secret). When email sending fails, the app shows the sign-in link on screen so you can click through. **Delete this variable before anyone else uses the app** — while it's on, anyone could request a link for any address and see it.

### 4. Verify

- Visit `https://fuel-protocol.<subdomain>.workers.dev/api/health` → you want `"ok":true`, `"fs":true` (FatSecret keys set), `"accounts":true` (D1 + session secret), `"email":true` (Resend key).
- Open the app → enter your email → check your inbox → tap the link. You should land back in the app signed in.
- **Settings** tab → Account shows your email and "All changes saved"; "Online search & barcode" reads **Connected**.
- Sign in on a second device with the same email — your diary should follow you.
- Search "banza" in Add food — results tagged **FS** come from FatSecret, **OFF** from Open Food Facts.

### 5. Put it on your phone

Open the URL in Safari (iPhone) → Share → **Add to Home Screen**. It launches full-screen like a native app. Your data lives on the phone (localStorage), so always use the same browser/device — or use Settings → Export to move data.

### About the FatSecret IP allowlist

FatSecret's dashboard may ask you to allowlist server IPs. Cloudflare Workers don't have one fixed egress IP, so:
- If your FatSecret plan lets you disable IP restrictions, do that.
- Otherwise don't worry: the Worker automatically falls back to **Open Food Facts** (no key, no allowlist) for search and barcodes, so the app never breaks. `/api/health` shows `"fs":true` only when your keys are set; if FatSecret rejects a call, results silently come from OFF instead.

### Updating the app later

Edit `public/index.html` in GitHub (or push a new version) → Cloudflare auto-builds and deploys on every commit to `main`. That's the whole update process.

---

## Path B — Terminal (2 commands, same result)

```bash
cd cloudflare-fuel
npx wrangler login                       # opens browser to authorize

npx wrangler d1 create fuel-protocol-db  # paste the printed database_id into wrangler.jsonc
npx wrangler d1 execute fuel-protocol-db --remote --file=./schema.sql

npx wrangler deploy                      # deploys app + worker

npx wrangler secret put FS_KEY           # FatSecret consumer key
npx wrangler secret put FS_SECRET        # FatSecret consumer secret
npx wrangler secret put SESSION_SECRET   # long random string you invent
npx wrangler secret put RESEND_KEY       # Resend API key
npx wrangler secret put MAIL_FROM        # e.g. Fuel Protocol <hello@yourdomain.com>

npx wrangler deploy                      # redeploy with secrets live
```

---

## Costs, and hosting your other projects here

- **Free plan:** 100,000 Worker requests/day, static assets free, D1 free tier covers 5 GB storage and 5 million row reads/day. Thirty people logging food all day won't come close — a full year of diaries is a few megabytes.
- **Resend free tier:** 3,000 emails/month, 100/day. Sign-in links are the only email the app sends.
- **Workers Paid — $5/month:** 10 million requests/mo included, higher CPU limits, plus access to KV, D1 (SQL), R2 (file storage), cron jobs, and queues for future projects. Recommended since you want to host everything here.
- Each new project = its own repo + its own `wrangler.jsonc` with a unique `"name"` → repeat Path A step 2. Every project gets `https://<name>.<subdomain>.workers.dev` for free.
- **Custom domain (optional):** buy/move a domain into Cloudflare (Account Home → Domain Registration), then Worker → **Settings → Domains & Routes → Add → Custom domain** and type e.g. `fuel.yourdomain.com`. Cloudflare wires DNS + TLS automatically.
