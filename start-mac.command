#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or later is required: https://nodejs.org/"
  exit 1
fi
[ -d node_modules ] || npm install
(sleep 2; open http://localhost:4173 2>/dev/null || true) &
npm run dev -- --host 127.0.0.1 --port 4173
