import { describe, expect, it } from 'vitest';
import { parseMenuCsv } from './csv';
import { readWeek } from './nutrislice';
import {
  entreeSection,
  entreeWords,
  menuSections,
  orWords,
  pickOne,
  sectionLabel,
  sectionWords,
  withOptions,
} from './sections';

// [MENU-06][US-804] The school menu by section, as options (WP-64, D-94). Every menu here is made up.

const ENTREE = 'Choice of Entree';
const FRUIT = 'Fruits & Vegetables offered';
const MILK = 'Choice of Milk';

/** A made-up Nutrislice day as the feed sends it: section titles, foods, and "or" and "with". */
function feedDay(date: string) {
  const title = (text: string) => ({ is_section_title: true, text, food: null });
  const food = (name: string) => ({ is_section_title: false, text: '', food: { name } });
  const word = (text: string) => ({ is_section_title: false, text, food: null });
  return {
    date,
    menu_items: [
      title(ENTREE),
      food('Beef tacos'),
      word('or'),
      food('Chicken wrap'),
      word('with'),
      food('Tortilla chips'),
      title(FRUIT),
      food('Corn'),
      food('Orange'),
      food('Cucumber slices'),
      title(MILK),
      food('1% milk'),
      word('OR'),
      food('Chocolate milk'),
    ],
  };
}

describe('the school menu by section', () => {
  it('[MENU-06][US-804] reads a feed’s "or" and "with" into each section’s options', () => {
    const [day] = readWeek({ days: [feedDay('2027-02-01')] });
    expect(day!.items).toEqual([
      { name: 'Beef tacos', section: ENTREE, option: 1 },
      { name: 'Chicken wrap', section: ENTREE, option: 2 },
      { name: 'Tortilla chips', section: ENTREE, option: 2 },
      { name: 'Corn', section: FRUIT, option: 1 },
      { name: 'Orange', section: FRUIT, option: 2 },
      { name: 'Cucumber slices', section: FRUIT, option: 3 },
      { name: '1% milk', section: MILK, option: 1 },
      { name: 'Chocolate milk', section: MILK, option: 2 },
    ]);
    expect(menuSections(day!.items)).toEqual([
      {
        title: ENTREE,
        options: [
          { name: 'Beef tacos', sides: [] },
          { name: 'Chicken wrap', sides: ['Tortilla chips'] },
        ],
      },
      {
        title: FRUIT,
        options: [
          { name: 'Corn', sides: [] },
          { name: 'Orange', sides: [] },
          { name: 'Cucumber slices', sides: [] },
        ],
      },
      {
        title: MILK,
        options: [
          { name: '1% milk', sides: [] },
          { name: 'Chocolate milk', sides: [] },
        ],
      },
    ]);
  });

  it('[MENU-06] a stray "or" or "with" never makes an item or a side of another section', () => {
    expect(
      withOptions([
        { name: 'with', section: 'A' },
        { name: 'Soup', section: 'A' },
        { name: 'with', section: 'A' },
        { name: 'or', section: 'A' },
        { name: 'Salad', section: 'A' },
        { name: 'with', section: 'A' },
        { name: 'Bread', section: 'B' },
        { name: 'or', section: 'B' },
      ]),
    ).toEqual([
      { name: 'Soup', section: 'A', option: 1 },
      { name: 'Salad', section: 'A', option: 2 },
      { name: 'Bread', section: 'B', option: 1 },
    ]);
  });

  it('[MENU-06] menus stored before WP-64, "or" and "with" as foods, read the same way', () => {
    const old = [
      { name: 'Pizza', section: ENTREE },
      { name: 'or', section: ENTREE },
      { name: 'Wrap', section: ENTREE },
      { name: 'with', section: ENTREE },
      { name: 'Roll', section: ENTREE },
    ];
    expect(menuSections(old)).toEqual([
      {
        title: ENTREE,
        options: [
          { name: 'Pizza', sides: [] },
          { name: 'Wrap', sides: ['Roll'] },
        ],
      },
    ]);
  });

  it('[MENU-06][US-804] a file reads "or" and "with" inside an item, under its section', () => {
    const { days, problems } = parseMenuCsv(
      [
        'date,item,section',
        '2027-02-01,Beef tacos or Chicken wrap with tortilla chips,Choice of Entree',
        '2027-02-01,"Milk, 1%",Choice of Milk',
        '2027-02-01,Chocolate milk,Choice of Milk',
      ].join('\n'),
    );
    expect(problems).toEqual([]);
    expect(days[0]!.items).toEqual([
      { name: 'Beef tacos', section: ENTREE, option: 1 },
      { name: 'Chicken wrap', section: ENTREE, option: 2 },
      { name: 'tortilla chips', section: ENTREE, option: 2 },
      // A comma is part of a name: only "or" and "with" separate.
      { name: 'Milk, 1%', section: MILK, option: 1 },
      { name: 'Chocolate milk', section: MILK, option: 2 },
    ]);
  });

  it('[MENU-06] shortens a section’s title to show it, and keeps "Choice of" for picking one', () => {
    expect(sectionLabel(ENTREE)).toBe('Entree');
    expect(sectionLabel(FRUIT)).toBe('Fruits & Vegetables');
    expect(sectionLabel('choice of milk')).toBe('Milk');
    expect(sectionLabel('Main Line')).toBe('Main Line');
    expect(sectionLabel('Choice of')).toBe('Choice of');
    expect(pickOne(MILK)).toBe(true);
    expect(pickOne(FRUIT)).toBe(false);
    expect(pickOne(null)).toBe(false);
  });

  it('[MENU-06][US-804] the entree: a section titled entree or main, else the first', () => {
    const s = (title: string | null) => ({ title, options: [{ name: 'X', sides: [] }] });
    expect(entreeSection([s('Fruit'), s('Choice of Entrée')])!.title).toBe('Choice of Entrée');
    expect(entreeSection([s('Sides'), s('Main Line')])!.title).toBe('Main Line');
    expect(entreeSection([s('Hot Lunch'), s('Milk')])!.title).toBe('Hot Lunch');
    expect(entreeSection([])).toBeNull();
    // "Domain" is not "main".
    expect(entreeSection([s('Fruit'), s('Domain')])!.title).toBe('Fruit');
  });

  it('[MENU-06][US-804] the home screen’s line: the entree’s options with their sides', () => {
    const [day] = readWeek({ days: [feedDay('2027-02-01')] });
    expect(entreeWords(day!.items)).toBe('Beef tacos or Chicken wrap with Tortilla chips');
    expect(orWords(['A', 'B', 'C'])).toBe('A, B or C');
    expect(orWords(['A'])).toBe('A');
    // A menu with no sections can't say which is the entree: everything, with commas.
    expect(entreeWords([{ name: 'Nuggets' }, { name: 'Apple' }])).toBe('Nuggets, Apple');
    expect(entreeWords([])).toBeNull();
    // Fruit offered is any number, so commas; a choice is "or".
    const sections = menuSections(day!.items);
    expect(sectionWords(sections[1]!)).toBe('Corn, Orange, Cucumber slices');
    expect(sectionWords(sections[2]!)).toBe('1% milk or Chocolate milk');
  });
});
