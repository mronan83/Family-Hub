import { MAX_ITEMS, type MenuDay } from './nutrislice';
import { withOptions } from './sections';

// [MENU-03][US-802] A menu from a file (D-79): a spreadsheet saved as CSV, one item per row.
//
//   date,item,section
//   2027-02-01,Cheese Pizza,Main Line
//   2027-02-01,1% Milk,Beverages
//   2027-02-15,,Presidents' Day        ← a date with no item: no lunch that day; section is the note
//
// Columns are found by their header (any order, any capitals): `date` and `item` are needed,
// `section` is optional; others are ignored. Dates are 2027-02-01 or 2/1/2027 (month first). Rows for
// the same date gather in order. [MENU-06] An item may hold "or" and "with" ("Beef tacos or Chicken
// wrap with chips"): each row's items are options of its section, as a feed's are (WP-64).

/** The most days one file loads (save_menu_days takes 120). */
export const MAX_DAYS = 120;
/** A file this large is not a menu. */
export const MAX_FILE_BYTES = 512 * 1024;

export interface CsvResult {
  days: MenuDay[];
  /** What is wrong with the file, as a parent reads it; empty when it loads. */
  problems: string[];
}

/** Splits CSV text into rows of fields: quotes, doubled quotes, commas and line breaks in quotes. */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

/** "2027-02-01" or "2/1/2027" as YYYY-MM-DD; null when it isn't a real date. */
export function csvDate(value: string): string | null {
  const v = value.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else {
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
    if (!match) return null;
    [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/** [MENU-03] Reads a menu file into days, or says what is wrong with it (row numbers as in a sheet). */
export function parseMenuCsv(text: string): CsvResult {
  const rows = csvRows(text);
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const [dateCol, itemCol, sectionCol] = [col('date'), col('item'), col('section')];
  if (dateCol < 0 || itemCol < 0) {
    return { days: [], problems: ['The first row needs the columns date and item.'] };
  }
  const problems: string[] = [];
  const byDate = new Map<string, MenuDay>();
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const date = csvDate(r[dateCol] ?? '');
    const item = (r[itemCol] ?? '').trim();
    const section = sectionCol >= 0 ? (r[sectionCol] ?? '').trim() : '';
    if (!date) {
      problems.push(`Row ${line}: “${(r[dateCol] ?? '').trim()}” isn’t a date like 2027-02-01.`);
      return;
    }
    if (item.length > 120) {
      problems.push(`Row ${line}: the item is longer than 120 characters.`);
      return;
    }
    const day = byDate.get(date) ?? { date, items: [], noService: false };
    byDate.set(date, day);
    if (!item) {
      day.noService = true;
      if (section) day.note = section.slice(0, 120);
    } else if (day.items.length < MAX_ITEMS) {
      day.items.push(section ? { name: item, section: section.slice(0, 60) } : { name: item });
    }
  });
  // A date with items and an empty row too has its lunch: the items win.
  const days = [...byDate.values()]
    .map((d) =>
      d.items.length > 0
        ? { date: d.date, items: withOptions(d.items, { split: true }), noService: false }
        : d,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  if (days.length === 0 && problems.length === 0) problems.push('The file has no menu rows.');
  if (days.length > MAX_DAYS)
    problems.push(`The file has ${days.length} days; load up to ${MAX_DAYS} at once.`);
  return { days, problems };
}
