#!/bin/bash
set -e
echo "🚀 Deploying Fuel Protocol to Cloudflare..."
npx wrangler deploy
echo ""
echo "✅ Deployed!"
echo "📊 Visit <your-worker-url>/api/health to verify all systems are green"
