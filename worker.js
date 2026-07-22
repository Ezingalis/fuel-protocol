/* Fuel Protocol — Cloudflare Worker
   Serves the app (static assets from /public) and the food API:
     GET /api/health              -> { ok, fs }
     GET /api/search?q=&max=      -> { items: [...] }   FatSecret, falls back to Open Food Facts
     GET /api/barcode?code=       -> { items: [...] }   Open Food Facts first, then FatSecret
     GET /api/food?id=            -> { items: [one] }   FatSecret food.get.v2
   Secrets (set in Cloudflare, never in code): FS_KEY, FS_SECRET
*/

const FS_URL = "https://platform.fatsecret.com/rest/server.api";

/* ---------- OAuth 1.0a signing (Web Crypto) ---------- */
function enc(s) {
  return encodeURIComponent(s).replace(/[!*'()]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
async function hmacSha1B64(key, msg) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  let bin = "";
  new Uint8Array(sig).forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin);
}
async function fsCall(env, params) {
  const oauth = {
    oauth_consumer_key: env.FS_KEY,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: "1.0",
    format: "json"
  };
  const all = Object.assign({}, params, oauth);
  const baseStr = Object.keys(all).sort().map(k => enc(k) + "=" + enc(all[k])).join("&");
  const sigBase = "GET&" + enc(FS_URL) + "&" + enc(baseStr);
  all.oauth_signature = await hmacSha1B64(enc(env.FS_SECRET) + "&", sigBase);
  const qs = Object.keys(all).map(k => enc(k) + "=" + enc(all[k])).join("&");
  const r = await fetch(FS_URL + "?" + qs);
  const t = await r.text();
  let j;
  try { j = JSON.parse(t); } catch (e) { throw new Error("fs_parse"); }
  if (j.error) throw new Error("fs_" + (j.error.code || "err"));
  return j;
}

/* ---------- FatSecret shaping ---------- */
function parseDesc(desc) {
  if (!desc) return null;
  const g = re => { const m = desc.match(re); return m ? parseFloat(m[1]) : 0; };
  const basisM = desc.match(/^Per\s+([^-]+?)\s*-/i);
  const basis = basisM ? basisM[1].trim() : "serving";
  const gramM = basis.match(/([\d.]+)\s*g\b/i);
  return {
    cal: g(/Calories:\s*([\d.]+)/i), fat: g(/Fat:\s*([\d.]+)/i),
    carb: g(/Carbs?:\s*([\d.]+)/i), prot: g(/Protein:\s*([\d.]+)/i),
    basis, grams: gramM ? parseFloat(gramM[1]) : null
  };
}
function fsSearchItem(food) {
  const p = parseDesc(food.food_description) || { cal: 0, fat: 0, carb: 0, prot: 0, basis: "serving", grams: null };
  const brand = food.brand_name || "";
  if (p.grams) return { name: food.food_name, brand, unit: "g", step: 25, base: p.grams, cal: p.cal, p: p.prot, c: p.carb, f: p.fat, src: "fatsecret", fsid: food.food_id };
  return { name: food.food_name, brand: brand || p.basis, unit: "serving", step: 1, base: 1, cal: p.cal, p: p.prot, c: p.carb, f: p.fat, src: "fatsecret", fsid: food.food_id };
}
function fsGetItem(food) {
  let s = food.servings && food.servings.serving;
  if (!s) return null;
  if (Array.isArray(s)) s = s.find(x => (x.metric_serving_unit || "").toLowerCase() === "g") || s[0];
  const num = v => parseFloat(v || 0) || 0;
  const gAmt = num(s.metric_serving_amount);
  if ((s.metric_serving_unit || "").toLowerCase() === "g" && gAmt) {
    return { name: food.food_name, brand: food.brand_name || "", unit: "g", step: 25, base: Math.round(gAmt), cal: num(s.calories), p: num(s.protein), c: num(s.carbohydrate), f: num(s.fat), src: "fatsecret", fsid: food.food_id };
  }
  return { name: food.food_name, brand: (food.brand_name || "") + (s.serving_description ? " · " + s.serving_description : ""), unit: "serving", step: 1, base: 1, cal: num(s.calories), p: num(s.protein), c: num(s.carbohydrate), f: num(s.fat), src: "fatsecret", fsid: food.food_id };
}

/* ---------- Open Food Facts (no key, no IP allowlist) ---------- */
function offItem(pr) {
  const n = pr.nutriments || {};
  const cal = n["energy-kcal_100g"] != null ? n["energy-kcal_100g"] : (n["energy_100g"] ? n["energy_100g"] / 4.184 : 0);
  if (!pr.product_name || !cal) return null;
  return {
    name: pr.product_name, brand: pr.brands || "",
    unit: "g", step: 25, base: 100,
    cal: Math.round(cal), p: +(n.proteins_100g || 0), c: +(n.carbohydrates_100g || 0), f: +(n.fat_100g || 0),
    src: "off", fsid: null
  };
}
async function offSearch(q, max) {
  const u = "https://world.openfoodfacts.org/cgi/search.pl?action=process&json=1&page_size=" + max +
    "&fields=product_name,brands,nutriments&search_terms=" + encodeURIComponent(q);
  const r = await fetch(u, { headers: { "User-Agent": "FuelProtocol/2.0 (personal app)" } });
  const j = await r.json();
  return (j.products || []).map(offItem).filter(Boolean);
}
async function offBarcode(code) {
  const u = "https://world.openfoodfacts.org/api/v2/product/" + encodeURIComponent(code) + ".json?fields=product_name,brands,nutriments";
  const r = await fetch(u, { headers: { "User-Agent": "FuelProtocol/2.0 (personal app)" } });
  const j = await r.json();
  if (j.status !== 1 || !j.product) return [];
  const it = offItem(j.product);
  return it ? [it] : [];
}

/* ---------- routes ---------- */
function json(obj, code, extraHeaders) {
  return new Response(JSON.stringify(obj), {
    status: code || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, extraHeaders || {})
  });
}

