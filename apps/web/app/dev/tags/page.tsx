import type { Metadata } from 'next';
import type { TagRow } from '../../(admin)/admin/chores/data';
import { TagsView } from '../../(admin)/admin/tags/view';

// [CHR-10][NFR-18] Tags (WP-94) with the made-up family and no database, for the UI suite and the
// side-by-side: Morning, Kitchen, Bedroom and School in use, Garden archived. ?open= a fold open, as
// after a save in it (add, archived, or a tag's name for its Edit); ?state=empty for a household with
// no tag yet; ?theme=evening.
export const metadata: Metadata = { title: 'Tags', robots: { index: false } };

const tag = (n: number, name: string, color: TagRow['color'], archived = false): TagRow => ({
  id: `c4000000-0000-4000-8000-00000000000${n}`,
  name,
  color,
  icon: null,
  archivedAt: archived ? '2026-09-01T12:00:00Z' : null,
});
const TAGS = [
  tag(1, 'Morning', 'member-6'),
  tag(2, 'Kitchen', 'member-3'),
  tag(3, 'Bedroom', 'member-4'),
  tag(4, 'School', 'member-1'),
  tag(5, 'Garden', 'member-5', true),
];

export default async function DevTagsPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string; open?: string; state?: string }>;
}) {
  const p = await searchParams;
  const theme = p.theme === 'evening' ? 'theme-evening' : 'theme-day';
  const tags = p.state === 'empty' ? [] : TAGS;
  const open = tags.find((t) => t.name === p.open)?.id ?? p.open ?? null;
  return (
    <div className={`admin ${theme}`}>
      <TagsView
        tags={tags}
        uses={{ [TAGS[0]!.id]: 4, [TAGS[1]!.id]: 3, [TAGS[2]!.id]: 2, [TAGS[3]!.id]: 3 }}
        saved={null}
        open={open}
        waiting={2}
        who={{ name: 'Alex', avatarKey: 'owl', color: 'member-1' }}
      />
    </div>
  );
}
