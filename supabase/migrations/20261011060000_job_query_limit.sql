-- [NFR-07] A 60-second limit on each query the jobs make (D-76). The jobs reach the database as
-- `service_role` (through the API, with the secret key), which Supabase leaves without a statement
-- timeout, unlike `anon` and `authenticated`. On 11 Oct 2026 queries stuck from 05:06 UTC held the
-- shared database until it was restarted by hand at about 11:00, and every job and board waited
-- behind them. With a limit, a stuck query is cancelled after a minute: its run fails and says so
-- on System Health, the job's next run starts clean, and nothing else waits on it. The slowest job
-- query seen is well under a second, so a minute is far above what any job needs.
--
-- The API applies a role's settings when it takes the role, and reloads them on this notice.
-- Migrations, backups and pg_cron run as other roles and are not limited.
alter role service_role set statement_timeout = '60s';
notify pgrst, 'reload config';
