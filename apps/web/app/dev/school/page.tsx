import type { Metadata } from 'next';
import type { ClosureRow, SchoolYearRow, TermRow } from '../../(admin)/admin/school/data';
import {
  type SchoolSection,
  SchoolView,
  SchoolYearView,
  type YearSection,
} from '../../(admin)/admin/school/view';
import type { Day } from '@/lib/school';

// [SCH-01][SCH-02][NFR-18] School and a school year's page (WP-94) with the made-up family and no
// database, for the UI suite and the side-by-side: Lincoln 2026–27 (the default, Maya and Leo ticked),
// Lincoln 2025–26 archived, a teacher day and Thanksgiving break, two terms, a cut-off at 8:00 am, on
// Thursday, Oct 15, 2026. ?page=year for the year's page; ?open= a section open, as after a save in it
// (School: lunch, add, archived; the year: closures, terms, followers, dates); ?state=empty for a
// household with no school year yet (School) or a year with nothing set up (the year); ?theme=evening.
export const metadata: Metadata = { title: 'School year', robots: { index: false } };

const TODAY = '2026-10-15';
const MAYA = 'f1000000-0000-4000-8000-000000000001';
const LEO = 'f1000000-0000-4000-8000-000000000002';
const MEMBERS = [
  { id: MAYA, displayName: 'Maya', avatarKey: 'fox' as const, color: 'member-3' as const },
  { id: LEO, displayName: 'Leo', avatarKey: 'frog' as const, color: 'member-4' as const },
];
const YEAR: SchoolYearRow = {
  id: 'c1000000-0000-4000-8000-000000000001',
  name: 'Lincoln 2026–27',
  schoolName: 'Lincoln Elementary',
  startDate: '2026-08-26',
  endDate: '2027-06-11',
  isDefault: true,
  archivedAt: null,
};
const OLD: SchoolYearRow = {
  id: 'c1000000-0000-4000-8000-000000000002',
  name: 'Lincoln 2025–26',
  schoolName: 'Lincoln Elementary',
  startDate: '2025-08-27',
  endDate: '2026-06-12',
  isDefault: true,
  archivedAt: '2026-06-20T12:00:00Z',
};
const CLOSURES: ClosureRow[] = [
  {
    id: 'c2000000-0000-4000-8000-000000000001',
    name: 'Teacher day',
    closureType: 'teacher_day',
    startDate: '2026-10-23',
    endDate: '2026-10-23',
  },
  {
    id: 'c2000000-0000-4000-8000-000000000002',
    name: 'Thanksgiving break',
    closureType: 'break',
    startDate: '2026-11-25',
    endDate: '2026-11-27',
  },
];
const TERMS: TermRow[] = [
  {
    id: 'c3000000-0000-4000-8000-000000000001',
    name: 'Fall',
    startDate: '2026-08-26',
    endDate: '2027-01-15',
  },
  {
    id: 'c3000000-0000-4000-8000-000000000002',
    name: 'Spring',
    startDate: '2027-01-19',
    endDate: '2027-06-11',
  },
];

/** Every day of the year as the database types it: weekends, the closures' weekdays, school days. */
function daysOf(year: SchoolYearRow, closures: ClosureRow[]): Day[] {
  const days: Day[] = [];
  for (
    let d = new Date(`${year.startDate}T12:00:00Z`);
    d <= new Date(`${year.endDate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const day = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    const closure = closures.find((c) => c.startDate <= day && day <= c.endDate);
    days.push({
      day,
      dayType:
        dow === 0 || dow === 6
          ? 'weekend'
          : closure
            ? closure.closureType === 'break'
              ? 'break'
              : 'no_school'
            : 'school_day',
    });
  }
  return days;
}

export default async function DevSchoolPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string; page?: string; open?: string; state?: string }>;
}) {
  const p = await searchParams;
  const theme = p.theme === 'evening' ? 'theme-evening' : 'theme-day';
  const empty = p.state === 'empty';
  const who = { name: 'Alex', avatarKey: 'owl' as const, color: 'member-1' as const };
  if (p.page === 'year') {
    const closures = empty ? [] : CLOSURES;
    return (
      <div className={`admin ${theme}`}>
        <SchoolYearView
          year={YEAR}
          terms={empty ? [] : TERMS}
          closures={closures}
          followers={empty ? [] : [MAYA, LEO]}
          members={MEMBERS}
          days={daysOf(YEAR, closures)}
          weekStart={0}
          today={TODAY}
          saved={null}
          open={
            (['closures', 'terms', 'followers', 'dates'] as YearSection[]).find(
              (s) => s === p.open,
            ) ?? null
          }
          waiting={2}
          who={who}
        />
      </div>
    );
  }
  return (
    <div className={`admin ${theme}`}>
      <SchoolView
        today={TODAY}
        members={MEMBERS.map((m) => ({
          ...m,
          today: empty
            ? { dayType: 'summer', schoolYearId: null }
            : { dayType: 'school_day', schoolYearId: YEAR.id },
        }))}
        years={empty ? [] : [YEAR, OLD]}
        cutoff="08:00"
        saved={null}
        open={(['lunch', 'add', 'archived'] as SchoolSection[]).find((s) => s === p.open) ?? null}
        waiting={2}
        who={who}
      />
    </div>
  );
}
