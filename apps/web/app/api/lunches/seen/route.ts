import { describeIssues } from '@/lib/completions';
import { lunchSeenSchema } from '@/lib/lunch-picks';
import { serverClient } from '@/lib/supabase/server';

// [MEAL-09][US-707] POST /api/lunches/seen: a child taps Done on their week on the board, so a
// parent's "Sam kept Buy" lines go (seen_lunch_week()). Saying it twice changes nothing.
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
  const parsed = lunchSeenSchema.safeParse(body);
  if (!parsed.success)
    return json(400, { error: 'invalid request', issues: describeIssues(parsed.error) });
  const { data, error } = await db.rpc('seen_lunch_week', { p_member: parsed.data.member_id });
  if (error) {
    if (error.code === '42501') return json(403, { error: 'not_allowed' });
    throw new Error(`seen lunch week: ${error.message}`);
  }
  return json(200, { seen: data });
}
