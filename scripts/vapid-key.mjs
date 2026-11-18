/* Makes the private key that signs workout reminders and prints it as one line of JSON.
   Pipe it straight into Cloudflare so it's never shown or saved anywhere:
     node scripts/vapid-key.mjs | npx wrangler secret put VAPID_JWK
   The public half is worked out from it by the worker (GET /api/push/key).
   Running it again makes a new key; every phone then has to turn reminders on again. */
const { subtle } = globalThis.crypto;
const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = await subtle.exportKey("jwk", pair.privateKey);
process.stdout.write(JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }));
