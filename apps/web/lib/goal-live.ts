import { z } from 'zod';
import type { GoalSummaries } from './goal-summaries';

// [NFR-16][D-128] The goal form's live summaries (WP-101), asked for with fetch from a route, not a
// server action (WP-110): Next runs a page's server actions one at a time, so a summary asked for
// while the form was being filled held the save ("Set the goal") behind it, and a quick fill queued
// several. A route answers beside the save, and the form drops a summary a newer one replaces.

/** Where the admin app's goal form asks (the /dev goal forms ask a stand-in on made-up facts). */
export const LIVE_PATH = '/api/goals/summaries';

/** Asks for the form's summaries; `signal` drops a request a newer one replaces. */
export type LiveSummaries = (form: FormData, signal: AbortSignal) => Promise<GoalSummaries | null>;

/** The form as name and value pairs, as a route reads it back (a file, the photo, is left out). */
export function formEntries(form: FormData): [string, string][] {
  return [...form.entries()].flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : []));
}

/** A route's body: the form's fields, JSON only (so no form on another site can post one). */
export const liveRequestSchema = z.object({
  form: z.array(z.tuple([z.string().max(200), z.string().max(20_000)])).max(1000),
});

/** The fields back as the form data the goal form's parser reads. */
export function formOf(entries: [string, string][]): FormData {
  const form = new FormData();
  for (const [k, v] of entries) form.append(k, v);
  return form;
}

/** POSTs the form to `path`; anything but an answer (a refusal, a failed network) rejects. */
export function liveFrom(path: string): LiveSummaries {
  return async (form, signal) => {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ form: formEntries(form) }),
      signal,
    });
    if (!res.ok) throw new Error(`live summaries: ${res.status}`);
    const answer = (await res.json()) as { summaries?: GoalSummaries | null };
    return answer.summaries ?? null;
  };
}
