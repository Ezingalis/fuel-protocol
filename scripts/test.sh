#!/bin/bash
set -e
shopt -s nullglob
tests=(tests/*.test.mjs)
if [ ${#tests[@]} -eq 0 ]; then
  echo "No tests yet — test files go in tests/*.test.mjs"
  exit 0
fi
echo "🧪 Running test suite..."
node --test "${tests[@]}"
