-- [CHR-06][CHR-08][PTS-01] A parent's day (WP-12): "Not actually done" on several items is one batch of
-- unchecks with one batch_id, each reversing its points exactly once, and the board sees them open
-- again; the batch can be put back in one step, once, only where nothing changed since, and only by a
-- parent of the household. Earlier events happen at distinct times a little before now; putting back
-- happens now, so it is always the latest.
begin;
select plan(24);

insert into auth.users (id, email) values
  ('16100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('16300000-0000-0000-0000-000000000003', 'neighbour@example.com'),
  ('16d00000-0000-0000-0000-00000000000d', null);
insert into public.household (id, name, timezone) values
  ('16000000-0000-0000-0000-000000000001', 'Batch family', 'America/Chicago'),
  ('16000000-0000-0000-0000-000000000002', 'Neighbours', 'America/Chicago');
insert into public.household_settings (household_id) values
  ('16000000-0000-0000-0000-000000000001'), ('16000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('16000000-0000-0000-0000-000000000001', '16100000-0000-0000-0000-000000000001', 'owner'),
  ('16000000-0000-0000-0000-000000000002', '16300000-0000-0000-0000-000000000003', 'owner');
insert into public.member (id, household_id, display_name, role, user_id) values
  ('16110000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000001', 'Maya', 'child', null),
  ('16110000-0000-0000-0000-000000000003', '16000000-0000-0000-0000-000000000001', 'Pat', 'adult', '16100000-0000-0000-0000-000000000001');
insert into public.device (id, household_id, name, auth_user_id) values
  ('16dd0000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000001', 'Kitchen', '16d00000-0000-0000-0000-00000000000d');

create function pg_temp.today() returns date language sql as $$
  select private.household_today('16000000-0000-0000-0000-000000000001')
$$;
create temp sequence tick;
grant usage on sequence tick to authenticated;
create function pg_temp.at() returns timestamptz language sql as $$
  select now() - interval '3 hours' + nextval('tick') * interval '1 second'
$$;
-- Five 5-point routines for Maya, every day.
insert into public.chore (id, household_id, title, kind, points, schedule, created_by, start_date)
select ('16c00000-0000-0000-0000-00000000000' || n)::uuid, '16000000-0000-0000-0000-000000000001',
       'Item ' || n, 'chore', 5, '{"freq": "daily"}', '16100000-0000-0000-0000-000000000001', pg_temp.today() - 10
  from generate_series(1, 5) n;
insert into public.chore_assignee (household_id, chore_id, member_id)
select '16000000-0000-0000-0000-000000000001', ('16c00000-0000-0000-0000-00000000000' || n)::uuid,
       '16110000-0000-0000-0000-000000000001'
  from generate_series(1, 5) n;
select private.generate_occurrences('16000000-0000-0000-0000-000000000001', pg_temp.today() - 1, pg_temp.today() - 1);

create function pg_temp.occ(p_n int, p_date date default null) returns uuid language sql as $$
  select id from public.chore_occurrence
   where chore_id = ('16c00000-0000-0000-0000-00000000000' || p_n)::uuid and due_date = coalesce(p_date, pg_temp.today())
$$;
create function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_nobody() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
-- Records events as whoever is acting now; returns each result.
create function pg_temp.rec(p_type text, p_occs uuid[], p_batch uuid default null, p_done_by uuid[] default '{}')
returns text[] language sql as $$
  select array_agg(r ->> 'result' order by ord)
    from jsonb_array_elements(public.record_completions((
           select jsonb_agg(jsonb_build_object(
                    -- A batch's ids are fixed (sending it again is a duplicate); others are new each time.
                    'id', md5(coalesce(p_batch::text, gen_random_uuid()::text) || o::text || p_type)::uuid,
                    'occurrence_id', o,
                    'event_type', p_type, 'occurred_at', pg_temp.at(), 'done_by', to_jsonb(p_done_by),
                    'batch_id', p_batch) order by i)
             from unnest(p_occs) with ordinality u(o, i)))) with ordinality x(r, ord)
$$;
create function pg_temp.statuses(p_occs uuid[]) returns text[] language sql as $$
  select array_agg(o.status order by u.i) from unnest(p_occs) with ordinality u(id, i)
    join public.chore_occurrence o on o.id = u.id
$$;
create function pg_temp.posts(p_occ uuid) returns text[] language sql as $$
  select coalesce(array_agg(entry_type || ' ' || amount order by dedupe_key), '{}')
    from public.points_ledger where occurrence_id = p_occ
$$;
create function pg_temp.balance() returns int language sql as $$
  select coalesce(sum(amount), 0)::int from public.points_ledger where member_id = '16110000-0000-0000-0000-000000000001'
$$;

-- The board checks all five off: 25 points.
select pg_temp.as_user('16d00000-0000-0000-0000-00000000000d');
select pg_temp.rec('complete', array[pg_temp.occ(1), pg_temp.occ(2), pg_temp.occ(3), pg_temp.occ(4), pg_temp.occ(5)],
                   p_done_by => array['16110000-0000-0000-0000-000000000001']::uuid[]);
select pg_temp.as_nobody();
select is(pg_temp.balance(), 25, 'five check-offs earn 25 points');

-- [CHR-08] The parent unchecks four of the five in one action.
select pg_temp.as_user('16100000-0000-0000-0000-000000000001');
select is(pg_temp.rec('admin_uncomplete', array[pg_temp.occ(1), pg_temp.occ(2), pg_temp.occ(3), pg_temp.occ(4)],
                      '16ba0000-0000-0000-0000-00000000000b'),
          array['recorded', 'recorded', 'recorded', 'recorded'], 'four unchecks are recorded');
select pg_temp.as_nobody();
select is((select count(*)::int from public.chore_completion_event
            where batch_id = '16ba0000-0000-0000-0000-00000000000b' and event_type = 'admin_uncomplete'
              and actor_type = 'admin' and actor_id = '16100000-0000-0000-0000-000000000001'),
          4, 'they share one batch id, recorded as the parent');
select is(pg_temp.statuses(array[pg_temp.occ(1), pg_temp.occ(2), pg_temp.occ(3), pg_temp.occ(4), pg_temp.occ(5)]),
          array['scheduled', 'scheduled', 'scheduled', 'scheduled', 'completed'],
          'the four are open again; the fifth is still done');
select is((select count(*)::int from public.points_ledger
            where member_id = '16110000-0000-0000-0000-000000000001' and entry_type = 'reversal'),
          4, '[PTS-01] exactly four reversals are posted');
select is(pg_temp.posts(pg_temp.occ(1)), array['earn 5', 'reversal -5'], 'each takes back its own points once');
select is(pg_temp.balance(), 5, 'the balance is the fifth item''s points');

-- Sent again (a double tap on the form): the same event ids, nothing new.
select pg_temp.as_user('16100000-0000-0000-0000-000000000001');
select is(pg_temp.rec('admin_uncomplete', array[pg_temp.occ(1), pg_temp.occ(2), pg_temp.occ(3), pg_temp.occ(4)],
                      '16ba0000-0000-0000-0000-00000000000b'),
          array['duplicate', 'duplicate', 'duplicate', 'duplicate'], 'the same batch sent again is a duplicate');
select pg_temp.as_nobody();
select is((select count(*)::int from public.points_ledger where entry_type = 'reversal'), 4,
          'and posts no further reversal');

-- The board sees them open, without anything telling a child off.
select pg_temp.as_user('16d00000-0000-0000-0000-00000000000d');
select is((select array_agg(i ->> 'status' order by i ->> 'title')
             from jsonb_array_elements(public.board_snapshot() -> 'occurrences') i
            where i ->> 'due_date' = pg_temp.today()::text),
          array['scheduled', 'scheduled', 'scheduled', 'scheduled', 'completed'],
          'the board''s snapshot shows the four open again');

-- [CHR-06] A past day: a parent's late completion, the day closes, then it is unchecked: missed.
select pg_temp.as_user('16100000-0000-0000-0000-000000000001');
select pg_temp.rec('admin_complete', array[pg_temp.occ(1, pg_temp.today() - 1)],
                   p_done_by => array['16110000-0000-0000-0000-000000000001']::uuid[]);
select pg_temp.as_nobody();
select private.close_past_due('16000000-0000-0000-0000-000000000001');
select pg_temp.as_user('16100000-0000-0000-0000-000000000001');
select pg_temp.rec('admin_uncomplete', array[pg_temp.occ(1, pg_temp.today() - 1)], '16ba0000-0000-0000-0000-0000000000d1');
select pg_temp.as_nobody();
select is(pg_temp.statuses(array[pg_temp.occ(1, pg_temp.today() - 1)]), array['missed'],
          'unchecked after its day closed, a routine is missed');

-- A batch whose item was checked off again since: putting it back leaves that one alone.
select pg_temp.as_user('16100000-0000-0000-0000-000000000001');
select pg_temp.rec('admin_uncomplete', array[pg_temp.occ(5)], '16ba0000-0000-0000-0000-0000000000c1');
select pg_temp.as_user('16d00000-0000-0000-0000-00000000000d');
select pg_temp.rec('complete', array[pg_temp.occ(5)], p_done_by => array['16110000-0000-0000-0000-000000000001']::uuid[]);

-- Who may put a batch back: not the board, not another household.
select pg_temp.as_user('16d00000-0000-0000-0000-00000000000d');
select throws_ok($$ select public.undo_uncheck_batch('16ba0000-0000-0000-0000-00000000000b') $$, '42501', null,
                 'a board cannot put a batch back');
select pg_temp.as_user('16300000-0000-0000-0000-000000000003');
select is(public.undo_uncheck_batch('16ba0000-0000-0000-0000-00000000000b'),
          '{"restored": 0, "unchanged": 0}'::jsonb, 'another household''s parent finds no such batch');
select pg_temp.as_nobody();
select is(pg_temp.statuses(array[pg_temp.occ(1)]), array['scheduled'], '... and changes nothing');
select ok(not has_function_privilege('anon', 'public.undo_uncheck_batch(uuid)', 'execute'),
          'signed-out callers cannot run it');

-- [CHR-08] The parent puts the batch back.
select pg_temp.as_user('16100000-0000-0000-0000-000000000001');
select is(public.undo_uncheck_batch('16ba0000-0000-0000-0000-00000000000b'),
          '{"restored": 4, "unchanged": 0}'::jsonb, 'the batch is put back');
select pg_temp.as_nobody();
select is(pg_temp.statuses(array[pg_temp.occ(1), pg_temp.occ(2), pg_temp.occ(3), pg_temp.occ(4)]),
          array['approved', 'approved', 'approved', 'approved'], 'done again, as a parent''s completion');
select is((select array_agg(distinct d) from public.chore_occurrence o, unnest(o.done_by) d
            where o.id in (pg_temp.occ(1), pg_temp.occ(2), pg_temp.occ(3), pg_temp.occ(4))),
          array['16110000-0000-0000-0000-000000000001']::uuid[], 'by whoever had done them');
select is(pg_temp.posts(pg_temp.occ(1)), array['earn 5', 'reversal -5', 'earn 5'], 'their points are earned again');
select is(pg_temp.balance(), 25, 'the balance is back to 25');

select pg_temp.as_user('16100000-0000-0000-0000-000000000001');
select is(public.undo_uncheck_batch('16ba0000-0000-0000-0000-00000000000b'),
          '{"restored": 0, "unchanged": 4}'::jsonb, 'putting it back twice does nothing more');
select is(public.undo_uncheck_batch('16ba0000-0000-0000-0000-0000000000c1'),
          '{"restored": 0, "unchanged": 1}'::jsonb, 'an item checked off again since is left as it is');
select is(public.undo_uncheck_batch('16ba0000-0000-0000-0000-0000000000d1'),
          '{"restored": 1, "unchanged": 0}'::jsonb, 'a past day''s uncheck is put back too');
select pg_temp.as_nobody();
select is(pg_temp.statuses(array[pg_temp.occ(1, pg_temp.today() - 1), pg_temp.occ(5)]), array['approved', 'completed'],
          '... done again, while the item checked off since stays as the board left it');

select * from finish();
rollback;
