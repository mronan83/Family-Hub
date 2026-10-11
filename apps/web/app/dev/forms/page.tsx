import type { Metadata } from 'next';
import { CalendarForm } from '../../(admin)/admin/calendars/calendar-form';
import {
  ChoreForm,
  type MemberOption,
  type TagOption,
} from '../../(admin)/admin/chores/chore-form';
import { AdminHeader } from '../../(admin)/admin/header';
import { MemberForm } from '../../(admin)/admin/members/member-form';
import { TagForm } from '../../(admin)/admin/tags/tag-form';

// The forms that choose an icon or a color (WP-46, D-70) with a made-up family and no database, for
// the UI suite: the one icon picker (search, groups, chosen) and the sixteen colors, on a phone and a
// laptop, in Day and Evening (?theme=evening). ?form=chore (default), tag, member or calendar;
// ?form=chore&icon=washing-machine edits an item with a Lucide icon, and &icon=image one whose icon
// the picker no longer offers.
export const metadata: Metadata = { title: 'Forms', robots: { index: false } };

const MEMBERS: MemberOption[] = [
  {
    id: 'f1000000-0000-4000-8000-000000000001',
    displayName: 'Maya',
    avatarKey: 'fox',
    color: 'member-3',
  },
  {
    id: 'f1000000-0000-4000-8000-000000000002',
    displayName: 'Leo',
    avatarKey: 'frog',
    color: 'member-11',
  },
  {
    id: 'f1000000-0000-4000-8000-000000000003',
    displayName: 'Alex',
    avatarKey: null,
    color: 'member-14',
  },
];
const TAGS: TagOption[] = [
  {
    id: 'f2a00000-0000-4000-8000-000000000001',
    name: 'Morning',
    color: 'member-8',
    icon: 'sunrise',
  },
  {
    id: 'f2a00000-0000-4000-8000-000000000002',
    name: 'Kitchen',
    color: 'member-12',
    icon: 'cooking-pot',
  },
  { id: 'f2a00000-0000-4000-8000-000000000003', name: 'Garden', color: 'member-9', icon: null },
];

export default async function DevFormsPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string; form?: string; icon?: string }>;
}) {
  const params = await searchParams;
  const theme = params.theme === 'evening' ? 'theme-evening' : 'theme-day';
  const form = params.form ?? 'chore';
  const editing = params.icon === 'washing-machine' || params.icon === 'image';
  return (
    <div className={`admin ${theme}`}>
      <main className="fw-page">
        <AdminHeader current={form === 'chore' || form === 'tag' ? '/admin/chores' : '/admin'} />
        <section className="fw-card">
          {form === 'tag' ? (
            <>
              <h1>Add a tag</h1>
              <TagForm />
            </>
          ) : form === 'member' ? (
            <>
              <h1>Add a member</h1>
              <MemberForm admins={[]} />
            </>
          ) : form === 'calendar' ? (
            <>
              <h1>Add a calendar</h1>
              <CalendarForm members={MEMBERS} />
            </>
          ) : (
            <>
              <h1>{editing ? 'Do the laundry' : 'Add a chore'}</h1>
              <ChoreForm
                id={editing ? 'f2c00000-0000-4000-8000-000000000001' : undefined}
                initial={
                  editing
                    ? {
                        kind: 'chore',
                        title: 'Do the laundry',
                        icon: params.icon === 'image' ? 'image' : 'washing-machine',
                        assignees: [MEMBERS[0]!.id],
                        assignment: 'each',
                        schedule: { freq: 'weekly', by_weekday: [6] },
                        dueTime: null,
                        points: 10,
                        tags: [TAGS[0]!.id],
                        visibility: 'family',
                        approval: 'inherit',
                        dayTypes: ['school_day', 'no_school', 'break', 'weekend', 'summer'],
                        remindLeadMinutes: null,
                      }
                    : undefined
                }
                today="2026-10-10"
                members={MEMBERS}
                tags={TAGS}
                approvalMode="off"
                offerVisibility
              />
            </>
          )}
        </section>
      </main>
    </div>
  );
}
