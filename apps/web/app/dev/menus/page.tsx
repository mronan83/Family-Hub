import type { Metadata } from 'next';
import { MenusView } from '../../(admin)/admin/meals/menus/view';
import { addDays } from '@/lib/board-calendar';
import type { MenuDayRow, MenuSourceRow } from '@/lib/menus';

// The admin School menus page (WP-27) with a made-up family, school and district and no database,
// for the UI suite and the guide's pictures: Maple Elementary's Nutrislice menu (one day the parent's
// own), Oak Middle's from a file, and a feed that can't fetch and keeps its menus (US-803). Day or
// Evening (?theme=evening); the add form with a district's schools found (?add=1); a file looked at
// before loading (?file=1). No school's real identifiers or menus are used (NFR-05).
export const metadata: Metadata = { title: 'School menus', robots: { index: false } };

const TODAY = '2026-10-12';
const MAYA = 'f2000000-0000-4000-8000-000000000001';
const LEO = 'f2000000-0000-4000-8000-000000000002';
const LUNCHES = [
  ['Chicken Nuggets', 'Carrot Sticks', 'Apple'],
  ['Cheese Pizza', 'Green Beans', 'Milk'],
  ['Beef Tacos', 'Corn', 'Orange'],
  ['Spaghetti', 'Garlic Bread', 'Pear'],
  ['Fish Tacos', 'Rice', 'Banana'],
];

/** School days (Monday to Friday) from today for `weeks` weeks, each with the week's lunches. */
function schoolDays(weeks: number, origin: MenuDayRow['origin'], section?: string): MenuDayRow[] {
  const days: MenuDayRow[] = [];
  for (let n = 0; n < weeks * 7; n++) {
    const date = addDays(TODAY, n);
    const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    days.push({
      date,
      items: LUNCHES[wd - 1]!.map((name) => (section ? { name, section } : { name })),
      noService: false,
      origin,
      own: origin !== 'adapter',
    });
  }
  return days;
}

const mapleDays = schoolDays(2, 'adapter', 'Main Line').map((d) =>
  d.date === addDays(TODAY, 3)
    ? {
        ...d,
        items: [{ name: 'Field trip: bring a packed lunch' }],
        origin: 'manual' as const,
        own: true,
      }
    : d.date === addDays(TODAY, 4)
      ? { ...d, items: [], noService: true, note: 'No School - Teacher Day' }
      : d,
);

const MENUS: MenuSourceRow[] = [
  {
    id: 'f2f00000-0000-4000-8000-000000000001',
    name: 'Maple Elementary',
    adapter: 'nutrislice',
    config: {
      district: 'example-district',
      school: 'maple-elementary',
      menu_type: 'lunch',
      school_name: 'Maple Elementary',
      menu_type_name: 'Lunch',
    },
    status: 'ok',
    lastFetchAt: '2026-10-12T10:29:04Z',
    lastSuccessAt: '2026-10-12T10:29:04Z',
    lastError: null,
    childIds: [MAYA, LEO],
    days: mapleDays,
  },
  {
    id: 'f2f00000-0000-4000-8000-000000000002',
    name: 'Oak Middle',
    adapter: 'csv',
    config: {},
    status: 'ok',
    lastFetchAt: null,
    lastSuccessAt: null,
    lastError: null,
    childIds: [],
    days: schoolDays(1, 'csv'),
  },
  {
    id: 'f2f00000-0000-4000-8000-000000000003',
    name: 'Cedar High',
    adapter: 'nutrislice',
    config: {
      district: 'example-district',
      school: 'cedar-high',
      menu_type: 'lunch',
      school_name: 'Cedar High',
      menu_type_name: 'Lunch',
    },
    status: 'error',
    lastFetchAt: '2026-10-12T10:29:06Z',
    lastSuccessAt: '2026-10-11T10:29:05Z',
    lastError: 'Nutrislice answered 503. FamilyWise tries again tomorrow.',
    childIds: [],
    days: schoolDays(1, 'adapter').slice(0, 2),
  },
];

const FOUND = {
  district: 'example-district',
  schools: [
    { slug: 'cedar-high', name: 'Cedar High', menuTypes: [{ slug: 'lunch', name: 'Lunch' }] },
    {
      slug: 'maple-elementary',
      name: 'Maple Elementary',
      menuTypes: [
        { slug: 'breakfast', name: 'Breakfast' },
        { slug: 'lunch', name: 'Lunch' },
      ],
    },
    { slug: 'oak-middle', name: 'Oak Middle', menuTypes: [{ slug: 'lunch', name: 'Lunch' }] },
  ],
};

export default async function DevMenusPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string; add?: string; file?: string }>;
}) {
  const p = await searchParams;
  const theme = p.theme === 'evening' ? 'theme-evening' : 'theme-day';
  const fileDays = schoolDays(4, 'csv');
  return (
    <div className={`admin ${theme}`}>
      <MenusView
        menus={MENUS}
        names={
          new Map([
            [MAYA, 'Maya'],
            [LEO, 'Leo'],
          ])
        }
        timezone="America/New_York"
        today={TODAY}
        notice={null}
        error={null}
        found={p.add ? FOUND : undefined}
        fileState={
          p.file
            ? {
                days: JSON.stringify(fileDays),
                preview: {
                  count: fileDays.length,
                  first: fileDays[0]!.date,
                  last: fileDays.at(-1)!.date,
                  noLunch: 0,
                  sample: fileDays.slice(0, 5),
                },
              }
            : undefined
        }
      />
    </div>
  );
}
