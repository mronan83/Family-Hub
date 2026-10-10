import { describeIssues } from '@/lib/completions';
import { refusal } from '@/lib/rewards';
import { serverClient } from '@/lib/supabase/server';
import { wishPinSchema } from '@/lib/wishes';

// [PTS-06] POST /api/wishes (01 §5.7): a board pins the reward a child is saving for, or takes it off,
// as the board, through pin_wish(): only for a child who earns rewards, and only a reward in the shop.
// Pinning the same one again changes nothing. JSON only, so no form on another site can post here.
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
  const parsed = wishPinSchema.safeParse(body);
  if (!parsed.success)
    return json(400, { error: 'invalid request', issues: describeIssues(parsed.error) });

  const { member_id, item_id } = parsed.data;
  const { data, error } = await db.rpc('pin_wish', { p_member: member_id, p_item: item_id });
  if (error) {
    const r = refusal(error);
    // Anything the shop's rules don't explain is a server error: System Health keeps it.
    if (r.status === 400 && r.reason === 'invalid') throw new Error(`pin wish: ${error.message}`);
    return json(r.status, { error: r.reason });
  }
  return json(200, { wish: data });
}
