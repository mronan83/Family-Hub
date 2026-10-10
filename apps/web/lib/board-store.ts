import Dexie, { type Table } from 'dexie';
import type { CompletionEvent, OutboxStore } from './outbox';

/**
 * [DEV-06][NFR-01] What a board keeps in IndexedDB so it works through an outage and a reload
 * (01 §7, WP-13): its unanswered check-offs in order (the outbox), its last snapshot, and the
 * check-offs it is showing ahead of the snapshot. It belongs to one paired board: a board paired
 * again, as another device, starts empty, since what was queued can only be sent as the board that
 * made it.
 */
export interface BoardStore {
  outbox: OutboxStore;
  get<T>(key: SavedKey): Promise<T | null>;
  set(key: SavedKey, value: unknown): Promise<void>;
}

export type SavedKey = 'snapshot' | 'overrides';

interface Queued {
  seq?: number;
  id: string;
  event: CompletionEvent;
}

interface Saved {
  key: string;
  value: unknown;
}

class BoardDb extends Dexie {
  outbox!: Table<Queued, number>;
  saved!: Table<Saved, string>;
  constructor(name: string) {
    super(name);
    // seq keeps the order events were made in; id is unique, so the same event is kept once.
    this.version(1).stores({ outbox: '++seq, &id', saved: 'key' });
  }
}

export const BOARD_DB = 'familywise-board';

/**
 * The store for this board, or null where the browser has no IndexedDB (the server, or a private
 * window that refuses it). Every call settles: one that fails reads as nothing saved, so the board
 * carries on from memory.
 */
export function openBoardStore(deviceId: string, name = BOARD_DB): BoardStore | null {
  if (typeof indexedDB === 'undefined') return null;
  const db = new BoardDb(name);
  // Another board's leftovers are cleared before anything is read or written.
  const ready = db
    .transaction('rw', db.outbox, db.saved, async () => {
      const owner = await db.saved.get('device');
      if (owner?.value === deviceId) return;
      await db.outbox.clear();
      await db.saved.clear();
      await db.saved.put({ key: 'device', value: deviceId });
    })
    .then(
      () => true,
      () => false,
    );
  const whenReady = async <T>(op: () => Promise<T>, otherwise: T): Promise<T> => {
    if (!(await ready)) return otherwise;
    return op().catch(() => otherwise);
  };

  return {
    outbox: {
      load: () =>
        whenReady(async () => (await db.outbox.orderBy('seq').toArray()).map((q) => q.event), []),
      add: (event) =>
        whenReady(async () => {
          // Kept once however often it is added (a retry adds nothing new).
          if (!(await db.outbox.where('id').equals(event.id).count())) {
            await db.outbox.add({ id: event.id, event });
          }
        }, undefined),
      remove: (ids) =>
        whenReady(async () => {
          await db.outbox.where('id').anyOf(ids).delete();
        }, undefined),
    },
    get: <T>(key: SavedKey) =>
      whenReady(async () => ((await db.saved.get(key))?.value as T | undefined) ?? null, null),
    set: (key, value) =>
      whenReady(async () => {
        await db.saved.put({ key, value });
      }, undefined),
  };
}
