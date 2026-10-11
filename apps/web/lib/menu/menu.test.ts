import { describe, expect, it } from 'vitest';
import { csvDate, csvRows, parseMenuCsv } from './csv';
import { fetchSource, menuWindow, MENU_ERRORS, runMenuImport, type Fetcher } from './import';
import { districtFrom, readSchools, readWeek, weekUrl, weeksCovering } from './nutrislice';

// [MENU-02][MENU-03][MENU-04][MENU-05] The menu adapters (WP-27, D-79), on made-up menus shaped like
// Nutrislice's public API (SPIKE-04): no school's identifiers or real menus here (NFR-05). The
// database side is pinned by 360_school_menus.test.sql.

const FEED = { district: 'example-district', school: 'maple-elementary', menu_type: 'lunch' };

/** A made-up Nutrislice week from a Sunday: Monday pizza, Tuesday a holiday, Wednesday tacos. */
function week(sunday: string) {
  const day = (n: number) =>
    new Date(Date.parse(`${sunday}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  return {
    start_date: sunday,
    days: [
      { date: day(0), menu_items: [] },
      {
        date: day(1),
        menu_items: [
          { is_section_title: true, text: 'Main Line', food: null },
          { is_section_title: false, text: '', food: { name: 'Cheese Pizza', nutrition: {} } },
          { is_section_title: false, text: '', food: { name: 'Green Beans' } },
          { is_section_title: true, text: 'Beverages', food: null },
          { is_section_title: false, text: '', food: { name: '1% Milk' } },
        ],
      },
      {
        date: day(2),
        menu_items: [
          {
            is_holiday: true,
            is_section_title: false,
            text: 'No School - Teacher Day',
            food: null,
          },
        ],
      },
      { date: day(3), menu_items: [{ text: 'Tacos', food: null }] },
      { date: day(4), menu_items: [] },
    ],
  };
}

describe('the Nutrislice adapter', () => {
  it('[MENU-02][US-801] finds the district in what a parent types or pastes', () => {
    expect(districtFrom('example-district')).toBe('example-district');
    expect(districtFrom(' Example-District ')).toBe('example-district');
    expect(districtFrom('https://example-district.nutrislice.com/menu/maple/lunch')).toBe(
      'example-district',
    );
    expect(districtFrom('example-district.api.nutrislice.com')).toBe('example-district');
    expect(districtFrom('https://example.com/menu')).toBeNull();
    expect(districtFrom('two words')).toBeNull();
  });

  it('[MENU-02] builds the week address from a Sunday, and refuses anything but names', () => {
    expect(weekUrl(FEED, '2027-01-31')).toBe(
      'https://example-district.api.nutrislice.com/menu/api/weeks/school/maple-elementary/menu-type/lunch/2027/01/31/',
    );
    expect(() => weekUrl({ ...FEED, school: '../x' }, '2027-01-31')).toThrow();
  });

  it('[US-801] lists the schools with a menu, by name, each with its menus', () => {
    expect(
      readSchools([
        {
          name: 'Oak Middle',
          slug: 'oak-middle',
          active_menu_types: [
            { name: 'Breakfast', slug: 'breakfast' },
            { name: 'Lunch', slug: 'lunch' },
          ],
        },
        {
          name: 'Maple Elementary',
          slug: 'maple-elementary',
          active_menu_types: [{ name: 'Lunch', slug: 'lunch' }],
        },
        { name: 'District Office', slug: 'office', active_menu_types: [] },
        { name: 'Bad', slug: 'Not A Slug', active_menu_types: [{ name: 'Lunch', slug: 'lunch' }] },
      ]),
    ).toEqual([
      {
        slug: 'maple-elementary',
        name: 'Maple Elementary',
        menuTypes: [{ slug: 'lunch', name: 'Lunch' }],
      },
      {
        slug: 'oak-middle',
        name: 'Oak Middle',
        menuTypes: [
          { slug: 'breakfast', name: 'Breakfast' },
          { slug: 'lunch', name: 'Lunch' },
        ],
      },
    ]);
    expect(() => readSchools({ error: 'nope' })).toThrow();
  });

  it('[MENU-02] reads a week: items under their sections, a holiday as no lunch, empty days left out', () => {
    expect(readWeek(week('2027-01-31'))).toEqual([
      {
        date: '2027-02-01',
        items: [
          { name: 'Cheese Pizza', section: 'Main Line' },
          { name: 'Green Beans', section: 'Main Line' },
          { name: '1% Milk', section: 'Beverages' },
        ],
        noService: false,
      },
      { date: '2027-02-02', items: [], noService: true, note: 'No School - Teacher Day' },
      { date: '2027-02-03', items: [{ name: 'Tacos' }], noService: false },
    ]);
    expect(() => readWeek({ days: 'no' })).toThrow();
  });

  it('[MENU-05] covers a window with whole Sunday weeks', () => {
    expect(weeksCovering('2027-02-03', '2027-03-02')).toEqual([
      '2027-01-31',
      '2027-02-07',
      '2027-02-14',
      '2027-02-21',
      '2027-02-28',
    ]);
  });
});

describe('a menu file', () => {
  it('[MENU-03] splits CSV: quotes, commas and line breaks inside them, a BOM, blank lines', () => {
    expect(
      csvRows('﻿date,item\r\n2027-02-01,"Pizza, cheese"\n\n2027-02-02,"Say ""hi"""\n'),
    ).toEqual([
      ['date', 'item'],
      ['2027-02-01', 'Pizza, cheese'],
      ['2027-02-02', 'Say "hi"'],
    ]);
  });

  it('[MENU-03] reads dates written either way, and refuses ones that are not real', () => {
    expect(csvDate('2027-2-1')).toBe('2027-02-01');
    expect(csvDate('2/1/2027')).toBe('2027-02-01');
    expect(csvDate('2/30/2027')).toBeNull();
    expect(csvDate('Monday')).toBeNull();
  });

  it('[MENU-03][US-802] gathers rows into days, in date order, a date with no item as no lunch', () => {
    const { days, problems } = parseMenuCsv(
      [
        'Item,Date,Section,Notes',
        'Tacos,2027-02-02,,',
        'Cheese Pizza,2027-02-01,Main Line,',
        '1% Milk,2027-02-01,Beverages,',
        ",2027-02-15,Presidents' Day,",
      ].join('\n'),
    );
    expect(problems).toEqual([]);
    expect(days).toEqual([
      {
        date: '2027-02-01',
        items: [
          { name: 'Cheese Pizza', section: 'Main Line' },
          { name: '1% Milk', section: 'Beverages' },
        ],
        noService: false,
      },
      { date: '2027-02-02', items: [{ name: 'Tacos' }], noService: false },
      { date: '2027-02-15', items: [], noService: true, note: "Presidents' Day" },
    ]);
  });

  it('[US-802] says what is wrong with a file, by row', () => {
    expect(parseMenuCsv('when,what\n2027-02-01,Pizza').problems).toEqual([
      'The first row needs the columns date and item.',
    ]);
    expect(parseMenuCsv('date,item\nsoon,Pizza\n2027-02-01,Tacos').problems).toEqual([
      'Row 2: “soon” isn’t a date like 2027-02-01.',
    ]);
    expect(parseMenuCsv('date,item\n').problems).toEqual(['The file has no menu rows.']);
  });

  it('[MENU-03] done-when: four weeks of a file make twenty school days', () => {
    const rows = ['date,item'];
    for (let n = 0; n < 28; n++) {
      const d = new Date(Date.parse('2027-02-01T00:00:00Z') + n * 86_400_000);
      if (d.getUTCDay() % 6 !== 0) rows.push(`${d.toISOString().slice(0, 10)},Lunch ${n}`);
    }
    const { days, problems } = parseMenuCsv(rows.join('\n'));
    expect(problems).toEqual([]);
    expect(days).toHaveLength(20);
  });
});

/** A database stand-in that records each rpc and answers save_menu_fetch. */
function fakeDb(due: unknown[] = []) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === 'menu_sources_due') return { data: due, error: null };
      const result = args.p_result as { ok: boolean; days?: unknown[] };
      return { data: { status: 'fetched', days: result.days?.length ?? 0, kept: 0 }, error: null };
    },
  };
}
const answering =
  (status: number): Fetcher =>
  async (url) => {
    const sunday = /\/(\d{4})\/(\d{2})\/(\d{2})\/$/.exec(url)!.slice(1).join('-');
    return status === 200
      ? new Response(JSON.stringify(week(sunday)))
      : new Response('Unavailable', { status });
  };
const NOW = new Date('2027-02-01T15:00:00Z');

describe('the menu import', () => {
  it('[MENU-05] takes the next 28 days in the household’s zone', () => {
    expect(menuWindow('America/New_York', NOW)).toEqual({ from: '2027-02-01', to: '2027-02-28' });
  });

  it('[MENU-02][MENU-05] fetches each week of the window and stores the days in it', async () => {
    const db = fakeDb();
    const outcome = await fetchSource(
      db as never,
      { id: 'feed-1', config: FEED, contentHash: null, timeZone: 'America/New_York' },
      { fetch: answering(200), now: NOW },
    );
    expect(outcome).toEqual({ status: 'fetched', days: 12, kept: 0 });
    const result = db.calls[0]!.args.p_result as {
      from: string;
      to: string;
      days: { date: string }[];
    };
    expect([result.from, result.to]).toEqual(['2027-02-01', '2027-02-28']);
    // Five weeks fetched; the Sunday before the window is left out.
    expect(result.days[0]!.date).toBe('2027-02-01');
    expect(result.days.every((d) => d.date >= '2027-02-01' && d.date <= '2027-02-28')).toBe(true);
  });

  it('[MENU-04][US-803] a feed that fails records why, and stores no days', async () => {
    const db = fakeDb();
    const outcome = await fetchSource(
      db as never,
      { id: 'feed-1', config: FEED, contentHash: null, timeZone: 'America/New_York' },
      { fetch: answering(503), now: NOW },
    );
    expect(outcome).toEqual({
      status: 'error',
      error: 'Nutrislice answered 503. FamilyWise tries again tomorrow.',
    });
    expect(db.calls.map((c) => c.args.p_result)).toEqual([
      { ok: false, error: 'Nutrislice answered 503. FamilyWise tries again tomorrow.' },
    ]);
    const gone = await fetchSource(
      fakeDb() as never,
      { id: 'feed-1', config: FEED, contentHash: null, timeZone: 'America/New_York' },
      { fetch: answering(404), now: NOW },
    );
    expect(gone).toEqual({ status: 'error', error: MENU_ERRORS.notFound });
  });

  it('[MENU-05] the same menus next time are not written again', async () => {
    const first = fakeDb();
    await fetchSource(
      first as never,
      { id: 'feed-1', config: FEED, contentHash: null, timeZone: 'America/New_York' },
      { fetch: answering(200), now: NOW },
    );
    const hash = (first.calls[0]!.args.p_result as { content_hash: string }).content_hash;
    const again = fakeDb();
    expect(
      await fetchSource(
        again as never,
        { id: 'feed-1', config: FEED, contentHash: hash, timeZone: 'America/New_York' },
        { fetch: answering(200), now: NOW },
      ),
    ).toEqual({ status: 'unchanged' });
    expect(again.calls[0]!.args.p_result).toEqual({
      ok: true,
      unchanged: true,
      content_hash: hash,
    });
  });

  it('[MENU-05] the job fetches each feed due, one at a time', async () => {
    const db = fakeDb([
      { id: 'a', config: FEED, content_hash: null, timezone: 'America/New_York' },
      { id: 'b', config: FEED, content_hash: null, timezone: 'America/New_York' },
    ]);
    expect(await runMenuImport(db as never, 'h', { fetch: answering(200), now: NOW })).toEqual({
      due: 2,
      fetched: 2,
      unchanged: 0,
      failed: 0,
    });
    expect(db.calls.map((c) => c.name)).toEqual([
      'menu_sources_due',
      'save_menu_fetch',
      'save_menu_fetch',
    ]);
  });
});
