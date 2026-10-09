import { describe, expect, it } from 'vitest';
import { parseTag, tagSaveMessage } from './tags';

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe('parseTag', () => {
  it('[CHR-10] reads a name, color and icon; spaces are tidied', () => {
    expect(
      parseTag(form({ name: '  Kitchen   & dishes ', color: 'member-3', icon: 'chore-dishes' })),
    ).toEqual({
      ok: true,
      value: { name: 'Kitchen & dishes', color: 'member-3', icon: 'chore-dishes' },
    });
  });

  it('[CHR-10] the icon is optional', () => {
    expect(parseTag(form({ name: 'Garden', color: 'member-5', icon: '' }))).toEqual({
      ok: true,
      value: { name: 'Garden', color: 'member-5', icon: null },
    });
  });

  it('[CHR-10] says what to fix', () => {
    expect(parseTag(form({ name: ' ', color: 'member-1' }))).toEqual({
      ok: false,
      message: 'Give the tag a name of up to 30 characters.',
    });
    expect(parseTag(form({ name: 'x'.repeat(31), color: 'member-1' })).ok).toBe(false);
    expect(parseTag(form({ name: 'Pink', color: 'pink' }))).toEqual({
      ok: false,
      message: 'Choose a color.',
    });
    expect(parseTag(form({ name: 'Odd', color: 'member-1', icon: 'nope' }))).toEqual({
      ok: false,
      message: 'Choose an icon.',
    });
  });

  it('[CHR-10] a duplicate name, archived ones included, points to restoring it', () => {
    expect(tagSaveMessage({ code: '23505' })).toMatch(/already a tag with that name/);
    expect(tagSaveMessage({ code: '08006' })).toBe('That didn’t save. Try again in a moment.');
  });
});
