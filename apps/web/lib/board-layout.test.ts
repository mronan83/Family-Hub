import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT,
  effectiveLayout,
  layoutFromForm,
  moveCard,
  readLayout,
} from './board-layout';

// [BRD-05][US-1004] The home screen's layout (WP-35, D-67): what's stored, what a board shows, and
// what the admin form saves.
describe('reading a stored layout', () => {
  it('[BRD-05] the empty layout is the defaults: five days, every card, in order', () => {
    expect(readLayout({})).toEqual(DEFAULT_LAYOUT);
    expect(DEFAULT_LAYOUT).toEqual({
      calendar: '5',
      cards: [
        { id: 'meals', show: true },
        { id: 'goals', show: true },
        { id: 'waiting', show: true },
        { id: 'coming', show: true },
      ],
      weather: true,
    });
  });

  it('[BRD-04][BRD-05] the weather shows unless a layout turns it off', () => {
    expect(readLayout({ weather: false })?.weather).toBe(false);
    expect(readLayout({ weather: 'no' })?.weather).toBe(true);
    expect(readLayout({})?.weather).toBe(true);
  });

  it('[BRD-05] a card not listed shows after those listed; unknown or repeated ones are left out', () => {
    expect(
      readLayout({
        calendar: 'month',
        cards: [
          { id: 'coming', show: true },
          { id: 'weather', show: true },
          { id: 'coming', show: false },
          { id: 'goals', show: false },
          { id: 'waiting', show: 'yes' },
        ],
      }),
    ).toEqual({
      calendar: 'month',
      cards: [
        { id: 'coming', show: true },
        { id: 'goals', show: false },
        { id: 'meals', show: true },
        { id: 'waiting', show: true },
      ],
      weather: true,
    });
  });

  it('[BRD-05] a span it doesn’t know is five days; nothing at all is no layout', () => {
    expect(readLayout({ calendar: '4' })?.calendar).toBe('5');
    expect(readLayout('7')).toEqual(DEFAULT_LAYOUT);
    expect(readLayout(null)).toBeNull();
    expect(readLayout(undefined)).toBeNull();
  });
});

describe('what a board shows', () => {
  it('[BRD-05][D-67] its own layout, else the household’s, else the defaults', () => {
    const household = { calendar: '7' };
    const own = { calendar: '3' };
    expect(effectiveLayout(household, own).calendar).toBe('3');
    expect(effectiveLayout(household, null).calendar).toBe('7');
    expect(effectiveLayout(undefined, null)).toEqual(DEFAULT_LAYOUT);
  });
});

describe('changing a layout', () => {
  it('[US-1004] a card moves a place up or down, and stays put at either end', () => {
    const up = moveCard(DEFAULT_LAYOUT, 'waiting', -1);
    expect(up.cards.map((c) => c.id)).toEqual(['meals', 'waiting', 'goals', 'coming']);
    expect(moveCard(DEFAULT_LAYOUT, 'meals', -1)).toBe(DEFAULT_LAYOUT);
    expect(moveCard(DEFAULT_LAYOUT, 'coming', 1)).toBe(DEFAULT_LAYOUT);
    expect(DEFAULT_LAYOUT.cards[1]!.id).toBe('goals');
  });

  it('[US-1004] the admin form: its span, its order, and the cards ticked to show', () => {
    expect(layoutFromForm('month', ['coming', 'goals', 'bogus'], ['goals'])).toEqual({
      calendar: 'month',
      cards: [
        { id: 'coming', show: false },
        { id: 'goals', show: true },
        { id: 'meals', show: false },
        { id: 'waiting', show: false },
      ],
      weather: true,
    });
    expect(layoutFromForm('2', [], []).calendar).toBe('5');
    expect(layoutFromForm('5', [], [], null).weather).toBe(false);
  });
});
