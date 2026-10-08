-- [NFR-12][NFR-14] The compatibility bootstrap behaves like hosted Supabase.
begin;
select plan(5);

select has_role('anon', 'anon role exists');
select has_role('authenticated', 'authenticated role exists');
select has_role('service_role', 'service_role role exists');

set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is(auth.uid(), '11111111-1111-1111-1111-111111111111'::uuid, 'auth.uid() reads the JWT subject');
select is(auth.role(), 'authenticated', 'auth.role() reads the JWT role');

select * from finish();
rollback;
