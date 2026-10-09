// [NFR-07] Job schedules as code (01 §5.6): validation rules and the SQL the deploy runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSchedule, minutesOf, schedulesSql, validate } from './job-schedules.mjs';

const http = (name, cron, extra = {}) => ({ name, kind: 'http', cron, everyMinutes: 60, ...extra });

test('[NFR-07] the committed schedule is valid', () => {
  assert.deepEqual(validate(loadSchedule()), []);
});

test('[NFR-07] minutes of a cron expression', () => {
  assert.deepEqual([...minutesOf('17 * * * *')], [17]);
  assert.deepEqual([...minutesOf('*/15 * * * *')], [0, 15, 30, 45]);
  assert.deepEqual([...minutesOf('2/20 * * * *')], [2, 22, 42]);
  assert.deepEqual([...minutesOf('0-20/10,59 * * * *')], [0, 10, 20, 59]);
});

test('[NFR-07] two HTTP jobs may not share a minute; SQL jobs may', () => {
  assert.match(
    validate([http('a', '*/5 * * * *'), http('b', '10 * * * *')]).join(),
    /share minute\(s\) 10/,
  );
  assert.deepEqual(validate([http('a', '*/5 * * * *'), http('b', '2/5 * * * *')]), []);
  const sql = { name: 'c', kind: 'sql', cron: '10 3 * * *', everyMinutes: 1440, sql: 'select 1' };
  assert.deepEqual(validate([http('a', '*/5 * * * *'), sql]), []);
});

test('[NFR-07] malformed entries are reported', () => {
  const errors = validate([
    http('Bad-Name', '1 * * * *'),
    http('dup', '2 * * * *'),
    http('dup', '3 * * * *'),
    http('short', '* * *'),
    http('minute', '75 * * * *'),
    http('cadence', '4 * * * *', { everyMinutes: 0 }),
    http('with_sql', '5 * * * *', { sql: 'select 1' }),
    { name: 'no_sql', kind: 'sql', cron: '6 * * * *', everyMinutes: 60 },
    { name: 'tagged', kind: 'sql', cron: '7 * * * *', everyMinutes: 60, sql: 'select $job$' },
    { name: 'kind', kind: 'edge', cron: '8 * * * *', everyMinutes: 60 },
  ]).join('\n');
  for (const expected of [
    /"Bad-Name": name must be snake_case/,
    /"dup": listed twice/,
    /"short": cron must have five fields/,
    /"minute": cron minutes must be 0 to 59/,
    /"cadence": everyMinutes/,
    /"with_sql": an http job has no sql/,
    /"no_sql": a sql job needs sql/,
    /"tagged": sql must not contain/,
    /"kind": kind must be http or sql/,
  ]) {
    assert.match(errors, expected);
  }
});

test('[NFR-07] the SQL schedules every job, records cadence, and removes only its own stale jobs', () => {
  const sql = schedulesSql([
    http('heartbeat', '17 * * * *'),
    {
      name: 'purge',
      kind: 'sql',
      cron: '43 3 * * *',
      everyMinutes: 1440,
      sql: "delete from t where x = 'y'",
    },
  ]);
  assert.match(
    sql,
    /select cron\.schedule\('familywise-heartbeat', '17 \* \* \* \*', \$job\$select private\.call_job\('heartbeat'\)\$job\$\);/,
  );
  assert.match(
    sql,
    /select cron\.schedule\('familywise-purge', '43 3 \* \* \*', \$job\$delete from t where x = 'y'\$job\$\);/,
  );
  assert.match(sql, /\('heartbeat', '17 \* \* \* \*', 'http', 60, now\(\)\)/);
  assert.match(
    sql,
    /delete from private\.job_schedule where job_type not in \('heartbeat', 'purge'\);/,
  );
  assert.match(
    sql,
    /jobname like 'familywise-%' and jobname not in \('familywise-heartbeat', 'familywise-purge'\)/,
  );
});

test('[NFR-07] an invalid schedule produces no SQL', () => {
  assert.throws(
    () => schedulesSql([http('a', '1 * * * *'), http('b', '1 * * * *')]),
    /share minute/,
  );
});

test('[NFR-07] quotes in names or cron cannot break out of the SQL', () => {
  // Names are snake_case by validation, so the only free text is a SQL job's own command.
  assert.throws(() => schedulesSql([http("x'; drop table t; --", '1 * * * *')]), /snake_case/);
});
