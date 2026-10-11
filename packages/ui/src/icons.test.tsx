import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ICON_GROUPS, ICON_INDEX } from './generated/icon-index';
import { ICON_NAMES, type IconName } from './generated/icons';
import { iconLabel } from './Icon';
import { IconPicker, iconMatches } from './IconPicker';

const offered = ICON_GROUPS.flatMap((g) => g.icons);

describe('the icon set (D-70)', () => {
  it('[CHR-01] has our own icons and the Lucide ones, over 300 in all', () => {
    expect(ICON_NAMES.length).toBeGreaterThan(300);
    expect(ICON_NAMES).toContain('chore-bed');
    expect(ICON_NAMES).toContain('washing-machine');
  });

  it('[CHR-10] every name fits the database icon checks', () => {
    for (const name of ICON_NAMES) expect(name).toMatch(/^[a-z][a-z0-9-]{0,31}$/);
  });

  it('[CHR-01] offers every icon in one group only, and every chore icon', () => {
    expect(new Set(offered).size).toBe(offered.length);
    for (const name of offered) expect(ICON_NAMES).toContain(name);
    for (const name of ICON_NAMES.filter((n) => n.startsWith('chore-')))
      expect(offered).toContain(name);
  });

  it("never offers the app's own controls", () => {
    for (const name of ['chevron-left', 'close', 'menu', 'logout', 'more', 'trash'] as IconName[])
      expect(offered).not.toContain(name);
  });

  it('[NFR-13] gives every icon its own spoken name', () => {
    const labels = ICON_NAMES.map(iconLabel);
    expect(labels.filter((l, i) => labels.indexOf(l) !== i)).toEqual([]);
  });

  it('[NFR-13] names a numbered Lucide icon by its word', () => {
    expect(iconLabel('building-2')).toBe('building');
    expect(iconLabel('bed-double')).toBe('bed double');
  });

  it('keeps search words lowercase plain words', () => {
    for (const name of ICON_NAMES)
      for (const k of ICON_INDEX[name].keywords) expect(k).toMatch(/^[a-z0-9][a-z0-9 &.,:/()+-]*$/);
  });
});

describe('icon search', () => {
  it.each([
    ['dog', 'dog'],
    ['make bed', 'chore-bed'],
    ['laund', 'washing-machine'],
    ['LAUNDRY', 'chore-laundry'],
    ['vacuum', 'chore-vacuum'],
    ['rubbish', 'chore-bin'],
    ['tub', 'bathtub'],
    ['snow', 'snowflake'],
  ] as [string, IconName][])('[CHR-01] "%s" finds %s', (query, icon) => {
    expect(iconMatches(icon, '', query)).toBe(true);
  });

  it('matches a group by its name, and nothing for a made-up word', () => {
    expect(iconMatches('pizza', 'Kitchen and food', 'kitchen')).toBe(true);
    expect(ICON_NAMES.filter((n) => iconMatches(n, '', 'zzzq'))).toEqual([]);
  });
});

describe('IconPicker', () => {
  const html = (el: React.ReactElement) => renderToStaticMarkup(el);

  it('[CHR-01] renders every offered icon as a radio, the chosen one checked', () => {
    const out = html(<IconPicker legend="Icon" selected="washing-machine" start="home" />);
    expect(out.match(/type="radio"/g)).toHaveLength(offered.length);
    expect(out).toMatch(/checked="" value="washing-machine"/);
    expect(out).toContain('Chosen: washing machine');
    expect(out.indexOf('aria-label="Home"')).toBeLessThan(
      out.indexOf('aria-label="Kitchen and food"'),
    );
  });

  it('[CHR-10] offers "No icon" when the icon is optional', () => {
    const out = html(<IconPicker legend="Icon (optional)" selected={null} optional start="tags" />);
    expect(out).toMatch(/checked="" value=""/);
    expect(out).toContain('No icon chosen');
    expect(out.indexOf('aria-label="People and labels"')).toBeLessThan(
      out.indexOf('aria-label="Home"'),
    );
  });

  it('keeps an icon chosen before that the picker no longer offers', () => {
    const out = html(<IconPicker legend="Icon" selected="image" />);
    expect(out).toMatch(/checked="" value="image"/);
    expect(out.match(/type="radio"/g)).toHaveLength(offered.length + 1);
  });
});
