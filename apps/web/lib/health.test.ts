import { describe, expect, it } from 'vitest';
import { jobLabel, unitFactor, usageLines, type UsageRow } from './health';

const NOW = new Date('2026-10-09T12:00:00Z');
const row = (r: Partial<UsageRow>): UsageRow => ({
  source: 'vercel',
  service: 'Function Invocations',
  unit: 'Invocations',
  used: 0,
  project_used: 0,
  taken_at: '2026-10-09T06:41:00Z',
  ...r,
});

describe('System Health', () => {
  it('[NFR-07] names jobs in plain words', () => {
    expect(jobLabel('purge_history')).toBe('Purge history');
    expect(jobLabel('heartbeat')).toBe('Heartbeat');
  });

  it('[NFR-08] reads the units Vercel reports into the limit’s measure', () => {
    expect(unitFactor('hour', 'hours')).toBe(1);
    expect(unitFactor('Seconds', 'hours')).toBe(1 / 3600);
    expect(unitFactor('GB-Hours', 'gb-hours')).toBe(1);
    expect(unitFactor('GB Hours', 'gb-hours')).toBe(1);
    expect(unitFactor('Requests', 'count')).toBe(1);
    expect(unitFactor('furlongs', 'count')).toBeNull();
  });

  it('[NFR-08] shows each reading against its limit, with FamilyWise’s share of the account', () => {
    const { lines } = usageLines(
      [
        row({ service: 'Function Invocations', used: 12_345, project_used: 10_000 }),
        row({ service: 'Fluid Active CPU', unit: 'hour', used: 0.5, project_used: 0.125 }),
        row({
          source: 'supabase',
          service: 'Database size',
          unit: 'bytes',
          used: 50 * 1024 ** 2,
          project_used: null,
        }),
      ],
      NOW,
    );
    expect(lines).toEqual([
      { label: 'Database', text: '50 MB of 500 MB', ours: null, share: 0.1, warn: false },
      {
        label: 'Function calls',
        text: '12,345 of 1,000,000',
        ours: '10,000',
        share: 0.012345,
        warn: false,
      },
      { label: 'Active CPU', text: '0.5 h of 4 h', ours: '0.13 h', share: 0.125, warn: false },
    ]);
  });

  it('[NFR-08] warns at 80 % of a limit (US-909)', () => {
    const { lines } = usageLines(
      [row({ service: 'Fluid Provisioned Memory', unit: 'GB-Hours', used: 300, project_used: 20 })],
      NOW,
    );
    expect(lines[0]).toMatchObject({ label: 'Provisioned memory', warn: true });
    expect(lines[0]!.share).toBeCloseTo(0.833, 3);
  });

  it('[NFR-08] a unit this build does not know is shown as reported, without a comparison', () => {
    const { lines } = usageLines([row({ unit: 'furlongs', used: 7 })], NOW);
    expect(lines).toEqual([
      { label: 'Function calls', text: '7 furlongs', ours: null, share: null, warn: false },
    ]);
  });

  it('[NFR-08] a Vercel reading older than 36 hours, or none, is marked late', () => {
    expect(usageLines([row({})], NOW)).toMatchObject({
      vercelReadAt: '2026-10-09T06:41:00Z',
      vercelStale: false,
    });
    expect(usageLines([row({ taken_at: '2026-10-07T23:00:00Z' })], NOW).vercelStale).toBe(true);
    expect(usageLines([], NOW)).toMatchObject({ vercelReadAt: null, vercelStale: true });
  });
});
