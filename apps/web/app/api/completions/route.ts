import { completionBatchSchema, describeIssues } from '@/lib/completions';
import { serverClient } from '@/lib/supabase/server';

// [CHR-04][NFR-06] POST /api/completions (01 §5.2): a batch of completion events from a board, or
// from an admin, recorded as the caller under RLS by record_completions(). Idempotent on each event's
// id, so an outbox can replay a batch safely; one event's refusal never fails the others. JSON only,
// so a form on another site cannot post here with the caller's cookies.
export const dynamic = 'force-dynamic';

const json = (status: number, body: unknown) => Response.json(body, { status });

export async function POST(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return json(415, { error: 'send JSON' });
  }
  const db = await serverClient();
  if (!db) return json(503, { error: 'sign-in is off' });
  const { data: auth } = await db.auth.getClaims();
  if (!auth?.claims?.sub) return json(401, { error: 'not signed in' });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'not JSON' });
  }
  const parsed = completionBatchSchema.safeParse(body);
  if (!parsed.success) {
    return json(400, { error: 'invalid events', issues: describeIssues(parsed.error) });
  }

  const { data, error } = await db.rpc('record_completions', { p_events: parsed.data.events });
  // An unexpected database error is a server error: instrumentation keeps it for System Health.
  if (error) throw new Error(`record completions: ${error.message}`);
  return json(200, { results: data });
}
