import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type Answer,
  type CompletionEvent,
  createOutbox,
  postCompletions,
  RETRY_MS,
} from './outbox';

const event = (n: number): CompletionEvent => ({
  id: `e${n}`,
  occurrence_id: `o${n}`,
  event_type: 'complete',
  occurred_at: '2026-10-09T13:00:00Z',
  done_by: ['m1'],
});
const recorded = (e: CompletionEvent): Answer => ({
  id: e.id,
  result: 'recorded',
  reason: null,
  occurrence: null,
});

describe('the board outbox', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('[CHR-04] sends a check-off at once and hands back its answer', async () => {
    const post = vi.fn(async (events: CompletionEvent[]) => events.map(recorded));
    const answers: Answer[] = [];
    const outbox = createOutbox(post, (a) => answers.push(a));
    outbox.send(event(1));
    await vi.runAllTimersAsync();
    expect(post).toHaveBeenCalledWith([event(1)]);
    expect(answers.map((a) => a.id)).toEqual(['e1']);
    expect(outbox.pending()).toBe(0);
  });

  it('[NFR-01] retries with the same event id until it is answered, so a resend counts once', async () => {
    let calls = 0;
    const post = vi.fn(async (events: CompletionEvent[]) => {
      calls += 1;
      if (calls < 3) throw new Error('offline');
      return events.map(recorded);
    });
    const answers: Answer[] = [];
    const outbox = createOutbox(post, (a) => answers.push(a));
    outbox.send(event(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(outbox.pending()).toBe(1);
    await vi.advanceTimersByTimeAsync(RETRY_MS[0]! + RETRY_MS[1]!);
    expect(post).toHaveBeenCalledTimes(3);
    expect(post.mock.calls.every(([events]) => events[0]!.id === 'e1')).toBe(true);
    expect(answers).toHaveLength(1);
    expect(outbox.pending()).toBe(0);
  });

  it('[CHR-04] keeps events in order: those queued while a batch is out go next, together', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const post = vi.fn(async (events: CompletionEvent[]) => {
      if (post.mock.calls.length === 1) await gate;
      return events.map(recorded);
    });
    const answers: string[] = [];
    const outbox = createOutbox(post, (a) => answers.push(a.id));
    outbox.send(event(1));
    outbox.send(event(2));
    outbox.send(event(3));
    release();
    await vi.runAllTimersAsync();
    expect(post.mock.calls.map(([events]) => events.map((e) => e.id))).toEqual([
      ['e1'],
      ['e2', 'e3'],
    ]);
    expect(answers).toEqual(['e1', 'e2', 'e3']);
  });

  it('[NFR-01] a send while a retry waits goes with the retry', async () => {
    let fail = true;
    const post = vi.fn(async (events: CompletionEvent[]) => {
      if (fail) throw new Error('offline');
      return events.map(recorded);
    });
    const outbox = createOutbox(post, () => undefined);
    outbox.send(event(1));
    await vi.advanceTimersByTimeAsync(0);
    outbox.send(event(2));
    expect(post).toHaveBeenCalledTimes(1);
    fail = false;
    await vi.advanceTimersByTimeAsync(RETRY_MS[0]!);
    expect(post.mock.calls.at(-1)![0].map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(outbox.pending()).toBe(0);
  });

  it('stops cleanly when the board leaves', async () => {
    const post = vi.fn(async () => {
      throw new Error('offline');
    });
    const outbox = createOutbox(post, () => undefined);
    outbox.send(event(1));
    await vi.advanceTimersByTimeAsync(0);
    outbox.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe('the board sender', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('[CHR-04] posts JSON to /api/completions and reads each answer', async () => {
    const fetch = vi.fn(async () => Response.json({ results: [recorded(event(1))] }));
    vi.stubGlobal('fetch', fetch);
    expect(await postCompletions([event(1)])).toEqual([recorded(event(1))]);
    expect(fetch).toHaveBeenCalledWith(
      '/api/completions',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('[CHR-04] answers a refused batch as invalid (retrying cannot help); retries a server fault', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'invalid events' }, { status: 400 })),
    );
    expect(await postCompletions([event(1)])).toEqual([
      { id: 'e1', result: 'invalid', reason: 'bad_request', occurrence: null },
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 })),
    );
    await expect(postCompletions([event(1)])).rejects.toThrow('503');
  });
});