/* ================= accounts: magic-link sign-in ================= */
const SESSION_DAYS = 90;
const LINK_MINUTES = 15;

function b64url(bytes) {
  let s = "";
  new Uint8Array(bytes).forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomToken() {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return b64url(a);
}
async function sha256hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function hmac256(secret, msg) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function makeSession(env, uid) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({
    uid, exp: Date.now() + SESSION_DAYS * 864e5
  })));
  return payload + "." + await hmac256(env.SESSION_SECRET, payload);
}
async function readSession(env, request) {
  if (!env.SESSION_SECRET) return null;
  const raw = request.headers.get("Cookie") || "";
  const m = raw.match(/(?:^|;\s*)fp_session=([^;]+)/);
  if (!m) return null;
  const [payload, sig] = decodeURIComponent(m[1]).split(".");
  if (!payload || !sig) return null;
  if (!timingSafeEqual(sig, await hmac256(env.SESSION_SECRET, payload))) return null;
  try {
    const body = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(payload.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0))));
    if (!body.uid || body.exp < Date.now()) return null;
    return body.uid;
  } catch (e) { return null; }
}
function sessionCookie(value, maxAgeSeconds) {
  return "fp_session=" + value + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + maxAgeSeconds;
}
function normalizeEmail(e) { return String(e || "").trim().toLowerCase(); }
function validEmail(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); }

