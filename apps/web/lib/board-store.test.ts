import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { openBoardStore } from './board-store';
import type { CompletionEvent } from './outbox';

const event = (n: number): CompletionEvent => ({
  id: `e${n}`,
  occurrence_id: `o${n}`,
  event_type: 'complete',
  occurred_at: `2026-10-10T07:0${n}:00Z`,
  done_by: ['m1'],
});
let names = 0;
const fresh = () => `board-test-${++names}`;

describe('the board store (IndexedDB)', () => {
  it('[DEV-06][NFR-01] keeps queued events in the order they were made, across a reload', async () => {
    const name = fresh();
    const first = openBoardStore('d1', name)!;
    for (const n of [3, 1, 2]) await first.outbox.add(event(n));
    // The same event again (a retry) is kept once.
    await first.outbox.add(event(1));
    const reloaded = openBoardStore('d1', name)!;
    expect((await reloaded.outbox.load()).map((e) => e.id)).toEqual(['e3', 'e1', 'e2']);
    await reloaded.outbox.remove(['e3', 'e2']);
    expect(await openBoardStore('d1', name)!.outbox.load()).toEqual([event(1)]);
  });

  it('[NFR-01] keeps the last snapshot and what the board showed ahead of it', async () => {
    const name = fresh();
    const store = openBoardStore('d1', name)!;
    expect(await store.get('snapshot')).toBeNull();
    await store.set('snapshot', { v: 1, fetchedAt: '2026-10-10T07:00:00Z' });
    await store.set('overrides', [['o1', { status: 'completed' }]]);
    const reloaded = openBoardStore('d1', name)!;
    expect(await reloaded.get('snapshot')).toEqual({ v: 1, fetchedAt: '2026-10-10T07:00:00Z' });
    expect(await reloaded.get('overrides')).toEqual([['o1', { status: 'completed' }]]);
  });

  it('[DEV-06] a board paired again as another device starts empty', async () => {
    const name = fresh();
    const old = openBoardStore('d1', name)!;
    await old.outbox.add(event(1));
    await old.set('snapshot', { v: 1 });
    const repaired = openBoardStore('d2', name)!;
    expect(await repaired.outbox.load()).toEqual([]);
    expect(await repaired.get('snapshot')).toBeNull();
  });
});
