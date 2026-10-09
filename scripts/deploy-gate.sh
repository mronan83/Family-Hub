#!/usr/bin/env bash
# Production deploy gate (01 §9.6, D-36). GitHub Free enforces no branch protection on a private
# repository, so this decides whether a commit may ship: only the head of main, from a merged pull
# request, with every CI check green and e2e green on that pull request's preview. Exits non-zero to
# refuse, writes deploy=false to skip quietly, deploy=true to ship. Tested by deploy-gate.test.mjs.
#
# Reads: SHA, CI_CONCLUSION (a ci run's conclusion, or "manual"), REPO, GITHUB_EVENT_NAME,
# GITHUB_REF, GITHUB_OUTPUT, HAS_SUPABASE_DB_URL, VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID,
# PRODUCTION_URL. Calls `gh api` (GH_TOKEN) and the Vercel API.
set -euo pipefail

echo "sha=$SHA" >> "$GITHUB_OUTPUT"
fail() { echo "::error::Not deploying ${SHA:0:7}: $*"; exit 1; }
skip() { echo "::notice::Not deploying ${SHA:0:7}: $*"; echo "deploy=false" >> "$GITHUB_OUTPUT"; exit 0; }

missing=()
[ "${HAS_SUPABASE_DB_URL:-}" = true ] || missing+=(SUPABASE_DB_URL)
[ -n "${VERCEL_TOKEN:-}" ] || missing+=(VERCEL_TOKEN)
[ -n "${VERCEL_ORG_ID:-}" ] || missing+=(VERCEL_ORG_ID)
[ -n "${VERCEL_PROJECT_ID:-}" ] || missing+=(VERCEL_PROJECT_ID)
[ -n "${PRODUCTION_URL:-}" ] || missing+=(PRODUCTION_URL)
[ ${#missing[@]} -eq 0 ] || fail "missing configuration: ${missing[*]} (docs/01-technical-architecture.md §9.8)"

# The token must reach the project before anything touches the database.
status=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v9/projects/$VERCEL_PROJECT_ID?teamId=$VERCEL_ORG_ID" || true)
[ "$status" = 200 ] || fail "VERCEL_TOKEN cannot open the Vercel project (HTTP $status): create the token with its scope set to the project's team"

[ "$GITHUB_EVENT_NAME" != workflow_dispatch ] || [ "$GITHUB_REF" = refs/heads/main ] \
  || fail "manual deploys run from main only"

# A newer commit on main deploys in its own run; production never moves backwards.
head=$(gh api "repos/$REPO/commits/main" --jq .sha)
[ "$head" = "$SHA" ] || skip "main has moved on to ${head:0:7}"
[ "$CI_CONCLUSION" != cancelled ] || skip "its ci run was cancelled"
[ "$CI_CONCLUSION" = success ] || [ "$CI_CONCLUSION" = manual ] || fail "ci finished '$CI_CONCLUSION'"

# Every CI gate passed on this commit.
for check in checks database docs build; do
  c=$(gh api "repos/$REPO/commits/$SHA/check-runs?check_name=$check" --jq '.check_runs[0].conclusion // "missing"')
  [ "$c" = success ] || fail "ci / $check is '$c'"
done

# It came from a merged pull request whose preview passed e2e.
pr=$(gh api "repos/$REPO/commits/$SHA/pulls" \
  --jq '[.[] | select(.merged_at != null and .base.ref == "main")][0] | "\(.number) \(.head.sha)"')
read -r number head_sha <<< "$pr"
[ "$number" != null ] || fail "it reached main without a merged pull request"
e2e=$(gh api "repos/$REPO/commits/$head_sha/check-runs?check_name=preview" --jq '.check_runs[0].conclusion // "missing"')
[ "$e2e" = success ] || fail "e2e / preview on PR #$number is '$e2e'"

echo "deploy=true" >> "$GITHUB_OUTPUT"
echo "Deploying ${SHA:0:7} from PR #$number"