async function sendMagicEmail(env, email, link) {
  if (!env.RESEND_KEY) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + env.RESEND_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.MAIL_FROM || "Fuel Protocol <onboarding@resend.dev>",
      to: [email],
      subject: "Your Fuel Protocol sign-in link",
      text: "Sign in to Fuel Protocol: " + link + "\n\nThis link works once and expires in " + LINK_MINUTES + " minutes. If you didn't ask for it, ignore this email.",
      html: '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:460px;margin:0 auto;padding:28px 4px;color:#101828">'
        + '<div style="font-size:19px;font-weight:800;letter-spacing:-.02em">Fuel Protocol</div>'
        + '<p style="color:#667085;font-size:14px;line-height:1.6">Tap the button to sign in. It works once and expires in ' + LINK_MINUTES + ' minutes.</p>'
        + '<p><a href="' + link + '" style="display:inline-block;background:#00A66C;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 22px;border-radius:12px">Sign in</a></p>'
        + '<p style="color:#98A2B3;font-size:12px;line-height:1.6;word-break:break-all">Or paste this into your browser:<br>' + link + '</p>'
        + '<p style="color:#98A2B3;font-size:12px">Didn\'t request this? You can ignore the email — no account changes were made.</p></div>'
    })
  });
  return r.ok;
}

