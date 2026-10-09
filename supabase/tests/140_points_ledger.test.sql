-- [PTS-01][PTS-02][PTS-07][NFR-06] The points ledger (WP-16): earns and reversals follow each
-- occurrence's status for exactly those it rewards; adjustments by admins, safe to send twice;
-- append-only, written only by database functions; read through RLS; on the board's snapshot; and
-- checked nightly against the statuses. Events happen at distinct times a little before now, so they
-- fold in the order they were sent.
begin;
select plan(73);

-- Fixtures ---------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('0f100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('0f200000-0000-0000-0000-000000000002', 'other-parent@example.com'),
  ('0f300000-0000-0000-0000-000000000003', 'neighbour@example.com'),
  ('0fd00000-0000-0000-0000-00000000000d', null),
  ('0fd00000-0000-0000-0000-00000000000e', null);
insert into public.household (id, name, timezone) values
  ('0f000000-0000-0000-0000-000000000001', 'Points family', 'America/Chicago'),
  ('0f000000-0000-0000-0000-000000000002', 'Neighbours', 'America/Chicago');
insert into public.household_settings (household_id) values
  ('0f000000-0000-0000-0000-000000000001'), ('0f000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('0f000000-0000-0000-0000-000000000001', '0f100000-0000-0000-0000-000000000001', 'owner'),
  ('0f000000-0000-0000-0000-000000000001', '0f200000-0000-0000-0000-000000000002', 'admin'),
  ('0f000000-0000-0000-0000-000000000002', '0f300000-0000-0000-0000-000000000003', 'owner');
insert into public.member (id, household_id, display_name, role, user_id) values
  ('0f110000-0000-0000-0000-000000000001', '0f000000-0000-0000-0000-000000000001', 'Maya', 'child', null),
  ('0f110000-0000-0000-0000-000000000002', '0f000000-0000-0000-0000-000000000001', 'Leo', 'child', null),
  ('0f110000-0000-0000-0000-000000000003', '0f000000-0000-0000-0000-000000000001', 'Pat', 'adult', '0f100000-0000-0000-0000-000000000001'),
  ('0f110000-0000-0000-0000-000000000004', '0f000000-0000-0000-0000-000000000001', 'Zed', 'child', null),
  ('0f110000-0000-0000-0000-000000000009', '0f000000-0000-0000-0000-000000000002', 'Dee', 'child', null);
insert into public.device (id, household_id, name, auth_user_id) values
  ('0fdd0000-0000-0000-0000-000000000001', '0f000000-0000-0000-0000-000000000001', 'Kitchen', '0fd00000-0000-0000-0000-00000000000d'),
  ('0fdd0000-0000-0000-0000-000000000002', '0f000000-0000-0000-0000-000000000002', 'Hall', '0fd00000-0000-0000-0000-00000000000e');

create function pg_temp.today() returns date language sql as $$
  select private.household_today('0f000000-0000-0000-0000-000000000001')
$$;
-- Each event a second after the last, starting three hours ago: distinct times, all in the past.
create temp sequence tick;
create function pg_temp.at() returns timestamptz language sql as $$
  select now() - interval '3 hours' + nextval('tick') * interval '1 second'
$$;
create function pg_temp.item(p_id uuid, p_title text, p_kind text, p_schedule jsonb, p_members uuid[], p_points int,
                             p_approval text default 'inherit', p_visibility text default 'family',
                             p_assignment text default 'shared',
                             p_household uuid default '0f000000-0000-0000-0000-000000000001')
returns uuid language plpgsql as $$
begin
  insert into public.chore (id, household_id, title, kind, points, approval, schedule, visibility, created_by,
                            start_date, assignment)
  values (p_id, p_household, p_title, p_kind, p_points, p_approval, p_schedule, p_visibility,
          case when p_household = '0f000000-0000-0000-0000-000000000001'
               then '0f100000-0000-0000-0000-000000000001'::uuid else '0f300000-0000-0000-0000-000000000003'::uuid end,
          pg_temp.today() - 30, p_assignment);
  insert into public.chore_assignee (household_id, chore_id, member_id) select p_household, p_id, unnest(p_members);
  return p_id;
end $$;
create function pg_temp.occ(p_chore uuid, p_date date, p_member uuid default null) returns uuid language sql as $$
  select id from public.chore_occurrence
   where chore_id = p_chore and due_date = p_date and member_id is not distinct from p_member
$$;
-- Records one event as the database itself (record_completions with no session) and says how it went.
create function pg_temp.rec(p_type text, p_occ uuid, p_done_by uuid[] default '{}', p_id uuid default gen_random_uuid(),
                            p_batch uuid default null)
returns text language sql as $$
  select public.record_completions(jsonb_build_array(jsonb_build_object(
           'id', p_id, 'occurrence_id', p_occ, 'event_type', p_type, 'occurred_at', pg_temp.at(),
           'done_by', to_jsonb(p_done_by), 'batch_id', p_batch))) -> 0 ->> 'result'
$$;
create function pg_temp.bal(p_member uuid) returns int language sql as $$
  select coalesce(sum(amount), 0)::int from public.points_ledger where member_id = p_member
$$;
-- An occurrence's postings for one member, oldest first: 'earn 5', 'reversal -5', ...
create function pg_temp.posts(p_occ uuid, p_member uuid) returns text[] language sql as $$
  select coalesce(array_agg(entry_type || ' ' || amount order by dedupe_key), '{}')
    from public.points_ledger where occurrence_id = p_occ and member_id = p_member
$$;
create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{}', true);
end $$;

select pg_temp.item('0f4e0000-0000-0000-0000-000000000001', 'Make bed', 'chore', '{"freq": "daily"}',
                    array['0f110000-0000-0000-0000-000000000001', '0f110000-0000-0000-0000-000000000002']::uuid[], 5,
                    p_assignment => 'each');
select pg_temp.item('0f4e0000-0000-0000-0000-000000000002', 'Feed the dog', 'chore', '{"freq": "daily"}',
                    array['0f110000-0000-0000-0000-000000000001', '0f110000-0000-0000-0000-000000000002']::uuid[], 3);
select pg_temp.item('0f4e0000-0000-0000-0000-000000000003', 'Homework', 'chore', '{"freq": "daily"}',
                    array['0f110000-0000-0000-0000-000000000001']::uuid[], 10, 'required');
select pg_temp.item('0f4e0000-0000-0000-0000-000000000004', 'Call the plumber', 'chore', '{"freq": "daily"}',
                    array['0f110000-0000-0000-0000-000000000003']::uuid[], 4);
select pg_temp.item('0f4e0000-0000-0000-0000-000000000005', 'Secret surprise', 'chore', '{"freq": "daily"}',
                    array['0f110000-0000-0000-0000-000000000001']::uuid[], 7, p_visibility => 'private');
select pg_temp.item('0f4e0000-0000-0000-0000-000000000006', 'Water the plants', 'chore', '{"freq": "daily"}',
                    array['0f110000-0000-0000-0000-000000000002']::uuid[], 0);
select pg_temp.item('0f4e0000-0000-0000-0000-000000000007', 'Tidy room', 'chore', '{"freq": "daily"}',
                    array['0f110000-0000-0000-0000-000000000001']::uuid[], 6);
select pg_temp.item('0f4e0000-0000-0000-0000-000000000009', 'Dee''s chore', 'chore', '{"freq": "daily"}',
                    array['0f110000-0000-0000-0000-000000000009']::uuid[], 5,
                    p_household => '0f000000-0000-0000-0000-000000000002');
select private.generate_occurrences('0f000000-0000-0000-0000-000000000001', pg_temp.today() - 7, pg_temp.today() - 1);
select private.generate_occurrences('0f000000-0000-0000-0000-000000000002', pg_temp.today() - 7, pg_temp.today() - 1);

-- Earning and giving back (US-1101) ---------------------------------------------------------------
select pg_temp.rec('complete', pg_temp.occ('0f4e0000-0000-0000-0000-000000000001', pg_temp.today(), '0f110000-0000-0000-0000-000000000001'),
                   array['0f110000-0000-0000-0000-000000000001']::uuid[], '0fee0000-0000-0000-0000-000000000001');
select is(pg_temp.posts(pg_temp.occ('0f4e0000-0000-0000-0000-000000000001', pg_temp.today(), '0f110000-0000-0000-0000-000000000001'),
                        '0f110000-0000-0000-0000-000000000001'), array['earn 5'],
  '[PTS-01] checking off a 5-point chore posts exactly one earn of 5');
select is((select (entry_type, created_by_type, member_id)::text from public.points_ledger
            where occurrence_id = pg_temp.occ('0f4e0000-0000-0000-0000-000000000001', pg_temp.today(), '0f110000-0000-0000-0000-000000000001')),
          ('earn', 'system', '0f110000-0000-0000-0000-000000000001')::text,
  '[PTS-01] posted by the database for the member it rewarded');
select is(pg_temp.rec('complete', pg_temp.occ('0f4e0000-0000-0000-0000-000000000001', pg_temp.today(), '0f110000-0000-0000-0000-000000000001'),
                      array['0f110000-0000-0000-0000-000000000001']::uuid[], '0fee0000-0000-0000-0000-000000000001'), 'duplicate',
  '[PTS-01] the same event sent again is a duplicate');
select is(pg_temp.bal('0f110000-0000-0000-0000-000000000001'), 5, '[PTS-01] and posts nothing more');
select pg_temp.rec('undo', pg_temp.occ('0f4e0000-0000-0000-0000-000000000001', pg_temp.today(), '0f110000-0000-0000-0000-000000000001'));
select is(pg_temp.posts(pg_temp.occ('0f4e0000-0000-0000-0000-000000000001', pg_temp.today(), '0f110000-0000-0000-0000-000000000001'),
                        '0f110000-0000-0000-0000-000000000001'), array['earn 5', 'reversal -5'],
  '[PTS-01] unchecking it posts one matching reversal');
select pg_temp.rec('complete', pg_temp.occ('0f4e0000-0000-0000-0000-000000000001', pg_temp.today(), '0f110000-0000-0000-0000-000000000001'),
                   array['0f110000-0000-0000-0000-000000000001']::uuid[]);
select is((select array_agg(dedupe_key order by dedupe_key) from public.points_ledger
            where occurrence_id = pg_temp.occ('0f4e0000-0000-0000-0000-000000000001', pg_temp.today(), '0f110000-0000-0000-0000-000000000001')),
          (select array_agg('occ:' || pg_temp.occ('0f4e0000-0000-0000-0000-000000000001', pg_temp.today(), '0f110000-0000-0000-0000-000000000001')
                            || ':0f110000-0000-0000-0000-000000000001:' || n order by n) from generate_series(1, 3) n),
  '[PTS-01] checking it off again earns again, each posting with its own key');
select is(pg_temp.bal('0f110000-0000-0000-0000-000000000001'), 5, '[PTS-01] the balance is the sum: 5');

-- Shared: both did it, both earn (D-30, D-32).
select pg_temp.rec('complete', pg_temp.occ('0f4e0000-0000-0000-0000-000000000002', pg_temp.today()),
                   array['0f110000-0000-0000-0000-000000000001', '0f110000-0000-0000-0000-000000000002']::uuid[]);
select is((select array_agg(member_id || ' ' || amount order by member_id) from public.points_ledger
            where occurrence_id = pg_temp.occ('0f4e0000-0000-0000-0000-000000000002', pg_temp.today())),
          array['0f110000-0000-0000-0000-000000000001 3', '0f110000-0000-0000-0000-000000000002 3'],
  '[PTS-01] a shared 3-point chore done by two children earns each of them 3, once');

-- Each their own (D-47): Maya made Leo's bed, so Maya earns from Leo's.
select pg_temp.rec('complete', pg_temp.occ('0f4e0000-0000-0000-0000-000000000001', pg_temp.today(), '0f110000-0000-0000-0000-000000000002'),
                   array['0f110000-0000-0000-0000-000000000001']::uuid[]);
select is((select array_agg(member_id order by member_id) from public.points_ledger
            where occurrence_id = pg_temp.occ('0f4e0000-0000-0000-0000-000000000001', pg_temp.today(), '0f110000-0000-0000-0000-000000000002')),
          array['0f110000-0000-0000-0000-000000000001']::uuid[],
  '[PTS-01][CHR-18] whoever did someone''s own chore earns it; its owner earns nothing');

-- Approval (US-306, US-1101).
select pg_temp.rec('complete', pg_temp.occ('0f4e0000-0000-0000-0000-000000000003', pg_temp.today()),
                   array['0f110000-0000-0000-0000-000000000001']::uuid[]);
select is(pg_temp.posts(pg_temp.occ('0f4e0000-0000-0000-0000-000000000003', pg_temp.today()), '0f110000-0000-0000-0000-000000000001'),
          '{}'::text[], '[PTS-01] waiting for approval earns nothing yet');
select pg_temp.rec('approve', pg_temp.occ('0f4e0000-0000-0000-0000-000000000003', pg_temp.today()));
select is(pg_temp.posts(pg_temp.occ('0f4e0000-0000-0000-0000-000000000003', pg_temp.today()), '0f110000-0000-0000-0000-000000000001'),
          array['earn 10'], '[PTS-01] approval earns it');
select pg_temp.rec('reject', pg_temp.occ('0f4e0000-0000-0000-0000-000000000003', pg_temp.today()));
select is(pg_temp.posts(pg_temp.occ('0f4e0000-0000-0000-0000-000000000003', pg_temp.today()), '0f110000-0000-0000-0000-000000000001'),
          array['earn 10', 'reversal -10'], '[PTS-01] a rejection afterwards takes it back');

-- Earns rewards (US-1109).
select pg_temp.rec('complete', pg_temp.occ('0f4e0000-0000-0000-0000-000000000004', pg_temp.today()),
                   array['0f110000-0000-0000-0000-000000000003']::uuid[]);
select is((select count(*)::int from public.points_ledger where member_id = '0f110000-0000-0000-0000-000000000003'), 0,
  '[PTS-07] an adult who does not earn rewards gets no entry for a 4-point chore');
update public.member set earns_rewards = true where id = '0f110000-0000-0000-0000-000000000003';
select pg_temp.rec('complete', pg_temp.occ('0f4e0000-0000-0000-0000-000000000004', pg_temp.today() - 1),
                   array['0f110000-0000-0000-0000-000000000003']::uuid[]);
select is(pg_temp.bal('0f110000-0000-0000-0000-000000000003'), 4,
  '[PTS-07] with the switch on, they earn');
update public.member set earns_rewards = false where id = '0f110000-0000-0000-0000-000000000003';
select is(pg_temp.bal('0f110000-0000-0000-0000-000000000003'), 4,
  '[PTS-07] turning it off keeps what was earned');
select pg_temp.rec('complete', pg_temp.occ('0f4e0000-0000-0000-0000-000000000004', pg_temp.today() - 2),
                   array['0f110000-0000-0000-0000-000000000003']::uuid[]);
select is(pg_temp.bal('0f110000-0000-0000-0000-000000000003'), 4, '[PTS-07] and earns nothing new');

select pg_temp.rec('complete', pg_temp.occ('0f4e0000-0000-0000-0000-000000000006', pg_temp.today()),
                   array['0f110000-0000-0000-0000-000000000002']::uuid[]);
select is((select count(*)::int from public.points_ledger
            where occurrence_id = pg_temp.occ('0f4e0000-0000-0000-0000-000000000006', pg_temp.today())), 0,
  '[PTS-01] a chore worth no points posts nothing');

-- A batch uncheck (US-309): four "not actually done" with one batch id, reversed exactly once.
select pg_temp.rec('complete', pg_temp.occ('0f4e0000-0000-0000-0000-000000000007', pg_temp.today() - k),
                   array['0f110000-0000-0000-0000-000000000001']::uuid[])
  from generate_series(1, 5) k;
select is((select count(*)::int from public.points_ledger l
             join public.chore_occurrence o on o.id = l.occurrence_id
            where o.chore_id = '0f4e0000-0000-0000-0000-000000000007' and l.entry_type = 'earn'), 5,
  '[PTS-01] five checked-off days of a 6-point chore earn five times');
select pg_temp.rec('admin_uncomplete', pg_temp.occ('0f4e0000-0000-0000-0000-000000000007', pg_temp.today() - k),
                   p_id => ('0fba0000-0000-0000-0000-00000000000' || k)::uuid, p_batch => '0fbb0000-0000-0000-0000-000000000001')
  from generate_series(1, 4) k;
select pg_temp.rec('admin_uncomplete', pg_temp.occ('0f4e0000-0000-0000-0000-000000000007', pg_temp.today() - k),
                   p_id => ('0fba0000-0000-0000-0000-00000000000' || k)::uuid, p_batch => '0fbb0000-0000-0000-0000-000000000001')
  from generate_series(1, 4) k;
select is((select array_agg(o.due_date order by o.due_date) from public.points_ledger l
             join public.chore_occurrence o on o.id = l.occurrence_id
            where o.chore_id = '0f4e0000-0000-0000-0000-000000000007' and l.entry_type = 'reversal'),
          (select array_agg(pg_temp.today() - k order by pg_temp.today() - k) from generate_series(1, 4) k),
  '[PTS-01][CHR-08] a batch of four unchecks, sent twice, reverses those four exactly once');

-- A missed routine done late by a parent (US-307), then unchecked: back to missed, points back.
select private.close_past_due('0f000000-0000-0000-0000-000000000001');
select pg_temp.rec('admin_complete', pg_temp.occ('0f4e0000-0000-0000-0000-000000000002', pg_temp.today() - 3),
                   array['0f110000-0000-0000-0000-000000000002']::uuid[]);
select is(pg_temp.posts(pg_temp.occ('0f4e0000-0000-0000-0000-000000000002', pg_temp.today() - 3), '0f110000-0000-0000-0000-000000000002'),
          array['earn 3'], '[PTS-01] a missed chore completed late by a parent earns');
select pg_temp.rec('admin_uncomplete', pg_temp.occ('0f4e0000-0000-0000-0000-000000000002', pg_temp.today() - 3));
select ok((select status from public.chore_occurrence where id = pg_temp.occ('0f4e0000-0000-0000-0000-000000000002', pg_temp.today() - 3)) = 'missed'
          and pg_temp.posts(pg_temp.occ('0f4e0000-0000-0000-0000-000000000002', pg_temp.today() - 3), '0f110000-0000-0000-0000-000000000002')
              = array['earn 3', 'reversal -3'],
  '[PTS-01] unchecking it again returns it to missed and reverses the points');

-- Adjustments (US-1106) -----------------------------------------------------------------------------
select pg_temp.act_as('0f100000-0000-0000-0000-000000000001');
select is((public.adjust_points('0f110000-0000-0000-0000-000000000002', 10, '  Helped a neighbour ',
                                 '0fad0000-0000-0000-0000-000000000001') ->> 'duplicate')::boolean, false,
  '[PTS-01] an admin adds 10 points with a reason');
reset role;
select is((select (entry_type, amount, reason, created_by_type, created_by)::text from public.points_ledger
            where dedupe_key = 'adj:0fad0000-0000-0000-0000-000000000001'),
          ('adjustment', 10, 'Helped a neighbour', 'admin', '0f100000-0000-0000-0000-000000000001')::text,
  '[PTS-01] posted as an adjustment with the reason, by that admin');
select pg_temp.act_as('0f100000-0000-0000-0000-000000000001');
select is(public.adjust_points('0f110000-0000-0000-0000-000000000002', 10, 'Helped a neighbour',
                               '0fad0000-0000-0000-0000-000000000001') - 'id',
          jsonb_build_object('duplicate', true, 'balance', 3 + 10),
  '[PTS-01] the same request sent again posts nothing and answers the same balance');
select throws_ok($$ select public.adjust_points('0f110000-0000-0000-0000-000000000002', 20, 'Helped a neighbour',
                                                '0fad0000-0000-0000-0000-000000000001') $$,
  '22023', null, '[PTS-01] a request id reused for something else is refused');
select is((public.adjust_points('0f110000-0000-0000-0000-000000000002', -50, 'Lost library book',
                                 '0fad0000-0000-0000-0000-000000000002') ->> 'balance')::int, 13 - 50,
  '[PTS-02] taking points away can leave a balance below zero');
select throws_ok($$ select public.adjust_points('0f110000-0000-0000-0000-000000000003', 5, 'Thanks', gen_random_uuid()) $$,
  '22023', 'this member does not earn rewards', '[PTS-07] not for a member who does not earn rewards');
select throws_ok($$ select public.adjust_points('0f110000-0000-0000-0000-000000000001', 0, 'Nothing', gen_random_uuid()) $$,
  '22023', 'points must be 1 to 10000 either way', '[PTS-01] not for zero points');
select throws_ok($$ select public.adjust_points('0f110000-0000-0000-0000-000000000001', 10001, 'Lots', gen_random_uuid()) $$,
  '22023', 'points must be 1 to 10000 either way', '[PTS-01] nor more than 10000');
select throws_ok($$ select public.adjust_points('0f110000-0000-0000-0000-000000000001', 5, '   ', gen_random_uuid()) $$,
  '22023', 'say why, in up to 200 characters', '[PTS-01] a reason is required');
select throws_ok($$ select public.adjust_points('0f110000-0000-0000-0000-000000000001', 5, 'Thanks', null) $$,
  '22023', 'say which request this is', '[PTS-01] and a request id');
reset role;
update public.member set archived_at = now() where id = '0f110000-0000-0000-0000-000000000004';
select pg_temp.act_as('0f200000-0000-0000-0000-000000000002');
select throws_ok($$ select public.adjust_points('0f110000-0000-0000-0000-000000000004', 5, 'Thanks', gen_random_uuid()) $$,
  '22023', 'archived members do not earn points', '[PTS-01] not for an archived member');
select is((public.adjust_points('0f110000-0000-0000-0000-000000000001', 2, 'Kind words',
                                 '0fad0000-0000-0000-0000-000000000003') ->> 'duplicate')::boolean, false,
  '[PTS-01] any admin of the household may adjust');
select pg_temp.act_as('0f300000-0000-0000-0000-000000000003');
select throws_ok($$ select public.adjust_points('0f110000-0000-0000-0000-000000000001', 5, 'Hi', gen_random_uuid()) $$,
  '42501', null, '[PTS-01] an admin of another household may not');
select pg_temp.act_as('0fd00000-0000-0000-0000-00000000000d');
select throws_ok($$ select public.adjust_points('0f110000-0000-0000-0000-000000000001', 5, 'Hi', gen_random_uuid()) $$,
  '42501', null, '[PTS-01] nor may a board');
reset role;
select pg_temp.as_system();
select ok(not has_function_privilege('anon', 'public.adjust_points(uuid, integer, text, uuid)', 'execute'),
  '[NFR-04] adjust_points is not open to anonymous callers');

-- Append-only, and written only by the database (D-28) ----------------------------------------------
select throws_ok($$ update public.points_ledger set amount = 100 where member_id = '0f110000-0000-0000-0000-000000000001' $$,
  '42501', 'the points ledger is append-only', '[PTS-01] an entry cannot be changed');
select throws_ok($$ delete from public.points_ledger where member_id = '0f110000-0000-0000-0000-000000000001' $$,
  '42501', 'the points ledger is append-only', '[PTS-01] nor deleted');
select ok(not has_table_privilege(r, 'public.points_ledger', p),
          format('[PTS-01] %s cannot %s points_ledger directly', r, p))
  from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['insert', 'update', 'delete']) p;
select pg_temp.act_as('0f100000-0000-0000-0000-000000000001');
select throws_ok($$ insert into public.points_ledger (household_id, member_id, entry_type, amount, dedupe_key, created_by_type)
                    values ('0f000000-0000-0000-0000-000000000001', '0f110000-0000-0000-0000-000000000001', 'bonus', 100, 'x', 'admin') $$,
  '42501', null, '[PTS-01] an admin cannot insert an entry');
reset role;
select ok(not has_function_privilege('authenticated', 'private.post_ledger(uuid, uuid, text, integer, text, text, text, uuid)', 'execute')
          and not has_function_privilege('authenticated', 'private.reconcile_occurrence_points(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'private.backfill_points()', 'execute'),
  '[NFR-04] the ledger''s writers are not callable from outside');

-- Read through RLS (PTS-02) -------------------------------------------------------------------------
select pg_temp.act_as('0f200000-0000-0000-0000-000000000002');
select is((select array_agg(distinct household_id) from public.points_ledger),
          array['0f000000-0000-0000-0000-000000000001']::uuid[],
  '[PTS-02] an admin reads their own household''s ledger and no other');
select is((select balance from public.v_points_balance where member_id = '0f110000-0000-0000-0000-000000000002'), 3 + 10 - 50,
  '[PTS-02] and each member''s balance');
select is((select earned from public.v_points_balance where member_id = '0f110000-0000-0000-0000-000000000002'), 3,
  '[PTS-02] with what doing things has earned, net of reversals and before adjustments');
select pg_temp.act_as('0f300000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.points_ledger where household_id = '0f000000-0000-0000-0000-000000000001'), 0,
  '[NFR-04] a neighbour reads none of it');
select pg_temp.act_as('0fd00000-0000-0000-0000-00000000000d');
select is((select array_agg(distinct household_id) from public.points_ledger),
          array['0f000000-0000-0000-0000-000000000001']::uuid[],
  '[PTS-02] the board reads its household''s ledger');

-- The board's snapshot (PTS-02) ---------------------------------------------------------------------
-- Maya earns 7 for a private item: it counts on the board, without its title.
reset role;
select pg_temp.as_system();
select pg_temp.rec('complete', pg_temp.occ('0f4e0000-0000-0000-0000-000000000005', pg_temp.today()),
                   array['0f110000-0000-0000-0000-000000000001']::uuid[]);
select pg_temp.act_as('0fd00000-0000-0000-0000-00000000000d');
create temp table snap as select public.board_snapshot() as s;
select is((select (m -> 'points' ->> 'balance')::int from snap, jsonb_array_elements(s -> 'members') m
            where m ->> 'display_name' = 'Maya'),
          (select sum(amount)::int from public.points_ledger where member_id = '0f110000-0000-0000-0000-000000000001'),
  '[PTS-02] each child''s balance is on the board');
select is((select jsonb_array_length(m -> 'points' -> 'recent') from snap, jsonb_array_elements(s -> 'members') m
            where m ->> 'display_name' = 'Maya'), 5,
  '[PTS-02] with the five latest entries');
select is((select (m -> 'points' -> 'recent' -> 0) - 'id' - 'at' from snap, jsonb_array_elements(s -> 'members') m
            where m ->> 'display_name' = 'Maya'),
          '{"type": "earn", "amount": 7, "label": null}'::jsonb,
  '[PTS-02][CHR-14] newest first; a private item''s points count but its title stays hidden');
select is((select m -> 'points' -> 'recent' -> 1 ->> 'label' from snap, jsonb_array_elements(s -> 'members') m
            where m ->> 'display_name' = 'Maya'), 'Kind words',
  '[PTS-02] an adjustment shows its reason');
select ok((select m -> 'points' = 'null'::jsonb from snap, jsonb_array_elements(s -> 'members') m
            where m ->> 'display_name' = 'Pat'),
  '[PTS-07] a member who does not earn rewards has no points on the board');
reset role;

-- The nightly check and its fix (NFR-06) ------------------------------------------------------------
select pg_temp.as_system();
select is((public.occurrence_status_drift('0f000000-0000-0000-0000-000000000001') ->> 'points_drift')::int, 0,
  '[NFR-06] the ledger agrees with every status');
alter table public.chore_occurrence disable trigger trg_occ_points;
update public.chore_occurrence set status = 'completed', rewarded = array['0f110000-0000-0000-0000-000000000002']::uuid[]
 where id = pg_temp.occ('0f4e0000-0000-0000-0000-000000000001', pg_temp.today() + 1, '0f110000-0000-0000-0000-000000000002');
alter table public.chore_occurrence enable trigger trg_occ_points;
select is(public.occurrence_status_drift('0f000000-0000-0000-0000-000000000001') -> 'points_sample' -> 0,
          jsonb_build_object('occurrence_id', pg_temp.occ('0f4e0000-0000-0000-0000-000000000001', pg_temp.today() + 1, '0f110000-0000-0000-0000-000000000002'),
                             'member_id', '0f110000-0000-0000-0000-000000000002', 'held', 0, 'owed', 5),
  '[NFR-06] a done status whose points were never posted is reported');
select is(private.reconcile_occurrence_points(pg_temp.occ('0f4e0000-0000-0000-0000-000000000001', pg_temp.today() + 1, '0f110000-0000-0000-0000-000000000002')), 1,
  '[NFR-06] reconciling that occurrence posts what it owes');
select is((public.occurrence_status_drift('0f000000-0000-0000-0000-000000000001') ->> 'points_drift')::int, 0,
  '[NFR-06] and the check is clean again');
-- Rebuilding the status from its events (a parent's fix) takes the points back with it.
select private.rebuild_occurrence_status('0f000000-0000-0000-0000-000000000001', pg_temp.today(), pg_temp.today() + 1, true);
select is(pg_temp.posts(pg_temp.occ('0f4e0000-0000-0000-0000-000000000001', pg_temp.today() + 1, '0f110000-0000-0000-0000-000000000002'),
                        '0f110000-0000-0000-0000-000000000002'), array['earn 5', 'reversal -5'],
  '[NFR-06] correcting a status corrects its points');

-- A member removed since an event credited them never makes a later change fail.
insert into public.member (id, household_id, display_name, role) values
  ('0f110000-0000-0000-0000-000000000005', '0f000000-0000-0000-0000-000000000001', 'Gone', 'child');
alter table public.chore_occurrence disable trigger trg_occ_points;
update public.chore_occurrence set status = 'scheduled',
       rewarded = array['0f110000-0000-0000-0000-000000000005']::uuid[]
 where id = pg_temp.occ('0f4e0000-0000-0000-0000-000000000002', pg_temp.today() + 3);
alter table public.chore_occurrence enable trigger trg_occ_points;
delete from public.member where id = '0f110000-0000-0000-0000-000000000005';
update public.chore_occurrence set status = 'completed'
 where id = pg_temp.occ('0f4e0000-0000-0000-0000-000000000002', pg_temp.today() + 3);
select is((select count(*)::int from public.points_ledger
            where occurrence_id = pg_temp.occ('0f4e0000-0000-0000-0000-000000000002', pg_temp.today() + 3)), 0,
  '[PTS-01] a status change crediting a member who no longer exists posts nothing, and fails nothing');
update public.chore_occurrence set status = 'scheduled', rewarded = '{}'
 where id = pg_temp.occ('0f4e0000-0000-0000-0000-000000000002', pg_temp.today() + 3);

-- Check-offs from before the ledger (the migration's backfill) ----------------------------------------
alter table public.chore_occurrence disable trigger trg_occ_points;
update public.chore_occurrence
   set status = 'approved', rewarded = array['0f110000-0000-0000-0000-000000000001', '0f110000-0000-0000-0000-000000000002']::uuid[],
       status_changed_at = now() - interval '2 days'
 where id = pg_temp.occ('0f4e0000-0000-0000-0000-000000000002', pg_temp.today() + 2);
alter table public.chore_occurrence enable trigger trg_occ_points;
select is(private.backfill_points(), 2, '[PTS-01] a done occurrence with nothing posted earns for each member it rewarded');
select is((select array_agg(created_at order by member_id) from public.points_ledger
            where occurrence_id = pg_temp.occ('0f4e0000-0000-0000-0000-000000000002', pg_temp.today() + 2)),
          array[now() - interval '2 days', now() - interval '2 days'],
  '[PTS-01] dated when it became done');
select is(private.backfill_points(), 0, '[PTS-01] running it again posts nothing');

-- Property test (WP-16 "done when"): random check-offs, undos, approvals, rejections, skips, parent
-- corrections, switches of earns rewards and adjustments, with day close part way. After every step
-- each member's balance is the points of the done occurrences that reward them plus their adjustments,
-- and a step never earns anything for a member whose switch is off.
create function pg_temp.balance_off() returns int language sql as $$
  with owed as (
    select m.member_id, sum(o.points_snapshot)::int as points
      from public.chore_occurrence o, unnest(o.rewarded) m (member_id)
     where o.household_id = '0f000000-0000-0000-0000-000000000001' and o.status in ('completed', 'approved')
     group by m.member_id
  ), adjusted as (
    select member_id, sum(amount)::int as points from public.points_ledger
     where household_id = '0f000000-0000-0000-0000-000000000001' and entry_type = 'adjustment'
     group by member_id
  ), held as (
    select member_id, sum(amount)::int as points from public.points_ledger
     where household_id = '0f000000-0000-0000-0000-000000000001' group by member_id
  )
  select count(*)::int
    from public.member mem
    left join owed o on o.member_id = mem.id
    left join adjusted a on a.member_id = mem.id
    left join held h on h.member_id = mem.id
   where mem.household_id = '0f000000-0000-0000-0000-000000000001'
     and coalesce(h.points, 0) <> coalesce(o.points, 0) + coalesce(a.points, 0)
$$;
create function pg_temp.random_steps(p_n int) returns text language plpgsql as $$
declare
  v_types   text[] := array['complete', 'undo', 'approve', 'reject', 'admin_complete', 'admin_uncomplete', 'skip'];
  v_members uuid[] := array['0f110000-0000-0000-0000-000000000001', '0f110000-0000-0000-0000-000000000002',
                            '0f110000-0000-0000-0000-000000000003']::uuid[];
  v_occs    uuid[];
  v_type    text;
  v_who     uuid[];
  v_roll    float;
  v_member  uuid;
begin
  perform setseed(0.16);
  select array_agg(id order by id) into v_occs from public.chore_occurrence
   where household_id = '0f000000-0000-0000-0000-000000000001'
     and due_date between pg_temp.today() - 7 and pg_temp.today() + 2 and points_snapshot > 0;
  for i in 1..p_n loop
    v_roll := random();
    v_member := v_members[1 + floor(random() * 3)::int];
    if v_roll < 0.08 then
      update public.member set earns_rewards = not earns_rewards where id = v_member;
    elsif v_roll < 0.14 then
      perform set_config('request.jwt.claims', json_build_object('sub', '0f100000-0000-0000-0000-000000000001')::text, true);
      if (select earns_rewards and archived_at is null from public.member where id = v_member) then
        perform public.adjust_points(v_member, coalesce(nullif((floor(random() * 41) - 20)::int, 0), 7),
                                     'Random', gen_random_uuid());
      end if;
      perform set_config('request.jwt.claims', '{}', true);
    else
      v_type := v_types[1 + floor(random() * 7)::int];
      v_who := case when random() < 0.3 then array[v_members[1], v_members[2]]
                    else array[v_members[1 + floor(random() * 3)::int]] end;
      perform pg_temp.rec(v_type, v_occs[1 + floor(random() * cardinality(v_occs))::int],
                          case when v_type in ('complete', 'admin_complete') or (v_type = 'approve' and random() < 0.5)
                               then v_who else '{}' end);
    end if;
    if i = p_n / 2 then
      perform private.close_past_due('0f000000-0000-0000-0000-000000000001');
    end if;
    if pg_temp.balance_off() <> 0 then
      return 'a balance differs from its done occurrences and adjustments after step ' || i;
    end if;
  end loop;
  return 'ok';
end $$;
-- Earns made during the run, with the member's switch as it was when each was posted.
create temp table earn_switch (ledger_id uuid primary key, earns boolean);
create function pg_temp.note_earn() returns trigger language plpgsql as $$
begin
  if new.entry_type = 'earn' then
    insert into earn_switch values (new.id, (select earns_rewards from public.member where id = new.member_id));
  end if;
  return null;
end $$;
create trigger note_earn after insert on public.points_ledger for each row execute function pg_temp.note_earn();
select is(pg_temp.random_steps(300), 'ok',
  '[PTS-01] property: across 300 random steps, every balance is its done occurrences'' points plus adjustments');
select is((select count(*)::int from earn_switch where not earns), 0,
  '[PTS-07] property: and no earn ever went to a member whose earns-rewards switch was off');
select ok((select count(*) from earn_switch) > 20, '[PTS-01] property: the run earned often enough to mean something');
select is((public.occurrence_status_drift('0f000000-0000-0000-0000-000000000001') ->> 'points_drift')::int, 0,
  '[NFR-06] property: and the nightly check finds nothing');

-- A household's deletion takes its ledger with it ---------------------------------------------------
drop trigger note_earn on public.points_ledger;
delete from public.household where id = '0f000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.points_ledger where household_id = '0f000000-0000-0000-0000-000000000001'), 0,
  '[PTS-01] deleting a household (export and delete, or the demo reset) removes its ledger');

select * from finish();
rollback;
