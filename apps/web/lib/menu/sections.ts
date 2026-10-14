import { MAX_ITEMS, type MenuItem } from './nutrislice';

// [MENU-06][US-804] The school menu by section, as options (WP-64, D-94). A feed lists each food
// under its section title, with "or" and "with" as items of their own ("Choice of Entree": Beef
// tacos, or, Chicken wrap, with, Tortilla chips); a file or a typed-in day writes them inside a line
// ("Beef tacos or Chicken wrap with tortilla chips"). Each item becomes an option of its section,
// "or" only separates options, and "with" joins the next item to the option before it as a side.
// A stored item keeps its section title as the menu writes it (WP-49 reads "Choice of" from it) and
// its option's number in that section. Relative imports only: the e2e runner uses this.

const CONNECTOR = /^(or|with)$/i;
const SPLIT = /\s+(or|with)\s+/i;

/** A name written with "or" and "with" in it, as its items and connectors: "A or B" → A, or, B. */
function splitWords(name: string): string[] {
  return name
    .split(SPLIT)
    .map((w) => w.trim())
    .filter(Boolean);
}

/**
 * [MENU-06] Items as a menu lists them into options: "or" items are dropped, a "with" item is
 * dropped and joins the next item to the option before it; every other item starts an option.
 * Options are numbered from 1 in each section. `split` also reads "or" and "with" inside a name
 * (a file or a typed-in day; a feed sends them as items of their own).
 */
export function withOptions(items: MenuItem[], options: { split?: boolean } = {}): MenuItem[] {
  const last = new Map<string, number>();
  const out: MenuItem[] = [];
  let joining = false;
  let section: string | undefined;
  for (const item of items) {
    if (item.section !== section) joining = false;
    section = item.section;
    const key = section ?? '';
    for (const word of options.split ? splitWords(item.name) : [item.name.trim()]) {
      if (CONNECTOR.test(word)) {
        joining = word.toLowerCase() === 'with' && last.has(key);
        continue;
      }
      if (!word || out.length >= MAX_ITEMS) continue;
      const option = joining ? last.get(key)! : (last.get(key) ?? 0) + 1;
      last.set(key, option);
      joining = false;
      out.push({ name: word.slice(0, 120), ...(section ? { section } : {}), option });
    }
  }
  return out;
}

/** One option of a section: its item, and the sides that come with it. */
export interface MenuOption {
  name: string;
  sides: string[];
}

/** A section of a day's menu: its title as the menu writes it (null: none), and its options. */
export interface MenuSection {
  title: string | null;
  options: MenuOption[];
}

/**
 * [MENU-06] A day's stored items by section, in the order the menu lists them. Items stored before
 * WP-64 have no option: they are read by the same rules, so a cached feed's "or" and "with" are
 * read at once, before the next fetch stores them again.
 */
export function menuSections(items: MenuItem[]): MenuSection[] {
  const read = items.every((i) => Number.isInteger(i.option))
    ? items
    : withOptions(items.map(({ name, section }) => (section ? { name, section } : { name })));
  const sections = new Map<string, { title: string | null; options: Map<number, MenuOption> }>();
  for (const i of read) {
    const key = i.section ?? '';
    const s = sections.get(key) ?? { title: i.section ?? null, options: new Map() };
    sections.set(key, s);
    const o = s.options.get(i.option!);
    if (o) o.sides.push(i.name);
    else s.options.set(i.option!, { name: i.name, sides: [] });
  }
  return [...sections.values()].map((s) => ({ title: s.title, options: [...s.options.values()] }));
}

/** A section's title as the board and Meals show it: "Choice of Entree" → "Entree". */
export function sectionLabel(title: string): string {
  const short = title
    .trim()
    .replace(/^choice\s+of\s+/i, '')
    .replace(/\s+offered$/i, '')
    .trim();
  return short ? short[0]!.toUpperCase() + short.slice(1) : title.trim();
}

/** True when a section asks for one of its options ("Choice of Milk"), as WP-49 will read it. */
export function pickOne(title: string | null): boolean {
  return !!title && /\bchoice\s+of\b/i.test(title);
}

/** An option in words, with its sides: "Chicken wrap with Tortilla chips". */
export function optionWords(o: MenuOption): string {
  return [o.name, ...o.sides].join(' with ');
}

/** Words as a choice: "A", "A or B", "A, B or C". */
export function orWords(words: string[]): string {
  return words.length < 2
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`;
}

/** The entree: the section whose title says entree or main (the owner's), else the first. */
export function entreeSection(sections: MenuSection[]): MenuSection | null {
  return sections.find((s) => s.title && /entr[eé]e|\bmain/i.test(s.title)) ?? sections[0] ?? null;
}

/** A section's options in words: joined with "or" for a choice or the entree, else with commas. */
export function sectionWords(s: MenuSection, entree = false): string {
  const words = s.options.map(optionWords);
  return s.title && (entree || pickOne(s.title)) ? orWords(words) : words.join(', ');
}

/**
 * [MENU-06][US-804] What the board's home screen says of a buy day: the entree's options, with
 * their sides ("Beef tacos or Chicken wrap with Tortilla chips"). A menu with no sections can't say
 * which is the entree, so it lists everything, with commas. Null when there is nothing.
 */
export function entreeWords(items: MenuItem[]): string | null {
  const s = entreeSection(menuSections(items));
  return s && s.options.length ? sectionWords(s, true) : null;
}
