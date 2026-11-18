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

/* called after each state save: keep one row per person for their open workout, or none.
   Settings can turn the left-open reminder off (profile.rem.open === false). */
export async function syncDue(db, uid, state) {
  const rem = state && state.profile && state.profile.rem;
  const w = rem && rem.open === false ? null : openWorkout(state);
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

/* what the notification says: the service worker fetches this when the push arrives.
   Every send writes the message first (push_msg), so the newest one is what shows. */
export async function pending(db, uid) {
  const m = await db.prepare("SELECT title,body,url,at FROM push_msg WHERE uid=?1").bind(uid).first();
  if (m && Date.now() - m.at < 30 * 60000) return { title: m.title, body: m.body, url: m.url };
  return {};
}
async function setMsg(db, uid, title, body, url) {
  await db.prepare("INSERT INTO push_msg (uid,title,body,url,at) VALUES (?1,?2,?3,?4,?5) " +
    "ON CONFLICT(uid) DO UPDATE SET title=excluded.title, body=excluded.body, url=excluded.url, at=excluded.at")
    .bind(uid, title, body, url, Date.now()).run();
}
function minText(min) { return min < 90 ? min + " min" : Math.floor(min / 60) + " h " + (min % 60) + " min"; }

/* ---------- food and weigh-in reminders ----------
   Settings keeps profile.rem: { open, w: {on, t:"07:30", d:[0..6]}, bf|lu|di|sn: {on, t} } and
   profile.tz (the phone's time zone). Each save copies that plan into push_plan. The cron checks
   whose times have come up in their own time zone, skips any that are already logged that day
   (a weigh-in, or anything in that meal), and sends the rest once a day each. */
export const MEAL_NAMES = { bf: "breakfast", lu: "lunch", di: "dinner", sn: "snacks" };
const LATE_BY = 90; // minutes: a missed cron run still sends, a phone that synced hours late doesn't
function hhmm(t) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || "")); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; }
export function planItems(rem) {
  const out = [];
  if (!rem || typeof rem !== "object") return out;
  if (rem.w && rem.w.on && hhmm(rem.w.t) != null)
    out.push({ kind: "w", at: hhmm(rem.w.t), days: Array.isArray(rem.w.d) && rem.w.d.length ? rem.w.d.map(Number) : [0, 1, 2, 3, 4, 5, 6] });
  for (const m of Object.keys(MEAL_NAMES)) if (rem[m] && rem[m].on && hhmm(rem[m].t) != null)
    out.push({ kind: m, at: hhmm(rem[m].t), days: [0, 1, 2, 3, 4, 5, 6] });
  return out;
}
export function localNow(now, tz) {
  const parts = tzone => {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tzone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
    const p = {}; for (const x of f.formatToParts(new Date(now))) p[x.type] = x.value;
    return { date: p.year + "-" + p.month + "-" + p.day, min: (+p.hour % 24) * 60 + +p.minute,
      dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
  };
  try { return parts(tz || "America/New_York"); } catch (e) { return parts("America/New_York"); }
}
/* already done today? then there's nothing to remind about */
export function alreadyLogged(state, date, kind) {
  const d = state && state.log && state.log[date];
  if (!d) return false;
  if (kind === "w") return Array.isArray(d.weights) && d.weights.length > 0;
  return !!(d.meals && Array.isArray(d.meals[kind]) && d.meals[kind].length);
}
export async function syncPlan(db, uid, state) {
  const p = state && state.profile, items = planItems(p && p.rem);
  if (!items.length) { await db.prepare("DELETE FROM push_plan WHERE uid=?1").bind(uid).run(); return; }
  await db.prepare("INSERT INTO push_plan (uid,tz,plan,sent) VALUES (?1,?2,?3,'{}') " +
    "ON CONFLICT(uid) DO UPDATE SET tz=excluded.tz, plan=excluded.plan")
    .bind(uid, String(p.tz || "").slice(0, 60), JSON.stringify(p.rem)).run();
}
export function dueItems(row, now) {
  const L = localNow(now, row.tz), sent = JSON.parse(row.sent || "{}");
  return { local: L, sent, items: planItems(JSON.parse(row.plan || "{}")).filter(it =>
    sent[it.kind] !== L.date && it.days.includes(L.dow) && L.min >= it.at && L.min < it.at + LATE_BY) };
}
async function sendToAll(env, uid, title, body, url) {
  const db = env.DB;
  await setMsg(db, uid, title, body, url);
  const subs = (await db.prepare("SELECT endpoint FROM push_subs WHERE uid=?1").bind(uid).all()).results || [];
  let sent = 0;
  for (const s of subs) {
    try {
      const st = await sendPush(env, s.endpoint);
      if (st === 404 || st === 410) await db.prepare("DELETE FROM push_subs WHERE endpoint=?1").bind(s.endpoint).run();
      else if (st < 300) sent++;
    } catch (e) { /* one bad device doesn't stop the rest */ }
  }
  return sent;
}
async function runScheduled(env, now) {
  const db = env.DB, rows = (await db.prepare("SELECT uid,tz,plan,sent FROM push_plan").all()).results || [];
  let sent = 0;
  for (const row of rows) {
    const { local, sent: was, items } = dueItems(row, now);
    if (!items.length) continue;
    const st = await db.prepare("SELECT json FROM state WHERE user_id=?1").bind(row.uid).first();
    let state = null; try { state = JSON.parse(st && st.json); } catch (e) {}
    for (const it of items) {
      was[it.kind] = local.date;
      if (alreadyLogged(state, local.date, it.kind)) continue;
      sent += it.kind === "w"
        ? await sendToAll(env, row.uid, "Time to weigh in", "Step on the scale before you eat or drink. Tap to log it.", "/?open=weigh")
        : await sendToAll(env, row.uid, "Log " + MEAL_NAMES[it.kind], "Nothing in " + MEAL_NAMES[it.kind] + " yet today. Tap to add it.", "/?open=meal:" + it.kind);
    }
    await db.prepare("UPDATE push_plan SET sent=?2 WHERE uid=?1").bind(row.uid, JSON.stringify(was)).run();
  }
  return sent;
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
  const rows = (await db.prepare("SELECT uid,k,due,name,t0 FROM push_due WHERE sent=0 AND due<=?1 LIMIT 50").bind(now).all()).results || [];
  let sent = 0;
  for (const row of rows) {
    await db.prepare("UPDATE push_due SET sent=1 WHERE uid=?1 AND k=?2").bind(row.uid, row.k).run();
    if (now - row.due > GIVE_UP) continue;
    sent += await sendToAll(env, row.uid, "Still working out?",
      row.name + " has been open " + minText(Math.max(1, Math.round((now - row.t0) / 60000))) +
      " and nothing was logged for 10 minutes. Tap to finish it.", "/?open=workout");
  }
  sent += await runScheduled(env, now);
  return { sent };
}
