import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseJobStore } from './store';

// A stand-in for supabase-js's query builder over a household table: it records the filters asked
// for and applies the `eq` ones, as PostgREST would.
function households(rows: { id: string; is_demo: boolean }[]) {
  const asked: string[] = [];
  const db = {
    from(table: string) {
      asked.push(`from ${table}`);
      let result = rows;
      const builder = {
        select(columns: string) {
          asked.push(`select ${columns}`);
          return builder;
        },
        eq(column: 'is_demo', value: boolean) {
          asked.push(`eq ${column} ${value}`);
          result = result.filter((r) => r[column] === value);
          return builder;
        },
        order(column: 'id') {
          asked.push(`order ${column}`);
          const data = [...result].sort((a, b) => a[column].localeCompare(b[column]));
          return Promise.resolve({ data, error: null });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { db, asked };
}

describe('supabaseJobStore', () => {
  it('[NFR-07][NFR-14] lists every household for a job but the demo family (D-62)', async () => {
    const { db, asked } = households([
      { id: 'h2', is_demo: false },
      { id: '0de00000-0000-4000-8000-000000000001', is_demo: true },
      { id: 'h1', is_demo: false },
    ]);
    expect(await supabaseJobStore(db).households()).toEqual(['h1', 'h2']);
    expect(asked).toContain('eq is_demo false');
  });
});
