import { describe, expect, it } from 'vitest';
import { completionBatchSchema, describeIssues, MAX_BATCH } from './completions';

const event = {
  id: '6f7d2a1e-0c3b-4c1e-9a55-0b9c7d3e2f10',
  occurrence_id: '0de00000-0000-4000-8000-0000000c0001',
  event_type: 'complete',
  occurred_at: '2026-10-09T13:05:00.000Z',
  done_by: ['0de00000-0000-4000-8000-0000000000a1'],
};

describe('[CHR-04][NFR-06] completion batches', () => {
  it('accepts a board’s check-off and fills in an empty done_by for an undo', () => {
    const parsed = completionBatchSchema.parse({
      events: [
        event,
        {
          ...event,
          id: '7f7d2a1e-0c3b-4c1e-9a55-0b9c7d3e2f10',
          event_type: 'undo',
          done_by: undefined,
        },
      ],
    });
    expect(parsed.events[1]!.done_by).toEqual([]);
  });

  it('accepts a time with an offset, as a board in any time zone sends it', () => {
    expect(
      completionBatchSchema.safeParse({
        events: [{ ...event, occurred_at: '2026-10-09T08:05:00-05:00' }],
      }).success,
    ).toBe(true);
  });

  it('refuses an empty batch, one over the limit, an unknown type, a bad id and extra fields', () => {
    const bad = (events: unknown) => completionBatchSchema.safeParse({ events }).success;
    expect(bad([])).toBe(false);
    expect(bad(Array.from({ length: MAX_BATCH + 1 }, () => event))).toBe(false);
    expect(bad([{ ...event, event_type: 'delete' }])).toBe(false);
    expect(bad([{ ...event, id: 'not-a-uuid' }])).toBe(false);
    expect(bad([{ ...event, occurred_at: 'yesterday' }])).toBe(false);
    // Who recorded it comes from the session, never the body (D-46).
    expect(bad([{ ...event, actor_type: 'system' }])).toBe(false);
  });

  it('says what was wrong, by path', () => {
    const result = completionBatchSchema.safeParse({
      events: [{ ...event, event_type: 'delete' }],
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(describeIssues(result.error)[0]).toMatch(/^events\.0\.event_type: /);
  });
});
