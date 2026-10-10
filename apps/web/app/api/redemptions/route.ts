import { describeIssues } from '@/lib/completions';
import { redemptionRequestSchema, refusal } from '@/lib/rewards';
import { serverClient } from '@/lib/supabase/server';

// [PTS-04] POST /api/redemptions (01 §5.7): a board asks for a reward for a child, as the board, under
// request_redemption()'s member lock: accepted only while their balance less what they have already
// asked for covers the cost, and the reward is offered, in stock and under its weekly limit. The
// caller's id makes asking twice one request. JSON only, so no form on another site can post here.
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
  const parsed = redemptionRequestSchema.safeParse(body);
  if (!parsed.success)
    return json(400, { error: 'invalid request', issues: describeIssues(parsed.error) });

  const { id, member_id, item_id } = parsed.data;
  const { data, error } = await db.rpc('request_redemption', {
    p_id: id,
    p_member_id: member_id,
    p_item_id: item_id,
  });
  if (error) {
    const r = refusal(error);
    // Anything the shop's rules don't explain is a server error: System Health keeps it.
    if (r.status === 400 && r.reason === 'invalid')
      throw new Error(`request redemption: ${error.message}`);
    return json(r.status, { error: r.reason });
  }
  return json(200, { redemption: data });
}
