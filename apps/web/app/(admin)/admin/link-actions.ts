'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { linkBack, linkError } from '@/lib/link-me';
import { log } from '@/lib/log';
import { serverClient } from '@/lib/supabase/server';

/**
 * [CHR-14][CHR-15][ACC-04] "This is me": links the signed-in parent's own sign-in to a member, through
 * link_my_member() as them (an adult of their household, not archived, without someone else's
 * sign-in; it moves from any other record). Back to the page it came from, saying how it went.
 */
export async function linkMe(form: FormData): Promise<void> {
  const back = linkBack(form.get('back'));
  const db = await serverClient();
  const user = await requireSignedIn(db, back);
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const { error } = await db!.rpc('link_my_member', { p_member: String(form.get('member') ?? '') });
  if (error) {
    log('warn', 'sign-in not linked', { code: error.code, hint: error.hint });
    redirect(`${back}?error=${linkError(error.hint)}`);
  }
  revalidatePath('/admin', 'layout');
  redirect(`${back}?did=linked`);
}
