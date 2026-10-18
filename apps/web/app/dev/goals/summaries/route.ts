import { formOf, liveRequestSchema } from '@/lib/goal-live';
import { devLiveGoal } from '../live';

// [NFR-16][D-128] The /dev goal forms' live summaries (WP-101, WP-110), as POST /api/goals/summaries
// answers them, on the made-up family's facts with no database.
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const parsed = liveRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid request' }, { status: 400 });
  return Response.json({ summaries: await devLiveGoal(formOf(parsed.data.form)) });
}
