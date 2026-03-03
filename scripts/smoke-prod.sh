#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${BASE_URL:-https://lokalyze-maynfrme.vercel.app}"
TMP_FILE="$(mktemp)"

cleanup() {
  rm -f "$TMP_FILE"
}
trap cleanup EXIT

echo "[smoke] Checking URL: $BASE_URL"
HTTP_CODE="$(curl -sS -L -o "$TMP_FILE" -w "%{http_code}" "$BASE_URL")"

if [ "$HTTP_CODE" != "200" ]; then
  echo "[smoke] FAIL: expected HTTP 200, got $HTTP_CODE"
  exit 1
fi

HTML="$(cat "$TMP_FILE")"

if echo "$HTML" | grep -qi "something went wrong"; then
  echo "[smoke] FAIL: detected fatal fallback content"
  exit 1
fi

if echo "$HTML" | grep -qi "welcome to lokalyze"; then
  echo "[smoke] PASS: auth gate rendered and site is healthy"
  exit 0
fi

HAS_ROOT=0
echo "$HTML" | grep -qi 'id="root"' && HAS_ROOT=1

HAS_MONITOR=0
HAS_ASSETS=0
HAS_HISTORY=0

echo "$HTML" | grep -qi "live monitor" && HAS_MONITOR=1
echo "$HTML" | grep -qi "asset manager" && HAS_ASSETS=1
echo "$HTML" | grep -qi "history" && HAS_HISTORY=1

if [ "$HAS_MONITOR" -eq 1 ] && [ "$HAS_ASSETS" -eq 1 ] && [ "$HAS_HISTORY" -eq 1 ]; then
  echo "[smoke] PASS: workspace shell markers detected"
  exit 0
fi

if [ "$HAS_ROOT" -eq 1 ]; then
  echo "[smoke] PASS: SPA root detected (runtime shell rendered client-side)"
  exit 0
fi

echo "[smoke] FAIL: could not confirm auth gate or workspace shell markers"
echo "[smoke] Marker status: root=$HAS_ROOT monitor=$HAS_MONITOR assets=$HAS_ASSETS history=$HAS_HISTORY"
exit 1
