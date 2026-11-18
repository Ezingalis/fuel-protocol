/* Workout reminders over Web Push.

   The rule: a workout has been open for an hour or more, and nothing was entered in it for
   10 minutes. That's when you've most likely finished and forgotten to tap Finish (or are
   still resting, in which case the reminder is easy to ignore). So the reminder is due at
     max(start + 60 min, last entry + 10 min)
   and it goes out once. Entering anything after it went out sets a new due time, so you can
   get one more if you go quiet again.

   The due time is worked out on the server each time the app syncs its state (the app
   already sends every change), so the phone doesn't need to be open or awake: a cron run
   every 2 minutes sends whatever is due. The push carries no payload, which means no message
   encryption; the service worker asks /api/push/pending what to say.

   Signing uses VAPID (RFC 8292) with a P-256 key kept in the VAPID_JWK secret, made by
   scripts/vapid-key.mjs and piped straight into `wrangler secret put`, so no one sees it. */

export const REMIND_AFTER = 60 * 60000;
export const IDLE_FOR = 10 * 60000;
const GIVE_UP = 6 * 36e5; // a due time this far gone (say, a phone that synced late) isn't worth a buzz
const MAX_SUBS = 8;       // devices per person

/* only real push services; a subscription can't make the worker call anywhere else */
const PUSH_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(push\.apple\.com|fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)\//;
export function okEndpoint(env, u) {
  if (typeof u !== "string" || u.length > 1000) return false;
  if (PUSH_HOSTS.test(u)) return true;
  return env.PUSH_ALLOW_LOCAL === "1" && /^http:\/\/(localhost|127\.0\.0\.1):\d+\//.test(u);
}

/* the newest open workout in a synced state, and when its reminder is due */
export function openWorkout(state) {
  const logs = state && state.gym && state.gym.logs;
  if (!logs || typeof logs !== "object") return null;
  let best = null;
  for (const k of Object.keys(logs)) {
    const L = logs[k];
    if (!L || L.t1 || L.cardio || L.off || !(Number(L.t0) > 0)) continue;
    if (!best || L.t0 > best.t0) best = { k: k.slice(0, 40), name: String(L.name || "Your workout").slice(0, 80), t0: Number(L.t0), ta: Number(L.ta) || 0 };
  }
  if (best) best.due = Math.max(best.t0 + REMIND_AFTER, (best.ta || best.t0) + IDLE_FOR);
  return best;
}

/* called after each state save: keep one row per person for their open workout, or none */
export async function syncDue(db, uid, state) {
  const w = openWorkout(state);
  if (!w) { await db.prepare("DELETE FROM push_due WHERE uid=?1").bind(uid).run(); return null; }
  await db.batch([
    db.prepare("DELETE FROM push_due WHERE uid=?1 AND k<>?2").bind(uid, w.k),
    // a new due time re-arms the reminder; the same one leaves it as sent
    db.prepare(
      "INSERT INTO push_due (uid,k,name,t0,due,sent) VALUES (?1,?2,?3,?4,?5,0) " +
      "ON CONFLICT(uid,k) DO UPDATE SET name=excluded.name, t0=excluded.t0, " +
      "sent=CASE WHEN push_due.due=excluded.due THEN push_due.sent ELSE 0 END, due=excluded.due"
    ).bind(uid, w.k, w.name, w.t0, w.due)
  ]);
  return w;
}

export async function saveSub(db, uid, endpoint) {
  await db.prepare("INSERT INTO push_subs (endpoint,uid,created) VALUES (?1,?2,?3) " +
    "ON CONFLICT(endpoint) DO UPDATE SET uid=excluded.uid, created=excluded.created").bind(endpoint, uid, Date.now()).run();
  await db.prepare("DELETE FROM push_subs WHERE uid=?1 AND endpoint NOT IN " +
    "(SELECT endpoint FROM push_subs WHERE uid=?1 ORDER BY created DESC LIMIT ?2)").bind(uid, MAX_SUBS).run();
}

/* what the notification says: the service worker fetches this when the push arrives */
export async function pending(db, uid) {
  const r = await db.prepare("SELECT name,t0 FROM push_due WHERE uid=?1 ORDER BY due DESC LIMIT 1").bind(uid).first();
  if (!r) return {};
  return { name: r.name, min: Math.max(1, Math.round((Date.now() - r.t0) / 60000)) };
}

/* ---------- VAPID ---------- */
const te = new TextEncoder();
function b64u(bytes) {
  let s = "";
  new Uint8Array(bytes).forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64u(s) {
  return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
}
function vapidKey(env) {
  try { const j = JSON.parse(env.VAPID_JWK || ""); return j && j.x && j.y && j.d ? j : null; } catch (e) { return null; }
}
/* the public half, as browsers want it for pushManager.subscribe: 0x04 || x || y */
export function vapidPublic(env) {
  const j = vapidKey(env);
  if (!j) return null;
  const x = unb64u(j.x), y = unb64u(j.y), out = new Uint8Array(65);
  out[0] = 4; out.set(x, 1); out.set(y, 33);
  return b64u(out);
}
export async function vapidAuth(env, endpoint, now) {
  const j = vapidKey(env);
  const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: j.x, y: j.y, d: j.d, ext: true },
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64u(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(te.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor((now || Date.now()) / 1000) + 12 * 3600,
    sub: env.VAPID_SUB || "https://fuel.ethanzingalis.com"
  })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(head + "." + claims));
  return "vapid t=" + head + "." + claims + "." + b64u(sig) + ", k=" + vapidPublic(env);
}
async function sendPush(env, endpoint) {
  const res = await fetch(endpoint, { method: "POST", headers: {
    Authorization: await vapidAuth(env, endpoint), TTL: "1800", Urgency: "high", "Content-Length": "0"
  } });
  return res.status;
}

/* the cron: send what's due, once each; forget devices the push service says are gone */
export async function runReminders(env) {
  const db = env.DB;
  if (!db || !vapidKey(env)) return { sent: 0 };
  const now = Date.now();
  const rows = (await db.prepare("SELECT uid,k,due FROM push_due WHERE sent=0 AND due<=?1 LIMIT 50").bind(now).all()).results || [];
  let sent = 0;
  for (const row of rows) {
    await db.prepare("UPDATE push_due SET sent=1 WHERE uid=?1 AND k=?2").bind(row.uid, row.k).run();
    if (now - row.due > GIVE_UP) continue;
    const subs = (await db.prepare("SELECT endpoint FROM push_subs WHERE uid=?1").bind(row.uid).all()).results || [];
    for (const s of subs) {
      try {
        const st = await sendPush(env, s.endpoint);
        if (st === 404 || st === 410) await db.prepare("DELETE FROM push_subs WHERE endpoint=?1").bind(s.endpoint).run();
        else if (st < 300) sent++;
      } catch (e) { /* one bad device doesn't stop the rest */ }
    }
  }
  return { sent };
}
