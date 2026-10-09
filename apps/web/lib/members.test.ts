import { describe, expect, it } from 'vitest';
import { memberSaveMessage, parseMember } from './members';

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const ADMIN = 'e1000000-0000-4000-8000-000000000001';

describe('parseMember', () => {
  it('[ACC-04] reads a child with an avatar and color; a child never carries a sign-in', () => {
    const parsed = parseMember(
      form({
        displayName: '  Maya ',
        role: 'child',
        avatarKey: 'fox',
        color: 'member-3',
        birthYear: '2016',
        earnsRewards: 'on',
        userId: ADMIN,
      }),
      2026,
    );
    expect(parsed).toEqual({
      ok: true,
      value: {
        displayName: 'Maya',
        role: 'child',
        avatarKey: 'fox',
        color: 'member-3',
        birthYear: 2016,
        earnsRewards: true,
        userId: null,
      },
    });
  });

  it('[ACC-04][PTS-07] reads an adult on initials, linked to an admin, switch off when unchecked', () => {
    const parsed = parseMember(
      form({
        displayName: 'Pat',
        role: 'adult',
        avatarKey: 'initials',
        color: 'member-1',
        userId: ADMIN,
      }),
    );
    expect(parsed).toMatchObject({
      ok: true,
      value: { avatarKey: null, earnsRewards: false, userId: ADMIN, birthYear: null },
    });
  });

  it.each([
    [{ displayName: '', role: 'child' }, /name/],
    [{ displayName: 'x'.repeat(41), role: 'child' }, /40 characters/],
    [{ displayName: 'Ava', role: 'pet' }, /child or adult/],
    [{ displayName: 'Ava', role: 'child', avatarKey: 'dragon' }, /avatar/],
    [{ displayName: 'Ava', role: 'child', color: '#ff0000' }, /color/],
    [{ displayName: 'Ava', role: 'child', birthYear: '2099' }, /birth year/],
    [{ displayName: 'Ava', role: 'child', birthYear: '19x0' }, /birth year/],
    [{ displayName: 'Pat', role: 'adult', userId: "x' or 1=1" }, /sign-in/],
  ])('[ACC-04] refuses %o with a plain line', (fields, message) => {
    const parsed = parseMember(form(fields as Record<string, string>), 2026);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(message);
  });
});

describe('memberSaveMessage', () => {
  it('[NFR-04] explains a refused link and a duplicate link', () => {
    expect(memberSaveMessage({ code: '23514', hint: 'member_user_not_admin' })).toMatch(
      /Invite them/,
    );
    expect(memberSaveMessage({ code: '23505' })).toMatch(/already linked/);
    expect(memberSaveMessage({ code: 'XX000' })).toMatch(/Try again/);
  });
});