async function authRoute(url, request, env) {
  const path = url.pathname;
  const db = env.DB;

  if (path === "/api/auth/request" && request.method === "POST") {
    if (!db || !env.SESSION_SECRET) return json({ error: "not_configured" }, 503);
    let body = {};
    try { body = await request.json(); } catch (e) {}
    const email = normalizeEmail(body.email);
    if (!validEmail(email)) return json({ error: "email" }, 400);

    const now = Date.now();
    const recent = await db.prepare(
      "SELECT created_at FROM magic_links WHERE email=?1 ORDER BY created_at DESC LIMIT 1"
    ).bind(email).first();
    if (recent && now - recent.created_at < 60000) return json({ error: "rate" }, 429);

    const token = randomToken();
    await db.prepare(
      "INSERT INTO magic_links (token_hash,email,created_at,expires_at) VALUES (?1,?2,?3,?4)"
    ).bind(await sha256hex(token), email, now, now + LINK_MINUTES * 60000).run();
    await db.prepare("DELETE FROM magic_links WHERE expires_at < ?1").bind(now).run();

    const link = url.origin + "/api/auth/verify?token=" + encodeURIComponent(token);
    const sent = await sendMagicEmail(env, email, link);
    /* Only echo the link back when explicitly enabled for first-run testing. */
    if (!sent && env.ALLOW_DEV_LINK === "1") return json({ ok: true, devLink: link });
    if (!sent) return json({ error: "mail" }, 502);
    return json({ ok: true });
  }

  if (path === "/api/auth/verify") {
    if (!db || !env.SESSION_SECRET) return json({ error: "not_configured" }, 503);
    const token = url.searchParams.get("token") || "";
    const row = token ? await db.prepare(
      "SELECT token_hash,email,expires_at,used_at FROM magic_links WHERE token_hash=?1"
    ).bind(await sha256hex(token)).first() : null;
    const now = Date.now();
    if (!row || row.used_at || row.expires_at < now) {
      return Response.redirect(url.origin + "/?expired=1", 302);
    }
    await db.prepare("UPDATE magic_links SET used_at=?1 WHERE token_hash=?2").bind(now, row.token_hash).run();

    let user = await db.prepare("SELECT id FROM users WHERE email=?1").bind(row.email).first();
    if (!user) {
      const id = crypto.randomUUID();
      await db.prepare("INSERT INTO users (id,email,created_at,last_seen) VALUES (?1,?2,?3,?3)")
        .bind(id, row.email, now).run();
      user = { id };
    } else {
      await db.prepare("UPDATE users SET last_seen=?1 WHERE id=?2").bind(now, user.id).run();
    }
    return new Response(null, {
      status: 302,
      headers: {
        "Location": url.origin + "/?signedin=1",
        "Set-Cookie": sessionCookie(await makeSession(env, user.id), SESSION_DAYS * 86400)
      }
    });
  }

  if (path === "/api/auth/logout") {
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
  }

  if (path === "/api/me") {
    const uid = await readSession(env, request);
    if (!uid || !db) return json({ error: "signed_out" }, 401);
    const u = await db.prepare("SELECT id,email FROM users WHERE id=?1").bind(uid).first();
    if (!u) return json({ error: "signed_out" }, 401, { "Set-Cookie": sessionCookie("", 0) });
    return json({ uid: u.id, email: u.email });
  }

  if (path === "/api/state") {
    const uid = await readSession(env, request);
    if (!uid || !db) return json({ error: "signed_out" }, 401);

    if (request.method === "GET") {
      const row = await db.prepare("SELECT json,updated_at FROM state WHERE user_id=?1").bind(uid).first();
      if (!row) return json({ state: null, updatedAt: 0 });
      let parsed = null;
      try { parsed = JSON.parse(row.json); } catch (e) {}
      return json({ state: parsed, updatedAt: row.updated_at });
    }

    if (request.method === "PUT") {
      let body = {};
      try { body = await request.json(); } catch (e) { return json({ error: "bad_body" }, 400); }
      if (!body.state || typeof body.state !== "object") return json({ error: "bad_state" }, 400);
      const text = JSON.stringify(body.state);
      if (text.length > 4_000_000) return json({ error: "too_large" }, 413);
      const at = Number(body.updatedAt) || Date.now();
      await db.prepare(
        "INSERT INTO state (user_id,json,updated_at) VALUES (?1,?2,?3) " +
        "ON CONFLICT(user_id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at"
      ).bind(uid, text, at).run();
      return json({ ok: true, updatedAt: at });
    }
    return json({ error: "method" }, 405);
  }
  return null;
}
async function apiRoute(url, env) {
  const path = url.pathname;
  const hasFS = !!(env.FS_KEY && env.FS_SECRET);

  if (path === "/api/health") return json({
    ok: true, fs: hasFS,
    accounts: !!(env.DB && env.SESSION_SECRET),
    email: !!env.RESEND_KEY
  });

  if (path === "/api/search") {
    const q = (url.searchParams.get("q") || "").trim();
    const max = Math.min(parseInt(url.searchParams.get("max") || "15", 10) || 15, 25);
    if (!q) return json({ items: [] });
    let items = [];
    if (hasFS) {
      try {
        const d = await fsCall(env, { method: "foods.search", search_expression: q, max_results: String(max), page_number: "0" });
        let foods = d.foods && d.foods.food;
        if (foods) { if (!Array.isArray(foods)) foods = [foods]; items = foods.map(fsSearchItem); }
      } catch (e) { /* fall through to OFF */ }
    }
    if (!items.length) {
      try { items = await offSearch(q, max); } catch (e) { /* both failed */ }
    }
    return json({ items });
  }

  if (path === "/api/barcode") {
    let code = (url.searchParams.get("code") || "").replace(/\D/g, "");
    if (!code) return json({ error: "missing code" }, 400);
    let items = [];
    try { items = await offBarcode(code); } catch (e) {}
    if (!items.length && hasFS) {
      try {
        let c13 = code; while (c13.length < 13) c13 = "0" + c13;
        const bc = await fsCall(env, { method: "food.find_id_for_barcode", barcode: c13 });
        const fid = bc.food_id && (bc.food_id.value || bc.food_id);
        if (fid && fid !== "0") {
          const d = await fsCall(env, { method: "food.get.v2", food_id: String(fid) });
          const it = d.food ? fsGetItem(d.food) : null;
          if (it) items = [it];
        }
      } catch (e) {}
    }
    return json({ items });
  }

  if (path === "/api/food") {
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "missing id" }, 400);
    if (!hasFS) return json({ items: [] });
    try {
      const d = await fsCall(env, { method: "food.get.v2", food_id: id });
      const it = d.food ? fsGetItem(d.food) : null;
      return json({ items: it ? [it] : [] });
    } catch (e) { return json({ items: [] }); }
  }

  return json({ error: "not found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: {
          "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
      }
      try {
        /* accounts + per-user data are same-origin only (cookies, no CORS) */
        const authed = await authRoute(url, request, env);
        if (authed) return authed;
        /* food lookups stay open */
        const r = await apiRoute(url, env);
        r.headers.set("Access-Control-Allow-Origin", "*");
        return r;
      }
      catch (e) { return json({ error: String(e && e.message || e) }, 500); }
    }
    return env.ASSETS.fetch(request);
  }
};
