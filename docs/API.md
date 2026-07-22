# API

Base URL: `https://fuel-protocol.ezingalis.workers.dev`

Two classes of endpoint:

- **Account routes** — same-origin only, authenticated by the `fp_session`
  cookie. No CORS.
- **Food routes** — open, `Access-Control-Allow-Origin: *`.

Errors are always `{ "error": "<code>" }` with an appropriate HTTP status.

## Health

### `GET /api/health`
```json
{ "ok": true, "fs": true, "accounts": true, "email": true }
```
- `fs` — FatSecret keys present
- `accounts` — D1 bound **and** `SESSION_SECRET` set
- `email` — `RESEND_KEY` set

## Auth

### `POST /api/auth/request`
Body: `{ "email": "you@example.com" }` — creates the account if new.

| Response | Meaning |
|---|---|
| `{ "ok": true }` | Link emailed |
| `{ "ok": true, "devLink": "..." }` | Email failed/unset and `ALLOW_DEV_LINK=1` |
| `400 { "error": "email" }` | Invalid address |
| `429 { "error": "rate" }` | One link per email per 60 s, or the per-IP daily cap (default 15) |
| `502 { "error": "mail" }` | Send failed, no dev fallback |
| `503 { "error": "not_configured" }` | Missing D1 or `SESSION_SECRET` |

### `GET /api/auth/verify?token=...`
Single-use, 15-minute expiry. Redirects `302` to `/?signedin=1` with the
session cookie, or to `/?expired=1` for any invalid/used/expired token.

### `GET /api/auth/logout`
`{ "ok": true }` and clears the cookie (`Max-Age=0`).

## Account

### `GET /api/me`
`{ "uid": "...", "email": "..." }` — or `401 { "error": "signed_out" }`.

### `GET /api/state`
`{ "state": { ...diary blob... } | null, "updatedAt": 1753000000000 }`

### `PUT /api/state`
Body: `{ "state": { ... }, "updatedAt": 1753000000000 }`

| Response | Meaning |
|---|---|
| `{ "ok": true, "updatedAt": ... }` | Stored (upsert) |
| `400 bad_body / bad_state` | Malformed JSON / state not an object |
| `413 too_large` | Blob over 4 MB |
| `401 signed_out` | No/invalid session |

## Food (open, CORS `*`)

### `GET /api/search?q=banza&max=15`
`{ "items": [ ...normalized items... ] }` — FatSecret first, Open Food Facts
fallback. Empty `q` returns `{ "items": [] }`. `max` caps at 25.

### `GET /api/barcode?code=0123456789012`
`{ "items": [item] | [] }` — OFF first, FatSecret fallback. Non-digits are
stripped; missing code is `400`.

### `GET /api/food?id=<fatsecret-id>`
`{ "items": [item] | [] }` — FatSecret `food.get.v2`. Missing id is `400`;
no FatSecret keys returns `{ "items": [] }`.

### Item shape (all food sources)
```json
{ "name": "Chickpea Pasta", "brand": "Banza",
  "unit": "g", "step": 25, "base": 100,
  "cal": 190, "p": 11.5, "c": 32.5, "f": 3.0,
  "src": "fatsecret", "fsid": "12345" }
```
`unit:"g"` items are per `base` grams; `unit:"serving"` items are per serving.
