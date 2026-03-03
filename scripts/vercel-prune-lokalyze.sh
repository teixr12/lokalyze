#!/usr/bin/env bash

set -euo pipefail

VERCEL_TOKEN="${VERCEL_TOKEN:-}"
VERCEL_SCOPE="${VERCEL_SCOPE:-teixr12s-projects}"
VERCEL_PROJECT="${VERCEL_PROJECT:-lokalyze-maynfrme}"
KEEP_COUNT="${KEEP_COUNT:-2}"

if [ -z "$VERCEL_TOKEN" ]; then
  echo "[prune] ERROR: VERCEL_TOKEN is required."
  exit 1
fi

if ! [[ "$KEEP_COUNT" =~ ^[0-9]+$ ]] || [ "$KEEP_COUNT" -lt 1 ]; then
  echo "[prune] ERROR: KEEP_COUNT must be a positive integer."
  exit 1
fi

echo "[prune] Project: $VERCEL_SCOPE/$VERCEL_PROJECT"
echo "[prune] Keep count: $KEEP_COUNT"

mapfile -t DEPLOY_URLS < <(
  vercel ls "$VERCEL_PROJECT" \
    --scope "$VERCEL_SCOPE" \
    --environment production \
    --status READY \
    --token "$VERCEL_TOKEN" \
    | awk '/^https:\/\// {print $1}'
)

TOTAL="${#DEPLOY_URLS[@]}"
echo "[prune] Ready production deployments: $TOTAL"

if [ "$TOTAL" -le "$KEEP_COUNT" ]; then
  echo "[prune] Nothing to remove."
  exit 0
fi

echo "[prune] Keeping:"
for ((i=0; i<KEEP_COUNT; i++)); do
  echo "  - ${DEPLOY_URLS[$i]}"
done

echo "[prune] Removing:"
for ((i=KEEP_COUNT; i<TOTAL; i++)); do
  URL="${DEPLOY_URLS[$i]}"
  echo "  - $URL"
  vercel rm "$URL" --yes --scope "$VERCEL_SCOPE" --token "$VERCEL_TOKEN"
done

echo "[prune] Completed."
