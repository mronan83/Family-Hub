#!/usr/bin/env bash
# Creates the web push (VAPID) key pair for reminders (WP-40, 01 §9.8, D-58), run by the vapid-keys
# workflow. The pair is generated here and written straight to Vercel, never printed: nobody sees or
# pastes the private key. The public key goes to Production and Preview (browsers subscribe with it);
# the private key and the contact go to Production only (previews never send).
#
# It refuses to replace keys that exist: every device subscribed with the old public key would stop
# getting reminders. To rotate on purpose, delete the three variables in Vercel first and run this
# again; then everyone turns reminders on again on each device.
#
# Then production is redeployed, since the public key is built into the app (NEXT_PUBLIC_).
#
# Needs VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID, PRODUCTION_URL, GH_TOKEN (actions: write),
# node, jq, curl and gh.
set -euo pipefail

fail() { echo "::error::$*"; exit 1; }
for v in VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_ID PRODUCTION_URL GH_TOKEN; do
  [ -n "${!v:-}" ] || fail "missing $v (docs/01-technical-architecture.md §9.8)"
done
case "$PRODUCTION_URL" in https://*) ;; *) fail "PRODUCTION_URL must be https (it is the VAPID contact)" ;; esac
umask 077
api="https://api.vercel.com"
auth=(-H "Authorization: Bearer $VERCEL_TOKEN")

echo "1/4 Vercel: no VAPID keys yet"
existing="$RUNNER_TEMP/vercel-env-list.json"
status=$(curl -sS -o "$existing" -w '%{http_code}' "${auth[@]}" \
  "$api/v9/projects/$VERCEL_PROJECT_ID/env?teamId=$VERCEL_ORG_ID")
[ "$status" = 200 ] || { rm -f "$existing"; fail "could not list Vercel variables (HTTP $status)"; }
found=$(jq -r '[.envs[]?.key | select(. == "VAPID_PRIVATE_KEY" or . == "NEXT_PUBLIC_VAPID_PUBLIC_KEY")] | join(", ")' "$existing")
rm -f "$existing"
[ -z "$found" ] || fail "already set in Vercel: $found. Replacing them stops reminders on every device; to rotate on purpose, delete them in Vercel and run this again"

echo "2/4 Generate the key pair (P-256) on this runner"
keys="$RUNNER_TEMP/vapid.json"
node -e '
  const { createECDH } = require("node:crypto");
  const e = createECDH("prime256v1");
  e.generateKeys();
  const k = e.getPrivateKey();
  const priv = Buffer.concat([Buffer.alloc(32 - k.length), k]);
  require("node:fs").writeFileSync(process.argv[1], JSON.stringify({
    publicKey: e.getPublicKey().toString("base64url"),
    privateKey: priv.toString("base64url"),
  }), { mode: 0o600 });
' "$keys"
echo "::add-mask::$(jq -r .privateKey "$keys")"

echo "3/4 Vercel: NEXT_PUBLIC_VAPID_PUBLIC_KEY (Production, Preview), VAPID_PRIVATE_KEY (Production, sensitive), VAPID_SUBJECT (Production)"
response="$RUNNER_TEMP/vercel-env.json"
status=$(jq --arg subject "$PRODUCTION_URL" '[
    {key: "NEXT_PUBLIC_VAPID_PUBLIC_KEY", value: .publicKey, type: "plain", target: ["production", "preview"],
     comment: "Web push public key (01 §9.8); set by the vapid-keys workflow"},
    {key: "VAPID_PRIVATE_KEY", value: .privateKey, type: "sensitive", target: ["production"],
     comment: "Web push private key (01 §9.8); set by the vapid-keys workflow"},
    {key: "VAPID_SUBJECT", value: $subject, type: "plain", target: ["production"],
     comment: "Web push contact (01 §9.8); set by the vapid-keys workflow"}
  ]' "$keys" \
  | curl -sS -o "$response" -w '%{http_code}' -X POST "${auth[@]}" -H 'Content-Type: application/json' \
      --data @- "$api/v10/projects/$VERCEL_PROJECT_ID/env?teamId=$VERCEL_ORG_ID")
rm -f "$keys"
problem=$(jq -r '(.error.message // empty), (.failed // [] | .[] | .error.message // .error.code // "failed")' "$response" 2>/dev/null || true)
rm -f "$response"
{ [ "$status" = 200 ] || [ "$status" = 201 ]; } && [ -z "$problem" ] \
  || fail "Vercel did not store the keys (HTTP $status): ${problem:-no detail}"

echo "4/4 Deploy production so the app holds them"
since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
gh workflow run deploy.yml --ref main
run=""
for _ in $(seq 1 30); do
  run=$(gh run list --workflow deploy.yml --event workflow_dispatch --limit 5 --json databaseId,createdAt \
    --jq "[.[] | select(.createdAt >= \"$since\")][0].databaseId // empty")
  [ -n "$run" ] && break
  sleep 5
done
[ -n "$run" ] || fail "the production deploy did not start; the keys are in Vercel, so the next deploy picks them up"
gh run watch "$run" --exit-status --interval 15 >/dev/null \
  || fail "the production deploy (run $run) failed; the keys are in Vercel, so the next deploy picks them up"
echo "Web push keys in place. On each phone or computer: Reminders → Turn on reminders."
