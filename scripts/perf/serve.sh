#!/usr/bin/env bash
# Builds and starts a local production server on :3100 that logs Supabase calls.
set -e
S="$1"; W=$(cygpath -w "$S")
npm run build > "$S/build.log" 2>&1 || { tail -30 "$S/build.log"; exit 1; }
: > "$S/sb.log"
PERF_LOG="$W\sb.log" NODE_OPTIONS="--import ./scripts/perf/log-fetch.mjs" nohup npx next start -p 3100 > "$S/start.log" 2>&1 &
for i in $(seq 1 80); do curl -s -o /dev/null http://localhost:3100/ && break; done
echo up
