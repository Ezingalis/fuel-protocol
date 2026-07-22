#!/bin/bash
set -e
echo "🚀 Setting up Fuel Protocol..."

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js is required. Install it first (https://nodejs.org or via nvm)."
  exit 1
fi

npm install
npx wrangler whoami >/dev/null 2>&1 || npx wrangler login
echo "✓ Authenticated with Cloudflare"
echo ""
echo "📋 Next steps (full details in SETUP.md):"
echo "  1. Create the D1 database:  npx wrangler d1 create fuel-protocol-db"
echo "  2. Paste the database_id into wrangler.jsonc"
echo "  3. Create the tables:       npm run db:schema"
echo "  4. Set secrets:             SETUP.md section 4"
echo "  5. Deploy:                  npm run deploy"
