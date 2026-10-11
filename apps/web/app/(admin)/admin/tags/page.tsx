import { Banner, Button, Icon } from '@familywise/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { serverClient } from '@/lib/supabase/server';
import { loadChores, loadTags } from '../chores/data';
import { AdminHeader } from '../header';
import { setTagArchived } from './actions';
import { TagForm } from './tag-form';

export const metadata: Metadata = { title: 'Tags' };

// [CHR-10] The household's tags (D-33): add, rename, recolor and archive. Items, filters and goals
// keep a tag's id, so a rename changes nothing they count, and an archived tag keeps working for the
// goals and history that use it while it is no longer offered for new items.
export default async function TagsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/tags');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const [tags, chores] = await Promise.all([
    loadTags(db!, household.id),
    loadChores(db!, household.id),
  ]);
  const uses = new Map<string, number>();
  for (const c of chores) for (const t of c.tags) uses.set(t, (uses.get(t) ?? 0) + 1);
  const active = tags.filter((t) => !t.archivedAt);
  const archived = tags.filter((t) => t.archivedAt);
  const { saved } = await searchParams;

  return (
    <main className="fw-page">
      <AdminHeader current="/admin/chores" />
      {saved ? <Banner kind="info">Saved {saved}.</Banner> : null}
      <section className="fw-card" aria-labelledby="tags-heading">
        <h1 id="tags-heading">Tags</h1>
        <p className="fw-muted">
          Tags group chores and tasks, like Morning or Kitchen. Filter the list by them, and later
          set goals that count them. Renaming a tag keeps every goal working.
        </p>
        <TagForm />
      </section>

      <section className="fw-card" aria-labelledby="our-tags-heading">
        <h2 id="our-tags-heading">Our tags</h2>
        {active.length === 0 ? (
          <p className="fw-muted">No tags yet.</p>
        ) : (
          <ul className="fw-list" aria-label="Tags">
            {active.map((t) => (
              <li key={t.id} className="fw-list__row fw-list__row--stack">
                <span className="fw-bar">
                  <span className="fw-pill fw-pill--tag">
                    <span
                      className="fw-swatch fw-swatch--small"
                      style={{ background: `var(--${t.color}-line)` }}
                      aria-hidden
                    />
                    {t.icon ? <Icon name={t.icon} size={20} /> : null}
                    {t.name}
                  </span>
                  <Link className="fw-muted" href={`/admin/chores?tag=${t.id}`}>
                    {uses.get(t.id) ?? 0} {uses.get(t.id) === 1 ? 'item' : 'items'}
                  </Link>
                </span>
                <details>
                  <summary>Edit {t.name}</summary>
                  <TagForm id={t.id} initial={{ name: t.name, color: t.color, icon: t.icon }} />
                  <form action={setTagArchived}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="archive" value="true" />
                    <Button type="submit" variant="ghost" icon="minus-circle">
                      Archive {t.name}
                    </Button>
                  </form>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      {archived.length > 0 ? (
        <section className="fw-card" aria-labelledby="archived-tags-heading">
          <h2 id="archived-tags-heading">Archived</h2>
          <p className="fw-muted">
            Not offered for items any more; goals and history that use them keep working.
          </p>
          <ul className="fw-list" aria-label="Archived tags">
            {archived.map((t) => (
              <li key={t.id} className="fw-list__row">
                <span>{t.name}</span>
                <form action={setTagArchived}>
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="archive" value="false" />
                  <Button type="submit" variant="ghost" icon="undo">
                    Restore {t.name}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
