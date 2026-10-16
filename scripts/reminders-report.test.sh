#!/usr/bin/env bash
# [CHR-20] Tests for scripts/reminders-report.sh on native Postgres (CI database job; no Docker), on
# the demo family with an approval alert sent: the report runs read only, has every section, numbers
# households and parents, and names no member and no item.
set -uo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
admin=(psql -X -q -v ON_ERROR_STOP=1 -d "${PGDATABASE_ADMIN:-postgres}")
work=$(mktemp -d)
db="reminders_report_test_$$"
failures=0
trap '"${admin[@]}" -c "drop database if exists $db with (force)" >/dev/null 2>&1; rm -rf "$work"' EXIT

url() { echo "postgresql://${PGUSER:-postgres}${PGPASSWORD:+:$PGPASSWORD}@${PGHOST:-localhost}:${PGPORT:-5432}/$db"; }
q() { psql "$(url)" -X -A -t -q -v ON_ERROR_STOP=1 -c "$1"; }
check() { if [ "$2" = ok ]; then echo "ok - $1"; else echo "not ok - $1 ($2)"; sed 's/^/#   /' "$work/log"; failures=$((failures + 1)); fi; }
is() { [ "$1" = "$2" ] && echo ok || echo "got '$1', expected '$2'"; }

"${admin[@]}" -c "create database $db" >/dev/null
"${admin[@]}" -c "alter database $db set search_path = \"\$user\", public, extensions" >/dev/null
for f in "$root"/supabase/tests/bootstrap/*.sql; do psql "$(url)" -X -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done
SUPABASE_DB_URL=$(url) bash "$root/scripts/db-migrate.sh" >/dev/null
psql "$(url)" -X -q -v ON_ERROR_STOP=1 -f "$root/supabase/seed.sql" >/dev/null

# The demo parents have reminders and Approvals on (from an hour ago) and a phone each; the job plans
# and claims an alert for the demo family's check-off waiting for a parent.
q "insert into public.reminder_preference (member_id, household_id, enabled)
   select m.id, m.household_id, true from public.member m
     join public.household_user hu on hu.household_id = m.household_id and hu.user_id = m.user_id;
   update public.reminder_preference set approvals_on_at = now() - interval '1 hour';
   update public.chore_occurrence set status_changed_at = now() - interval '5 minutes' where status = 'pending_approval';
   insert into public.push_subscription (household_id, member_id, user_id, endpoint, p256dh, auth_secret, device_label)
   select p.household_id, p.member_id, m.user_id, 'https://push.example/' || p.member_id, repeat('P', 87), repeat('a', 22), 'Phone'
     from public.reminder_preference p join public.member m on m.id = p.member_id;" >/dev/null
q "set role service_role; set request.jwt.claims = '{\"role\": \"service_role\"}';
   select public.plan_reminders(h.id), public.claim_reminders(h.id) from public.household h;" >/dev/null

SUPABASE_DB_URL="$(url)" bash "$root/scripts/reminders-report.sh" > "$work/log" 2>&1; rc=$?
check "[CHR-20] runs and exits cleanly" "$(is "$rc" 0)"
grep '^## ' "$work/log" > "$work/sections"
for section in 'Parents: settings and devices' 'Approval alerts since yesterday' 'Reminders job runs' \
               'why each was or was not in an alert' 'Check-offs waiting now' 'what the item asked' \
               'Approvals, rejections' 'Household approval switch' 'which alert, who approved and when'; do
  check "[CHR-20] has the section \"$section\"" "$(grep -qF "$section" "$work/sections" && echo ok || echo missing)"
done
check "[CHR-20] shows the alert sent to each demo parent, numbered" \
  "$(is "$(grep -cE '^\| H1\.P[0-9]+ +\| sent ' "$work/log")" "$(q "select count(*) from public.reminder_delivery where kind = 'approval' and status = 'sent'")")"
check "[CHR-20] ... and the alert sent is at least one" "$(is "$(q "select count(*) > 0 from public.reminder_delivery where kind = 'approval' and status = 'sent'")" t)"
check "[CHR-20] the demo family has names to look for" "$(is "$(q "select count(*) > 3 from public.member")" t)"
named=$(q "select display_name from public.member union select title from public.chore union select name from public.household" |
        while IFS= read -r name; do [ -n "$name" ] && grep -qiF -- "$name" "$work/log" && echo "$name"; done)
check "[CHR-20] names no member, item or household" "$(is "$named" '')"
check "[CHR-20] reads only: a session it opens refuses a write" \
  "$(is "$(PGOPTIONS='-c default_transaction_read_only=on' psql "$(url)" -X -A -t -q -c "create table t (x int)" 2>&1 | grep -c 'read-only transaction')" 1)"
check "[CHR-20] ... and the script opens its session that way" \
  "$(grep -q "PGOPTIONS='-c default_transaction_read_only=on'" "$root/scripts/reminders-report.sh" && echo ok || echo 'not read only')"

[ "$failures" -eq 0 ] || { echo "$failures failed"; exit 1; }
echo "reminders-report: all passed"
