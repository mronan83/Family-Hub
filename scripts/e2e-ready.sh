#!/usr/bin/env bash
# [NFR-14][D-104] Waits until the preview at E2E_BASE_URL answers /api/health with "ok" (and, when
# E2E_SHA is set, with that commit), so no test starts against a deployment that isn't serving yet.
# Up to E2E_READY_WAIT seconds (default 300). Reads VERCEL_AUTOMATION_BYPASS_SECRET.
set -euo pipefail

: "${E2E_BASE_URL:?E2E_BASE_URL is required}"
started=$(date +%s)
last=''
while :; do
  last=$(curl -sS --max-time 15 -H "x-vercel-protection-bypass: ${VERCEL_AUTOMATION_BYPASS_SECRET:-}" \
    -w ' HTTP %{http_code}' "$E2E_BASE_URL/api/health" 2>&1 || true)
  if [[ "$last" == *'"status":"ok"'* ]] && { [ -z "${E2E_SHA:-}" ] || [[ "$last" == *"$E2E_SHA"* ]] || [[ "$last" == *'"commit":"local"'* ]]; }; then
    echo "the preview is ready after $(($(date +%s) - started)) s"
    exit 0
  fi
  if [ $(($(date +%s) - started)) -ge "${E2E_READY_WAIT:-300}" ]; then
    echo "::error::the preview was not ready after ${E2E_READY_WAIT:-300} s; it last answered: ${last:0:200}"
    exit 1
  fi
  sleep 5
done
