import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type Answer,
  type CompletionEvent,
  createOutbox,
  memoryStore,
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

  it('[DEV-06] keeps each event in its store until it is answered', async () => {
    let fail = true;
    const post = vi.fn(async (events: CompletionEvent[]) => {
      if (fail) throw new Error('offline');
      return events.map(recorded);
    });
    const store = memoryStore();
    const outbox = createOutbox(post, () => undefined, { store });
    outbox.send(event(1));
    outbox.send(event(2));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.events.map((e) => e.id)).toEqual(['e1', 'e2']);
    fail = false;
    await vi.advanceTimersByTimeAsync(RETRY_MS[0]!);
    expect(store.events).toEqual([]);
  });

  it('[DEV-06][NFR-01] after a reload, sends what waited first, oldest first, then what is new', async () => {
    const post = vi.fn(async (events: CompletionEvent[]) => events.map(recorded));
    const store = memoryStore([event(1), event(2)]);
    const answered: [string, string | undefined][] = [];
    const outbox = createOutbox(post, (a, e) => answered.push([a.id, e?.occurrence_id]), {
      store,
    });
    // Made before the store was read: it still goes after what waited.
    outbox.send(event(3));
    await vi.runAllTimersAsync();
    expect(post.mock.calls.flatMap(([events]) => events.map((e) => e.id))).toEqual([
      'e1',
      'e2',
      'e3',
    ]);
    // Each answer comes with its event, so the board knows the item without having made it.
    expect(answered).toEqual([
      ['e1', 'o1'],
      ['e2', 'o2'],
      ['e3', 'o3'],
    ]);
    expect(store.events).toEqual([]);
  });

  it('[NFR-01] an event both saved and sent again goes once', async () => {
    const post = vi.fn(async (events: CompletionEvent[]) => events.map(recorded));
    const store = memoryStore([event(1)]);
    const outbox = createOutbox(post, () => undefined, { store });
    outbox.send(event(1));
    await vi.runAllTimersAsync();
    expect(post.mock.calls.flatMap(([events]) => events.map((e) => e.id))).toEqual(['e1']);
  });

  it('[DEV-08] says when it is waiting to retry, and sends at once when asked (the network is back)', async () => {
    let fail = true;
    const post = vi.fn(async (events: CompletionEvent[]) => {
      if (fail) throw new Error('offline');
      return events.map(recorded);
    });
    const changes = vi.fn();
    const outbox = createOutbox(post, () => undefined, { onChange: changes });
    outbox.send(event(1));
    await vi.advanceTimersByTimeAsync(0);
    // Several failures: the next retry is 5 s away.
    await vi.advanceTimersByTimeAsync(RETRY_MS[0]! + RETRY_MS[1]!);
    expect(outbox.waiting()).toBe(true);
    expect(changes).toHaveBeenCalled();
    fail = false;
    outbox.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(post).toHaveBeenCalledTimes(4);
    expect(outbox.waiting()).toBe(false);
    expect(outbox.pending()).toBe(0);
    // Nothing waits, so asking again sends nothing.
    outbox.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(post).toHaveBeenCalledTimes(4);
  });

  it('[NFR-01] sends nothing while the browser says it is offline; sends at once when it is back', async () => {
    let online = false;
    const post = vi.fn(async (events: CompletionEvent[]) => events.map(recorded));
    const answers: Answer[] = [];
    const outbox = createOutbox(post, (a) => answers.push(a), { isOnline: () => online });
    outbox.send(event(1));
    outbox.send(event(2));
    // A day of retries offline: none of them posts, and the board says it is waiting.
    await vi.advanceTimersByTimeAsync(24 * 3600_000);
    expect(post).not.toHaveBeenCalled();
    expect(outbox.pending()).toBe(2);
    expect(outbox.waiting()).toBe(true);
    online = true;
    outbox.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith([event(1), event(2)]);
    expect(answers.map((a) => a.id)).toEqual(['e1', 'e2']);
    expect(outbox.waiting()).toBe(false);
  });

  it('[NFR-01] back online without the event, the next retry sends', async () => {
    let online = false;
    const post = vi.fn(async (events: CompletionEvent[]) => events.map(recorded));
    const outbox = createOutbox(post, () => {}, { isOnline: () => online });
    outbox.send(event(1));
    await vi.advanceTimersByTimeAsync(0);
    online = true;
    await vi.advanceTimersByTimeAsync(RETRY_MS.at(-1)!);
    expect(post).toHaveBeenCalledWith([event(1)]);
    expect(outbox.pending()).toBe(0);
  });

  it('[NFR-01] a store that fails does not stop the board', async () => {
    const post = vi.fn(async (events: CompletionEvent[]) => events.map(recorded));
    const broken = {
      load: async () => {
        throw new Error('no IndexedDB');
      },
      add: async () => {
        throw new Error('no IndexedDB');
      },
      remove: async () => {
        throw new Error('no IndexedDB');
      },
    };
    const answers: string[] = [];
    const outbox = createOutbox(post, (a) => answers.push(a.id), { store: broken });
    outbox.send(event(1));
    await vi.runAllTimersAsync();
    expect(answers).toEqual(['e1']);
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
