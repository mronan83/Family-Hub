import { z } from 'zod';
import { pointsWord } from './points';

// The rewards shop (WP-18, D-53): what a board sends to ask for or cancel a reward, how the database's
// refusals read, and the parent's catalog form. The database decides everything that matters
// (who may, the balance, stock and limits); this checks shapes and finds the words.

/** [PTS-04] A board (or a parent) asks for a reward for a child; `id` is made by the caller. */
export const redemptionRequestSchema = z
  .object({ id: z.guid(), member_id: z.guid(), item_id: z.guid() })
  .strict();

/** [PTS-04] Cancelling a request still waiting for a parent. */
export const redemptionCancelSchema = z.object({ id: z.guid() }).strict();

export type RedemptionStatus = 'requested' | 'approved' | 'denied' | 'fulfilled' | 'cancelled';

/**
 * [PTS-04] A database refusal as an HTTP answer: 403 when the caller may not; 404 when the member,
 * reward or request isn't there for them; 409 for the shop's rules (not enough points, out of stock,
 * the weekly limit, no longer waiting); 400 otherwise.
 */
export function refusal(error: { code?: string | null; hint?: string | null }): {
  status: number;
  reason: string;
} {
  const reason = error.hint || 'invalid';
  if (error.code === '42501') return { status: 403, reason: 'not_allowed' };
  if (error.code === 'P0002') return { status: 404, reason };
  if (
    [
      'not_enough_points',
      'out_of_stock',
      'weekly_limit',
      'not_earning',
      'request_reused',
      'not_requested',
      'not_cancellable',
      'not_approved',
    ].includes(reason)
  ) {
    return { status: 409, reason };
  }
  return { status: 400, reason };
}

/** A redemption's state in the admin's words (06 §2: plain and neutral). */
export const STATUS_WORDS: Record<RedemptionStatus, string> = {
  requested: 'Asked for',
  approved: 'Approved, to give',
  denied: 'Not this time',
  fulfilled: 'Given',
  cancelled: 'Cancelled',
};

/** "Movie night · 100 points · 1 left · once a week". */
export function itemFacts(i: {
  costPoints: number;
  stockLeft: number | null;
  weeklyLimit: number | null;
}): string {
  return [
    pointsWord(i.costPoints),
    i.stockLeft === null ? null : i.stockLeft === 0 ? 'none left' : `${i.stockLeft} left`,
    i.weeklyLimit === null ? null : i.weeklyLimit === 1 ? 'once a week' : `${i.weeklyLimit} a week`,
  ]
    .filter(Boolean)
    .join(' · ');
}

export interface CatalogInput {
  title: string;
  description: string | null;
  icon: string;
  costPoints: number;
  stock: number | null;
  weeklyLimit: number | null;
  active: boolean;
}

export type ParsedCatalog = { ok: true; value: CatalogInput } | { ok: false; message: string };

const whole = (raw: FormDataEntryValue | null, min: number, max: number): number | null | 'bad' => {
  const s = String(raw ?? '').trim();
  if (s === '') return null;
  if (!/^\d+$/.test(s)) return 'bad';
  const n = Number(s);
  return n >= min && n <= max ? n : 'bad';
};

/** [PTS-03] The catalog form, or a line saying what to fix. Blank stock or limit means none. */
export function parseCatalog(form: FormData, icons: readonly string[]): ParsedCatalog {
  const title = String(form.get('title') ?? '').trim();
  if (title.length < 1 || title.length > 80) {
    return { ok: false, message: 'Give it a name, up to 80 characters.' };
  }
  const description = String(form.get('description') ?? '').trim();
  if (description.length > 300) {
    return { ok: false, message: 'Keep the description to 300 characters.' };
  }
  const cost = whole(form.get('costPoints'), 1, 100_000);
  if (cost === null || cost === 'bad') {
    return { ok: false, message: 'Give it a cost of 1 to 100,000 points.' };
  }
  const stock = whole(form.get('stock'), 0, 100_000);
  if (stock === 'bad')
    return { ok: false, message: 'Stock is a whole number, or blank for no limit.' };
  const weekly = whole(form.get('weeklyLimit'), 1, 100);
  if (weekly === 'bad') {
    return { ok: false, message: 'A weekly limit is 1 to 100, or blank for none.' };
  }
  const icon = String(form.get('icon') ?? 'gift');
  return {
    ok: true,
    value: {
      title,
      description: description || null,
      icon: icons.includes(icon) ? icon : 'gift',
      costPoints: cost,
      stock,
      weeklyLimit: weekly,
      active: form.get('active') === 'on',
    },
  };
}

export const PHOTO_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/** [PTS-03] A photo the shop takes: JPEG, PNG or WebP up to 2 MB; null when none was chosen. */
export function checkPhoto(file: unknown): { ext: string } | null | string {
  if (!(file instanceof Blob) || file.size === 0) return null;
  const ext = PHOTO_TYPES[file.type];
  if (!ext) return 'Use a JPEG, PNG or WebP photo.';
  if (file.size > MAX_PHOTO_BYTES) return 'Use a photo up to 2 MB.';
  return { ext };
}
