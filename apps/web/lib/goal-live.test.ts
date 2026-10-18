import { afterEach, describe, expect, it, vi } from 'vitest';
import { formEntries, formOf, liveFrom, liveRequestSchema } from './goal-live';

// [NFR-16][D-128] The goal form's live summaries asked for from a route, not a server action (WP-110):
// the form goes as JSON and comes back as the form data the goal parser reads, with its photo left
// out, and a summary a newer one replaces can be dropped.

describe('[NFR-16-s] the live summaries route', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('[NFR-16-s] the form goes as JSON and comes back field for field; a photo is left out', () => {
    const form = new FormData();
    form.append('title', 'Homework before 6 pm');
    form.append('rule-keys', 'r1,r2');
    form.append('r1-scope-item', 'c1');
    form.append('r1-scope-item', 'c2');
    form.append('photo', new Blob(['x'], { type: 'image/png' }), 'kite.png');
    const entries = formEntries(form);
    expect(entries).toEqual([
      ['title', 'Homework before 6 pm'],
      ['rule-keys', 'r1,r2'],
      ['r1-scope-item', 'c1'],
      ['r1-scope-item', 'c2'],
    ]);
    const body = liveRequestSchema.parse(JSON.parse(JSON.stringify({ form: entries })));
    const back = formOf(body.form);
    expect(back.getAll('r1-scope-item')).toEqual(['c1', 'c2']);
    expect(back.get('title')).toBe('Homework before 6 pm');
    expect(back.has('photo')).toBe(false);
  });

  it('[NFR-16-s] a body that is not the form is refused', () => {
    expect(liveRequestSchema.safeParse({ form: 'title=x' }).success).toBe(false);
    expect(liveRequestSchema.safeParse({ form: [['title', 1]] }).success).toBe(false);
    expect(liveRequestSchema.safeParse({}).success).toBe(false);
  });

  it('[NFR-16-s] posts JSON with the signal it is given; a refusal rejects', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ summaries: { rules: [null], steps: 'x', weights: null } }),
      )
      .mockResolvedValueOnce(Response.json({ error: 'not signed in' }, { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    const live = liveFrom('/api/goals/summaries');
    const form = new FormData();
    form.append('title', 'Reading');
    const signal = new AbortController().signal;
    await expect(live(form, signal)).resolves.toEqual({ rules: [null], steps: 'x', weights: null });
    const [path, init] = fetch.mock.calls[0]!;
    expect(path).toBe('/api/goals/summaries');
    expect(init.signal).toBe(signal);
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ form: [['title', 'Reading']] });
    await expect(live(form, signal)).rejects.toThrow('live summaries: 401');
  });
});
