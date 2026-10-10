import { describe, expect, it } from 'vitest';
import { LINK_ERRORS, linkBack, linkCandidates, linkError } from './link-me';

const ID = '0de00000-0000-4000-8000-0000000000a1';
const member = (o: Partial<Parameters<typeof linkCandidates>[0][number]>) => ({
  role: 'adult' as const,
  userId: null,
  archivedAt: null,
  displayName: 'Alex',
  ...o,
});

describe('which one is you', () => {
  it('[CHR-14][ACC-04] offers the adults still here with no sign-in, by name', () => {
    const list = linkCandidates([
      member({ displayName: 'Sam' }),
      member({ displayName: 'Alex' }),
      member({ displayName: 'Maya', role: 'child' }),
      member({ displayName: 'Jordan', userId: 'someone' }),
      member({ displayName: 'Gone', archivedAt: '2026-10-01T00:00:00Z' }),
    ]);
    expect(list.map((m) => m.displayName)).toEqual(['Alex', 'Sam']);
  });

  it('[CHR-14] goes back only to the page it was made on', () => {
    expect(linkBack('/admin/reminders')).toBe('/admin/reminders');
    expect(linkBack('/admin/my')).toBe('/admin/my');
    expect(linkBack(`/admin/members/${ID}`)).toBe(`/admin/members/${ID}`);
    expect(linkBack('https://example.com/')).toBe('/admin/members');
    expect(linkBack('/admin/members/../../x')).toBe('/admin/members');
    expect(linkBack(null)).toBe('/admin/members');
  });

  it('[ACC-04] says why a link was refused, in the app’s words', () => {
    expect(linkError('not_adult')).toBe('link_not_adult');
    expect(LINK_ERRORS[linkError('not_adult')]).toMatch(/^Only an adult can have a sign-in/);
    expect(linkError('linked_to_someone_else')).toBe('link_linked_to_someone_else');
    expect(linkError('member_archived')).toBe('link_member_archived');
    expect(linkError('something_new')).toBe('link_failed');
    expect(linkError(null)).toBe('link_failed');
  });
});
