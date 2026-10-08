-- [NFR-08] The keepalive heartbeat is writable by the deploy role and invisible to app users.
begin;
select plan(3);

insert into private.heartbeat (source) values ('test')
  on conflict (source) do update set beat_at = now(), beats = private.heartbeat.beats + 1;
insert into private.heartbeat (source) values ('test')
  on conflict (source) do update set beat_at = now(), beats = private.heartbeat.beats + 1;
select is((select beats from private.heartbeat where source = 'test'), 2::bigint,
  '[NFR-08] the keepalive upsert counts beats');

set local role authenticated;
select throws_ok('select * from private.heartbeat', '42501', null,
  '[NFR-04] signed-in users cannot read the heartbeat');
reset role;
set local role anon;
select throws_ok('select * from private.heartbeat', '42501', null,
  '[NFR-04] anon cannot read the heartbeat');
reset role;

select * from finish();
rollback;
