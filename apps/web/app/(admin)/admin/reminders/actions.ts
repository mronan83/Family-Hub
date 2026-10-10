'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/auth/messages';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { log } from '@/lib/log';
import { parseSettings, subscriptionSchema } from '@/lib/reminder-settings';
import { vapidFromEnv, webPushSender } from '@/lib/reminders';
import { serverClient } from '@/lib/supabase/server';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The signed-in admin, their household and their own member (reminders are a person's own). */
async function context() {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/reminders');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const { data: me } = await db!
    .from('member')
    .select('id')
    .eq('household_id', household.id)
    .eq('user_id', user.userId)
    .is('archived_at', null)
    .maybeSingle();
  return { db: db!, household, me: (me?.id as string | undefined) ?? null };
}

/**
 * [CHR-16][CHR-17] Saves the person's settings: the bell for new items, the lead time, the morning
 * time, the digest, quiet hours and private titles. Whether reminders are on is its own switch.
 */
export async function saveSettings(_prev: FormState, form: FormData): Promise<FormState> {
  const { db, household, me } = await context();
  if (!me) return { message: 'Link your sign-in to yourself on Members first.' };
  const parsed = parseSettings(form);
  if (!parsed.ok) return { message: parsed.message };
  const v = parsed.value;
  const { error } = await db.from('reminder_preference').upsert(
    {
      member_id: me,
      household_id: household.id,
      default_on: v.defaultOn,
      default_lead_minutes: v.defaultLeadMinutes,
      morning_time: v.morningTime,
      digest_time: v.digestTime,
      quiet_start: v.quietStart,
      quiet_end: v.quietEnd,
      hide_private_titles: v.hidePrivateTitles,
    },
    { onConflict: 'member_id' },
  );
  if (error) {
    log('warn', 'reminder settings not saved', { code: error.code });
    return { message: 'That didn’t save. Try again in a moment.' };
  }
  revalidatePath('/admin/reminders');
  redirect('/admin/reminders?did=saved');
}

/** [CHR-15] Turns the person's reminders off, or back on; their devices stay. */
export async function setReminders(form: FormData): Promise<void> {
  const { db, household, me } = await context();
  if (!me) redirect('/admin/reminders');
  const on = form.get('enabled') === 'on';
  const { error } = await db
    .from('reminder_preference')
    .upsert(
      { member_id: me, household_id: household.id, enabled: on },
      { onConflict: 'member_id' },
    );
  if (error) {
    log('warn', 'reminders not switched', { code: error.code });
    redirect('/admin/reminders?error=failed');
  }
  revalidatePath('/admin/reminders');
  redirect(`/admin/reminders?did=${on ? 'on' : 'off'}`);
}

/**
 * [CHR-15][US-317] This browser's push subscription, from "Turn on reminders" once the person has
 * allowed notifications: saved as theirs (a browser that was someone else's moves to them), and
 * their reminders turned on.
 */
export async function saveSubscription(
  subscription: unknown,
  label: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { db, household, me } = await context();
  if (!me) return { ok: false, message: 'Link your sign-in to yourself on Members first.' };
  const parsed = subscriptionSchema.safeParse(subscription);
  if (!parsed.success) return { ok: false, message: 'This browser gave an odd subscription.' };
  const name =
    String(label ?? '')
      .trim()
      .slice(0, 60) || 'This device';
  const { error } = await db.rpc('save_push_subscription', {
    p_household: household.id,
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.keys.p256dh,
    p_auth: parsed.data.keys.auth,
    p_label: name,
  });
  if (error) {
    log('warn', 'push subscription not saved', { code: error.code });
    return { ok: false, message: 'That didn’t save. Try again in a moment.' };
  }
  const { error: pError } = await db
    .from('reminder_preference')
    .upsert(
      { member_id: me, household_id: household.id, enabled: true },
      { onConflict: 'member_id' },
    );
  if (pError) log('warn', 'reminders not turned on', { code: pError.code });
  revalidatePath('/admin/reminders');
  return { ok: true };
}

const DEVICE_ACTS = ['test', 'off', 'on', 'remove'] as const;
type DeviceAct = (typeof DEVICE_ACTS)[number];

/**
 * [CHR-15][US-317] A device: send it a test, switch it off or on, or remove it. A test needs the
 * deployment's web push keys (production only); a device the push service says is gone is removed.
 */
export async function deviceAction(form: FormData): Promise<void> {
  const { db, me } = await context();
  const [act, id] = String(form.get('act') ?? '').split(':') as [DeviceAct, string];
  if (!me || !DEVICE_ACTS.includes(act) || !id || !GUID.test(id)) redirect('/admin/reminders');
  if (act === 'remove') {
    await db.from('push_subscription').delete().eq('id', id);
  } else if (act === 'off' || act === 'on') {
    await db
      .from('push_subscription')
      .update({ enabled: act === 'on' })
      .eq('id', id);
  } else {
    const vapid = vapidFromEnv();
    if (!vapid) redirect('/admin/reminders?error=no_keys');
    const { data: device } = await db
      .from('push_subscription')
      .select('id, endpoint, p256dh, auth_secret')
      .eq('id', id)
      .maybeSingle();
    if (!device) redirect('/admin/reminders?error=gone');
    const status = await webPushSender(vapid)(
      { id, endpoint: device.endpoint, p256dh: device.p256dh, auth: device.auth_secret },
      {
        title: 'FamilyWise',
        body: 'Reminders work on this device.',
        url: '/admin/reminders',
        tag: `test:${id}`,
      },
    );
    if (status === 404 || status === 410) {
      await db.from('push_subscription').delete().eq('id', id);
      redirect('/admin/reminders?error=gone');
    }
    if (status < 200 || status > 299) {
      log('warn', 'test push not accepted', { status });
      redirect('/admin/reminders?error=test_failed');
    }
    await db
      .from('push_subscription')
      .update({ last_success_at: new Date().toISOString() })
      .eq('id', id);
  }
  revalidatePath('/admin/reminders');
  const did = act === 'off' ? 'off_device' : act === 'on' ? 'on_device' : act;
  redirect(`/admin/reminders?did=${did}`);
}

/**
 * [CHR-16][US-318] The bell on an item, for the signed-in person: on or off for this item. Sent from
 * My tasks; goes back there.
 */
export async function setBell(form: FormData): Promise<void> {
  const { db } = await context();
  const [choreId, value] = String(form.get('bell') ?? '').split(':');
  const back = String(form.get('back') ?? '/admin/my');
  const to = back.startsWith('/admin/') ? back : '/admin/my';
  if (!choreId || !GUID.test(choreId) || (value !== 'on' && value !== 'off')) redirect(to);
  const { error } = await db.rpc('set_my_reminder', { p_chore: choreId, p_remind: value === 'on' });
  if (error) log('warn', 'bell not set', { code: error.code, hint: error.hint });
  revalidatePath(to.split('?')[0]!);
  redirect(`${to}${to.includes('?') ? '&' : '?'}bell=${value}&chore=${choreId}`);
}
