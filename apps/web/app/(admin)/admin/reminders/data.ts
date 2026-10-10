import type { SupabaseClient } from '@supabase/supabase-js';
import { readSettings, type ReminderSettings } from '@/lib/reminder-settings';

// A person's own reminder settings and devices (WP-40), read through RLS: nobody else's are visible.

export interface DeviceRow {
  id: string;
  label: string;
  enabled: boolean;
  createdAt: string;
  lastSuccessAt: string | null;
  failureCount: number;
}

/** [CHR-15][CHR-16][CHR-17] The signed-in person's settings (the defaults until they save any). */
export async function loadSettings(
  db: SupabaseClient,
  memberId: string,
): Promise<ReminderSettings> {
  const { data, error } = await db
    .from('reminder_preference')
    .select(
      'enabled, default_on, default_lead_minutes, morning_time, digest_time, quiet_start, quiet_end, hide_private_titles',
    )
    .eq('member_id', memberId)
    .maybeSingle();
  if (error) throw new Error(`reminder settings: ${error.message}`);
  return readSettings(data);
}

/** [CHR-15] The signed-in person's devices, oldest first. */
export async function loadDevices(db: SupabaseClient, memberId: string): Promise<DeviceRow[]> {
  const { data, error } = await db
    .from('push_subscription')
    .select('id, device_label, enabled, created_at, last_success_at, failure_count')
    .eq('member_id', memberId)
    .order('created_at');
  if (error) throw new Error(`devices: ${error.message}`);
  return (
    data as {
      id: string;
      device_label: string;
      enabled: boolean;
      created_at: string;
      last_success_at: string | null;
      failure_count: number;
    }[]
  ).map((d) => ({
    id: d.id,
    label: d.device_label,
    enabled: d.enabled,
    createdAt: d.created_at,
    lastSuccessAt: d.last_success_at,
    failureCount: d.failure_count,
  }));
}

/** [CHR-16] Each item's bell for this person: chore id to true, false, or null (their default). */
export async function loadBells(
  db: SupabaseClient,
  householdId: string,
  memberId: string,
): Promise<Map<string, boolean | null>> {
  const { data, error } = await db
    .from('chore_assignee')
    .select('chore_id, remind')
    .eq('household_id', householdId)
    .eq('member_id', memberId);
  if (error) throw new Error(`bells: ${error.message}`);
  return new Map(
    (data as { chore_id: string; remind: boolean | null }[]).map((r) => [r.chore_id, r.remind]),
  );
}
