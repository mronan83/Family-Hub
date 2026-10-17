import type { SourcePeriod } from '@familywise/rules-engine';
import type { IconName } from '@familywise/ui';

// The /dev goal pages' made-up family (no database), shared by the page and its live summaries
// (WP-101). Today is Thursday, Oct 15, 2026.
export const DEV = {
  today: '2026-10-15',
  maya: 'f2000000-0000-4000-8000-000000000001',
  leo: 'f2000000-0000-4000-8000-000000000002',
  homework: 'f2c00000-0000-4000-8000-000000000003',
  reading: 'f2c00000-0000-4000-8000-000000000004',
  /** Maya's "Homework home every school day", as a goal a rule may count (its id a real one). */
  homeworkGoal: 'f2e00000-0000-4000-8000-000000000008',
  homeworkWeeks: [
    { start: '2026-09-14', end: '2026-09-20', outcome: 'won' },
    { start: '2026-09-21', end: '2026-09-27', outcome: 'won' },
    { start: '2026-09-28', end: '2026-10-04', outcome: 'missed' },
    { start: '2026-10-05', end: '2026-10-11', outcome: 'won' },
    { start: '2026-10-12', end: '2026-10-18', outcome: 'open' },
  ] as SourcePeriod[],
  tags: [
    { id: 'f2a00000-0000-4000-8000-000000000001', name: 'Morning' },
    { id: 'f2a00000-0000-4000-8000-000000000002', name: 'Kitchen' },
  ],
  /** [NFR-16-n] Each item with its picture. */
  items: [
    {
      id: 'f2c00000-0000-4000-8000-000000000001',
      title: 'Make bed',
      icon: 'chore-bed' as IconName,
    },
    {
      id: 'f2c00000-0000-4000-8000-000000000003',
      title: 'Homework home',
      icon: 'backpack' as IconName,
    },
    { id: 'f2c00000-0000-4000-8000-000000000004', title: 'Reading', icon: 'book-open' as IconName },
    {
      id: 'f2c00000-0000-4000-8000-000000000002',
      title: 'Set the table',
      icon: 'chore-table' as IconName,
    },
  ],
} as const;
