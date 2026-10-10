import type { SupabaseClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { describe, expect, it, vi } from 'vitest';
import { browserKeys, decryptPush, mockPushService } from '../../../e2e/support/push';
import { type Claimed, runReminders, vapidFromEnv, webPushSender } from './reminders';

const VAPID = { ...webpush.generateVAPIDKeys(), subject: 'https://family.example' };

describe('web push', () => {
  it('[CHR-15] the keys come from the deployment; without all three, nothing is sent', () => {
    expect(
      vapidFromEnv({
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'pub',
        VAPID_PRIVATE_KEY: 'priv',
        VAPID_SUBJECT: 'mailto:a@b.c',
      }),
    ).toEqual({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:a@b.c' });
    expect(vapidFromEnv({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'pub' })).toBeNull();
  });

  it('[CHR-15] a reminder goes signed (VAPID) and encrypted: only the browser can read it', async () => {
    const browser = browserKeys();
    const push = mockPushService();
    const send = webPushSender(VAPID, push.transport);
    const payload = {
      title: 'Call the plumber',
      body: 'Due at 3:00 pm',
      url: '/admin/my',
      tag: 't',
    };
    const status = await send(
      {
        id: 'd1',
        endpoint: 'https://push.example/abc',
        p256dh: browser.p256dh,
        auth: browser.auth,
      },
      payload,
    );
    expect(status).toBe(201);
    const [m] = push.received;
    expect(m!.endpoint).toBe('https://push.example/abc');
    expect(m!.headers.Authorization).toMatch(new RegExp(`^vapid t=.+, k=${VAPID.publicKey}$`));
    expect(m!.headers['Content-Encoding']).toBe('aes128gcm');
    expect(m!.body!.toString('utf8')).not.toContain('plumber');
    expect(JSON.parse(decryptPush(m!.body!, browser.ecdh, browser.authBytes))).toEqual(payload);
  });

  it('[CHR-15] a push service that cannot be reached answers 0', async () => {
    const browser = browserKeys();
    const send = webPushSender(VAPID, async () => {
      throw new TypeError('fetch failed');
    });
    expect(
      await send(
        {
          id: 'd1',
          endpoint: 'https://push.example/x',
          p256dh: browser.p256dh,
          auth: browser.auth,
        },
        { title: 't', body: 'b', url: '/', tag: 't' },
      ),
    ).toBe(0);
  });
});

describe('a reminders run', () => {
  const claimed = (n: number, devices: string[]): Claimed => ({
    delivery_id: `r${n}`,
    member_id: 'm1',
    kind: 'due',
    payload: { title: `Item ${n}`, body: 'Due at 3:00 pm', url: '/admin/my', tag: `due:${n}` },
    devices: devices.map((id) => ({
      id,
      endpoint: `https://push.example/${id}`,
      p256dh: 'p',
      auth: 'a',
    })),
  });

  function db(claims: Claimed[], held = 0) {
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'plan_reminders')
        return { data: { planned: 2, digests: 0, pruned: 0 }, error: null };
      if (name === 'claim_reminders') return { data: claims, error: null };
      const results = args.p_results as { status: number }[];
      return {
        data: {
          delivered: results.filter((r) => r.status === 201).length,
          gone: results.filter((r) => r.status === 410).length,
          failed: results.filter((r) => r.status !== 201 && r.status !== 410).length,
        },
        error: null,
      };
    });
    const count = { count: held, error: null };
    const chain = { select: () => chain, eq: () => chain, lte: async () => count };
    return { client: { rpc, from: () => chain } as unknown as SupabaseClient, rpc };
  }

  it('[CHR-16] plans, claims, sends each to each device, and records how each answered', async () => {
    const { client, rpc } = db([claimed(1, ['phone', 'laptop']), claimed(2, ['gone'])]);
    const send = vi.fn(async (d: { id: string }) => (d.id === 'gone' ? 410 : 201));
    const now = new Date('2026-10-10T19:45:00Z');
    const stats = await runReminders(client, 'h1', now, send);
    expect(rpc).toHaveBeenCalledWith('plan_reminders', {
      p_household: 'h1',
      p_now: now.toISOString(),
    });
    expect(send).toHaveBeenCalledTimes(3);
    expect(rpc).toHaveBeenCalledWith('finish_reminder', {
      p_delivery: 'r1',
      p_results: [
        { id: 'phone', status: 201 },
        { id: 'laptop', status: 201 },
      ],
    });
    expect(rpc).toHaveBeenCalledWith('finish_reminder', {
      p_delivery: 'r2',
      p_results: [{ id: 'gone', status: 410 }],
    });
    expect(stats).toEqual({
      planned: 2,
      digests: 0,
      pruned: 0,
      sent: 2,
      delivered: 2,
      gone: 1,
      failed: 0,
    });
  });

  it('[CHR-15] without keys nothing is claimed; reminders waiting fail the run', async () => {
    const quiet = db([], 0);
    expect((await runReminders(quiet.client, 'h1', new Date(), null)).sent).toBe(0);
    expect(quiet.rpc).not.toHaveBeenCalledWith('claim_reminders', expect.anything());
    const waiting = db([], 2);
    await expect(runReminders(waiting.client, 'h1', new Date(), null)).rejects.toThrow(
      'web push keys are not set: 2 reminder(s) waiting to go',
    );
  });

  it('[NFR-06] a database refusal fails the run', async () => {
    const client = {
      rpc: vi.fn(async () => ({ data: null, error: { message: 'permission denied' } })),
    } as unknown as SupabaseClient;
    await expect(runReminders(client, 'h1', new Date(), vi.fn())).rejects.toThrow(
      'plan reminders: permission denied',
    );
  });
});
