import type { SupabaseClient } from '@supabase/supabase-js';
import webpush from 'web-push';

// Reminders by web push (WP-40, D-58): the job's side. The database plans each household's reminders
// whose time has come and claims those now due (marking each sent before it goes, so a retry never
// sends twice); this sends each claimed one to each of the person's devices and records how each
// answered. Relative imports only: the e2e runner runs this against a mocked push service.

/** The VAPID key pair and contact the push services know us by (01 §9.8). */
export interface Vapid {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** The deployment's VAPID keys, or null where they aren't set (previews hold no private key). */
export function vapidFromEnv(env: Record<string, string | undefined> = process.env): Vapid | null {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

/** A browser's push subscription, as the database keeps it. */
export interface Device {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** What the notification says, and where tapping it goes. */
export interface Payload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/** A reminder the database claimed: marked sent, to go to each device. */
export interface Claimed {
  delivery_id: string;
  member_id: string;
  kind: 'due' | 'digest';
  payload: Payload;
  devices: Device[];
}

/** An encrypted push message, ready for the push service. */
export interface PushRequest {
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  body: Buffer | null;
}

/** Delivers a push message and answers the push service's HTTP status. */
export type Transport = (request: PushRequest) => Promise<number>;

/** The push services themselves, over HTTPS, waiting at most 10 seconds. */
export const fetchTransport: Transport = async (r) => {
  const res = await fetch(r.endpoint, {
    method: r.method,
    headers: r.headers,
    body: r.body ? new Uint8Array(r.body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  return res.status;
};

/** Sends one payload to one device; answers the status, or 0 when the service couldn't be reached. */
export type Send = (device: Device, payload: Payload) => Promise<number>;

/**
 * [CHR-15] Web push with VAPID (RFC 8292) and an encrypted payload (RFC 8291), through a transport.
 * A reminder that waited four hours is no use, so push services may drop it after that.
 */
export function webPushSender(vapid: Vapid, transport: Transport = fetchTransport): Send {
  return async (device, payload) => {
    const request = webpush.generateRequestDetails(
      { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
      JSON.stringify(payload),
      { vapidDetails: vapid, TTL: 4 * 3600, urgency: 'high' },
    );
    try {
      return await transport({
        endpoint: request.endpoint,
        method: request.method,
        headers: request.headers as Record<string, string>,
        body: (request.body as Buffer | null) ?? null,
      });
    } catch {
      return 0;
    }
  };
}

export interface ReminderStats {
  planned: number;
  digests: number;
  pruned: number;
  /** Reminders claimed and sent. */
  sent: number;
  /** Device answers: accepted, gone (deleted) and failed. */
  delivered: number;
  gone: number;
  failed: number;
}

/**
 * [CHR-16][CHR-17] One run for a household at `now`: plan, claim, send, record. Without keys (no
 * `send`) nothing is claimed, and reminders waiting to go fail the run, so System Health says so.
 */
export async function runReminders(
  db: SupabaseClient,
  householdId: string,
  now: Date,
  send: Send | null,
): Promise<ReminderStats> {
  const at = now.toISOString();
  const { data: plan, error } = await db.rpc('plan_reminders', {
    p_household: householdId,
    p_now: at,
  });
  if (error) throw new Error(`plan reminders: ${error.message}`);
  const stats: ReminderStats = {
    ...(plan as { planned: number; digests: number; pruned: number }),
    sent: 0,
    delivered: 0,
    gone: 0,
    failed: 0,
  };
  if (!send) {
    const { count, error: cError } = await db
      .from('reminder_delivery')
      .select('id', { count: 'exact', head: true })
      .eq('household_id', householdId)
      .eq('status', 'held')
      .lte('scheduled_for', at);
    if (cError) throw new Error(`count reminders: ${cError.message}`);
    if (count) throw new Error(`web push keys are not set: ${count} reminder(s) waiting to go`);
    return stats;
  }

  const { data: claimed, error: claimError } = await db.rpc('claim_reminders', {
    p_household: householdId,
    p_now: at,
  });
  if (claimError) throw new Error(`claim reminders: ${claimError.message}`);
  for (const c of (claimed ?? []) as Claimed[]) {
    stats.sent += 1;
    const results = await Promise.all(
      c.devices.map(async (d) => ({ id: d.id, status: await send(d, c.payload) })),
    );
    const { data: done, error: fError } = await db.rpc('finish_reminder', {
      p_delivery: c.delivery_id,
      p_results: results,
    });
    if (fError) throw new Error(`finish reminder: ${fError.message}`);
    const d = done as { delivered: number; gone: number; failed: number };
    stats.delivered += d.delivered;
    stats.gone += d.gone;
    stats.failed += d.failed;
  }
  return stats;
}
