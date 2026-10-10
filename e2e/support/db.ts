import { execFileSync } from 'node:child_process';

// The shared database as the e2e runner reaches it (SUPABASE_DB_URL): plain SQL, and an `rpc` like
// supabase-js's that calls a public function as the service role would (WP-40's job runs this way on
// the runner, against a mocked push service, since previews hold no job secret).

export function sql(db: string, query: string): string {
  return execFileSync('psql', [db, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', query], {
    encoding: 'utf8',
  }).trim();
}

const literal = (v: unknown): string =>
  v === null || v === undefined
    ? 'null'
    : typeof v === 'number' || typeof v === 'boolean'
      ? String(v)
      : typeof v === 'string'
        ? `'${v.replace(/'/g, "''")}'`
        : `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;

/** `rpc(name, args)` as the service role: `{data, error}`, like supabase-js. */
export function serviceRpc(db: string) {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      const call = `public.${name}(${Object.entries(args)
        .map(([k, v]) => `${k} => ${literal(v)}`)
        .join(', ')})`;
      try {
        // The claims first, in the same session; the function's answer is the last line.
        const out = sql(
          db,
          `select set_config('request.jwt.claims', '{"role":"service_role"}', false); select to_jsonb(${call})`,
        );
        return { data: JSON.parse(out.split('\n').at(-1)!), error: null };
      } catch (e) {
        return { data: null, error: { message: String(e) } };
      }
    },
  };
}
