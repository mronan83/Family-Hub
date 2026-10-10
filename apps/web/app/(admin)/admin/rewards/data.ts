import type { IconName } from '@familywise/ui';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BonusRule, BonusRuleType } from '@/lib/bonus';
import type { RedemptionStatus } from '@/lib/rewards';

// The rewards shop (WP-18), read through RLS as the admin. Photos are private: each comes with a
// signed link that lasts an hour. Also the bonus rules and what each child is saving for (WP-30).

/** The icons a reward can take (06 §5), gift first. */
export const REWARD_ICONS: IconName[] = [
  'gift',
  'ticket',
  'star',
  'trophy',
  'sparkles',
  'utensils',
  'snack',
  'moon',
  'sun',
  'calendar',
];

export interface RewardRow {
  id: string;
  title: string;
  description: string | null;
  icon: IconName;
  imagePath: string | null;
  /** A signed link to the photo, or null. */
  imageUrl: string | null;
  costPoints: number;
  stock: number | null;
  /** Stock less what is asked for, approved or given; null for no limit. */
  stockLeft: number | null;
  weeklyLimit: number | null;
  active: boolean;
  archivedAt: string | null;
}

export interface RedemptionRow {
  id: string;
  memberId: string;
  itemId: string;
  cost: number;
  status: RedemptionStatus;
  requestedAt: string;
  decidedAt: string | null;
  fulfilledAt: string | null;
  cancelledAt: string | null;
  note: string | null;
}

/** [PTS-03] The household's rewards, with what is left of each one's stock and its photo's link. */
export async function loadCatalog(db: SupabaseClient, householdId: string): Promise<RewardRow[]> {
  const [items, taken] = await Promise.all([
    db
      .from('reward_catalog_item')
      .select(
        'id, title, description, icon, image_path, cost_points, stock, weekly_limit, active, archived_at',
      )
      .eq('household_id', householdId)
      .order('sort_order')
      .order('title'),
    db
      .from('redemption')
      .select('catalog_item_id')
      .eq('household_id', householdId)
      .in('status', ['requested', 'approved', 'fulfilled']),
  ]);
  if (items.error) throw new Error(`rewards: ${items.error.message}`);
  if (taken.error) throw new Error(`redemptions: ${taken.error.message}`);
  const used = new Map<string, number>();
  for (const r of taken.data as { catalog_item_id: string }[]) {
    used.set(r.catalog_item_id, (used.get(r.catalog_item_id) ?? 0) + 1);
  }
  const rows = items.data as {
    id: string;
    title: string;
    description: string | null;
    icon: IconName;
    image_path: string | null;
    cost_points: number;
    stock: number | null;
    weekly_limit: number | null;
    active: boolean;
    archived_at: string | null;
  }[];
  const paths = rows.map((r) => r.image_path).filter((p): p is string => p !== null);
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data } = await db.storage.from('rewards').createSignedUrls(paths, 3600);
    for (const s of data ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    icon: r.icon,
    imagePath: r.image_path,
    imageUrl: r.image_path ? (urls.get(r.image_path) ?? null) : null,
    costPoints: r.cost_points,
    stock: r.stock,
    stockLeft: r.stock === null ? null : Math.max(0, r.stock - (used.get(r.id) ?? 0)),
    weeklyLimit: r.weekly_limit,
    active: r.active,
    archivedAt: r.archived_at,
  }));
}

/** [PTS-04] The household's latest requests, newest first. */
export async function loadRedemptions(
  db: SupabaseClient,
  householdId: string,
): Promise<RedemptionRow[]> {
  const { data, error } = await db
    .from('redemption')
    .select(
      'id, member_id, catalog_item_id, cost_snapshot, status, requested_at, decided_at, fulfilled_at, cancelled_at, note',
    )
    .eq('household_id', householdId)
    .order('requested_at', { ascending: false })
    .limit(60);
  if (error) throw new Error(`redemptions: ${error.message}`);
  return (
    data as {
      id: string;
      member_id: string;
      catalog_item_id: string;
      cost_snapshot: number;
      status: RedemptionStatus;
      requested_at: string;
      decided_at: string | null;
      fulfilled_at: string | null;
      cancelled_at: string | null;
      note: string | null;
    }[]
  ).map((r) => ({
    id: r.id,
    memberId: r.member_id,
    itemId: r.catalog_item_id,
    cost: r.cost_snapshot,
    status: r.status,
    requestedAt: r.requested_at,
    decidedAt: r.decided_at,
    fulfilledAt: r.fulfilled_at,
    cancelledAt: r.cancelled_at,
    note: r.note,
  }));
}

/** [PTS-05] The household's bonus rules, the ones still in use first, oldest first. */
export async function loadBonusRules(
  db: SupabaseClient,
  householdId: string,
): Promise<BonusRule[]> {
  const { data, error } = await db
    .from('points_rule')
    .select('id, rule_type, streak_days, bonus_points, counts_from, active, archived_at')
    .eq('household_id', householdId)
    .order('created_at')
    .order('id');
  if (error) throw new Error(`bonus rules: ${error.message}`);
  return (
    data as {
      id: string;
      rule_type: BonusRuleType;
      streak_days: number | null;
      bonus_points: number;
      counts_from: string;
      active: boolean;
      archived_at: string | null;
    }[]
  ).map((r) => ({
    id: r.id,
    ruleType: r.rule_type,
    streakDays: r.streak_days,
    bonusPoints: r.bonus_points,
    countsFrom: r.counts_from,
    active: r.active,
    archivedAt: r.archived_at,
  }));
}

/** [PTS-06] What each child is saving for: member id to reward id. */
export async function loadWishes(
  db: SupabaseClient,
  householdId: string,
): Promise<Map<string, string>> {
  const { data, error } = await db
    .from('wishlist_pin')
    .select('member_id, catalog_item_id')
    .eq('household_id', householdId);
  if (error) throw new Error(`wishes: ${error.message}`);
  return new Map(
    (data as { member_id: string; catalog_item_id: string }[]).map((w) => [
      w.member_id,
      w.catalog_item_id,
    ]),
  );
}
