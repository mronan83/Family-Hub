#!/usr/bin/env bash
# [PTS-04] Two requests at the same moment cannot overspend (WP-18's Done when). pgTAP runs in one
# session, so this uses real concurrent sessions on the test database that scripts/db-test.sh made:
#   1. A child with 150 points asks for a 100-point reward on two boards at once: one is accepted.
#   2. The same, with the first request held open for a second: the second waits for the member
#      lock, then sees the first and is refused.
#   3. Two children ask for the last one in stock at once: one is accepted.
# Each case runs several times. Usage: redemption-race.sh <database>
set -euo pipefail

db="${1:?database name}"
q() { psql -v ON_ERROR_STOP=1 -X -A -t -q -d "$db" -c "$1"; }

H=1a000000-0000-0000-0000-000000000001
q "insert into auth.users (id, email) values
     ('1a100000-0000-0000-0000-000000000001', 'race-parent@example.com'),
     ('1ad00000-0000-0000-0000-00000000000d', null), ('1ad00000-0000-0000-0000-00000000000e', null);
   insert into public.household (id, name, timezone) values ('$H', 'Race family', 'UTC');
   insert into public.household_user (household_id, user_id, role)
     values ('$H', '1a100000-0000-0000-0000-000000000001', 'owner');
   insert into public.device (household_id, name, auth_user_id) values
     ('$H', 'Kitchen', '1ad00000-0000-0000-0000-00000000000d'), ('$H', 'Hall', '1ad00000-0000-0000-0000-00000000000e');
   insert into public.reward_catalog_item (id, household_id, title, cost_points) values
     ('1ac00000-0000-0000-0000-000000000001', '$H', 'Movie night', 100);"

# A fresh child with this many points (an adjustment by the parent).
child() {
  local id
  id=$(q "insert into public.member (household_id, display_name, role) values ('$H', 'Kid', 'child') returning id")
  q "select set_config('request.jwt.claims', '{\"sub\": \"1a100000-0000-0000-0000-000000000001\", \"role\": \"authenticated\"}', false);
     select public.adjust_points('$id', $1, 'Saved up', gen_random_uuid());" >/dev/null
  echo "$id"
}

# One board's request in its own session; prints accepted or the refusal. $3 holds the lock open.
ask() {
  local device=$1 member=$2 item=$3 hold=${4:-0}
  if psql -v ON_ERROR_STOP=1 -X -A -t -q -d "$db" >/dev/null 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "$device", "role": "authenticated"}', true);
select public.request_redemption(gen_random_uuid(), '$member', '$item');
select pg_sleep($hold);
commit;
SQL
  then echo accepted; else echo refused; fi
}

fail=0
check() {
  local name=$1 accepted=$2 want=$3
  if [ "$accepted" = "$want" ]; then echo "ok - $name"; else echo "not ok - $name (accepted $accepted, want $want)"; fail=1; fi
}

for round in 1 2 3 4 5; do
  kid=$(child 150)
  out=$( { ask 1ad00000-0000-0000-0000-00000000000d "$kid" 1ac00000-0000-0000-0000-000000000001 &
           ask 1ad00000-0000-0000-0000-00000000000e "$kid" 1ac00000-0000-0000-0000-000000000001 &
           wait; } )
  check "round $round: two boards at once, 150 points, 100 each: one accepted" "$(grep -c accepted <<<"$out")" 1
done

kid=$(child 150)
out=$( { ask 1ad00000-0000-0000-0000-00000000000d "$kid" 1ac00000-0000-0000-0000-000000000001 1 &
         sleep 0.3
         ask 1ad00000-0000-0000-0000-00000000000e "$kid" 1ac00000-0000-0000-0000-000000000001 &
         wait; } )
check "the second waits for the first, then is refused" "$(grep -c accepted <<<"$out")" 1

for round in 1 2 3; do
  item=$(q "insert into public.reward_catalog_item (household_id, title, cost_points, stock)
            values ('$H', 'Last one $round', 10, 1) returning id")
  a=$(child 50)
  b=$(child 50)
  out=$( { ask 1ad00000-0000-0000-0000-00000000000d "$a" "$item" &
           ask 1ad00000-0000-0000-0000-00000000000e "$b" "$item" &
           wait; } )
  check "round $round: two children, the last one in stock: one accepted" "$(grep -c accepted <<<"$out")" 1
done

# Whatever happened, nobody's open requests are more than their balance.
over=$(q "select count(*) from public.member m
           where m.household_id = '$H'
             and (select coalesce(sum(cost_snapshot), 0) from public.redemption r
                   where r.member_id = m.id and r.status = 'requested') > private.member_balance(m.id)")
check "no child has asked for more than they have" "$over" 0

exit $fail
