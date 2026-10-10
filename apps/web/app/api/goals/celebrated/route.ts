import { celebratedSchema } from '@/lib/board-goals';
import { describeIssues } from '@/lib/completions';
import { serverClient } from '@/lib/supabase/server';

// [RWD-08] POST /api/goals/celebrated (D-59): a board says it has celebrated a reached goal, so no board
// celebrates that achievement again, through mark_goal_celebrated() as the board. The goal and which
// time it was reached (n) are named, so a board still showing the first time can't mark the second.
// Marked already, or not reached at n any more, answers the same: nothing more to celebrate. JSON only,
// so no form on another site can post here.
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
  const parsed = celebratedSchema.safeParse(body);
  if (!parsed.success)
    return json(400, { error: 'invalid request', issues: describeIssues(parsed.error) });

  const { goal_id, n } = parsed.data;
  const { data, error } = await db.rpc('mark_goal_celebrated', { p_goal: goal_id, p_n: n });
  if (error) {
    if (error.code === 'P0002') return json(404, { error: 'goal_not_found' });
    // Anything else is a server error: System Health keeps it.
    throw new Error(`mark goal celebrated: ${error.message}`);
  }
  return json(200, { marked: data === true });
}
