#!/usr/bin/env bash
# [NFR-08] Reads the Vercel account's usage over the last 30 days from its billing API (FOCUS
# records) and keeps the services that have Hobby limits in private.usage_sample, for System Health
# (WP-42, US-909). The limits apply to the whole account, so the account's total and FamilyWise's
# share (records tagged with this project) are both kept. Run daily by the usage workflow; the app
# itself never holds the token. Readings older than 90 days are removed.
# Needs SUPABASE_DB_URL, VERCEL_ORG_ID, VERCEL_PROJECT_ID, and VERCEL_TOKEN (or USAGE_JSONL_FILE, a
# saved response, for tests); python3 and psql 15+.
set -euo pipefail

: "${SUPABASE_DB_URL:?}" "${VERCEL_ORG_ID:?}" "${VERCEL_PROJECT_ID:?}"
from=$(date -u -d '30 days ago' +%Y-%m-%dT00:00:00.000Z)
to=$(date -u -d 'tomorrow' +%Y-%m-%dT00:00:00.000Z)

records=$(mktemp)
trap 'rm -f "$records"' EXIT
if [ -n "${USAGE_JSONL_FILE:-}" ]; then
  cp "$USAGE_JSONL_FILE" "$records"
else
  : "${VERCEL_TOKEN:?}"
  curl -fsS --retry 2 -H "Authorization: Bearer $VERCEL_TOKEN" \
    "https://api.vercel.com/v1/billing/charges?teamId=$VERCEL_ORG_ID&from=$from&to=$to" -o "$records"
fi

# One line per service: service, unit, account total, this project's share (tab-separated).
rows=$(python3 -I - "$records" "$VERCEL_PROJECT_ID" <<'PY'
import json, sys
SERVICES = {'Function Invocations', 'Fluid Active CPU', 'Fluid Provisioned Memory',
            'Fast Data Transfer', 'Fast Origin Transfer', 'CDN Requests'}
path, project = sys.argv[1], sys.argv[2]
totals = {}
with open(path) as f:
    for line in f:
        line = line.strip()
        if not line.startswith('{'):
            continue
        r = json.loads(line)
        name = r.get('ServiceName')
        if name not in SERVICES:
            continue
        q = float(r.get('ConsumedQuantity') or 0)
        unit = (r.get('ConsumedUnit') or '').strip() or 'units'
        t = totals.setdefault(name, [unit, 0.0, 0.0])
        t[1] += q
        if (r.get('Tags') or {}).get('ProjectId') == project:
            t[2] += q
for name in sorted(totals):
    unit, account, mine = totals[name]
    print(f"{name}\t{unit}\t{account:.6f}\t{mine:.6f}")
PY
)
if [ -z "$rows" ]; then
  echo "no usage records for the tracked services" >&2
  exit 1
fi

values=$(while IFS=$'\t' read -r service unit account mine; do
  printf "('vercel', '%s', '%s', '%s', %s, %s)," "${from:0:10}" "${service//\'/\'\'}" "${unit//\'/\'\'}" "$account" "$mine"
done <<< "$rows")
psql "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 <<SQL
begin;
insert into private.usage_sample (source, period_start, service, unit, account_quantity, project_quantity)
values ${values%,};
delete from private.usage_sample where taken_at < now() - interval '90 days';
commit;
SQL

summary=${GITHUB_STEP_SUMMARY:-/dev/null}
{
  echo "## Vercel usage, last 30 days"
  echo
  echo "| Service | Unit | Account | FamilyWise |"
  echo "|---|---|---|---|"
  while IFS=$'\t' read -r service unit account mine; do echo "| $service | $unit | $account | $mine |"; done <<< "$rows"
} | tee -a "$summary"
