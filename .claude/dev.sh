#!/bin/bash
# Launch wrangler dev with the nvm-installed Node on PATH (used by .claude/launch.json)
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd "$(dirname "$0")/.."
exec npx wrangler dev --port 8787
