import { Banner, Button, Fold, Icon } from '@familywise/ui';
import Link from 'next/link';
import { archivedLine } from '@/lib/setup-facts';
import type { TagRow } from '../chores/data';
import { Line } from '../fold-line';
import { AdminHeader } from '../header';
import type { NavWho } from '../nav';
import { setTagArchived } from './actions';
import { TagForm } from './tag-form';

/**
 * [CHR-10] The household's tags (D-33): add, rename, recolor and archive. Items, filters and goals
 * keep a tag's id, so a rename changes nothing they count, and an archived tag keeps working for the
 * goals and history that use it while it is no longer offered for new items. [NFR-18][D-120] Add a
 * tag folds to its button, Our tags stays open with each tag's Edit in the fold's look, Archived
 * folds to its count (WP-94); a tag edited, or Archived after an archive, comes back open.
 */
export function TagsView({
  tags,
  uses,
  saved,
  open = null,
  waiting,
  who,
}: {
  tags: TagRow[];
  /** How many items use each tag, by its id. */
  uses: Record<string, number>;
  saved: string | null;
  /** "add", "archived", or a tag's id: the fold saved in. */
  open?: string | null;
  waiting?: number;
  who?: NavWho | null;
}) {
  const active = tags.filter((t) => !t.archivedAt);
  const archived = tags.filter((t) => t.archivedAt);
  return (
    <main className="fw-page">
      <AdminHeader current="/admin/tags" waiting={waiting} who={who} />
      {saved ? <Banner kind="info">Saved {saved}.</Banner> : null}
      <section className="fw-card" aria-labelledby="tags-heading">
        <h1 id="tags-heading">Tags</h1>
        <p className="fw-muted">
          Tags group chores and tasks, like Morning or Kitchen. Filter the list by them, and later
          set goals that count them. Renaming a tag keeps every goal working.
        </p>
      </section>

      {/* With no tag yet, adding one is all there is to do here. */}
      <Fold
        id="add-tag"
        title="Add a tag"
        headingId="add-tag-heading"
        button={{ label: 'Add a tag', icon: 'plus' }}
        open={open === 'add' || tags.length === 0}
      >
        <TagForm />
      </Fold>

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
                    {uses[t.id] ?? 0} {uses[t.id] === 1 ? 'item' : 'items'}
                  </Link>
                </span>
                <Fold
                  variant="inner"
                  id={`tag-${t.id}`}
                  title={`Edit ${t.name}`}
                  open={open === t.id}
                >
                  <TagForm id={t.id} initial={{ name: t.name, color: t.color, icon: t.icon }} />
                  <form action={setTagArchived} className="fw-fold__apart">
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="archive" value="true" />
                    <Button type="submit" variant="ghost" icon="minus-circle">
                      Archive {t.name}
                    </Button>
                  </form>
                </Fold>
              </li>
            ))}
          </ul>
        )}
      </section>

      {archived.length > 0 ? (
        <Fold
          id="archived"
          title="Archived"
          headingId="archived-tags-heading"
          open={open === 'archived'}
          summary={[<Line key="a" line={archivedLine(archived.map((t) => t.name))} />]}
        >
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
        </Fold>
      ) : null}
    </main>
  );
}
