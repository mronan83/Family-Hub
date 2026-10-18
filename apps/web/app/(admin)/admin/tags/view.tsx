import { Banner, Button, Fold, Icon } from '@familywise/ui';
import Link from 'next/link';
import { archivedLine } from '@/lib/setup-facts';
import type { TagRow } from '../chores/data';
import { Line } from '../fold-line';
import { AdminHeader } from '../header';
import { HoldRow } from '../hold-row';
import type { NavWho } from '../nav';
import { setTagArchived } from './actions';
import { TagForm } from './tag-form';

/**
 * [CHR-10] The household's tags (D-33): add, rename, recolor and archive. Items, filters and goals
 * keep a tag's id, so a rename changes nothing they count, and an archived tag keeps working for the
 * goals and history that use it while it is no longer offered for new items. [NFR-18][D-120] Add a
 * tag folds to its button, Our tags stays open, Archived folds to its count (WP-94); a tag edited,
 * or Archived after an archive, comes back open. [D-132] Each tag is a two-line row with ⋯ (Edit,
 * Archive), as Chores' rows (WP-96, Q11); Edit opens its form in place under the row.
 */
export function TagsView({
  tags,
  uses,
  saved,
  open = null,
  waiting,
  who,
  menu = null,
}: {
  tags: TagRow[];
  /** How many items use each tag, by its id. */
  uses: Record<string, number>;
  saved: string | null;
  /** "add", "archived", or a tag's id: the fold saved in. */
  open?: string | null;
  waiting?: number;
  who?: NavWho | null;
  /** The dev page's picture of a tag's ⋯ open: its id. */
  menu?: string | null;
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
          <ul className="fw-rows" aria-label="Tags">
            {active.map((t) => (
              <HoldRow
                key={t.id}
                id={`tag-${t.id}`}
                menuLabel={`More for ${t.name}`}
                open={menu === t.id}
                menu={
                  <>
                    <Link
                      className="fw-row__mi"
                      href={`/admin/tags?open=${t.id}#tag-${t.id}`}
                      aria-label={`Edit ${t.name}`}
                    >
                      <Icon name="edit" size={20} />
                      Edit
                    </Link>
                    <span className="fw-row__sep" aria-hidden />
                    <form action={setTagArchived}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="archive" value="true" />
                      <button
                        type="submit"
                        className="fw-row__mi fw-row__mi--arch"
                        aria-label={`Archive ${t.name}`}
                      >
                        <Icon name="archive" size={20} />
                        Archive
                      </button>
                    </form>
                  </>
                }
                after={
                  open === t.id ? (
                    <div className="fw-form">
                      <TagForm id={t.id} initial={{ name: t.name, color: t.color, icon: t.icon }} />
                      <Link href="/admin/tags">Cancel</Link>
                    </div>
                  ) : null
                }
              >
                <span className="fw-row__icon">
                  <span
                    className="fw-swatch"
                    style={{ background: `var(--${t.color}-line)` }}
                    aria-hidden
                  />
                </span>
                <span className="fw-row__l1">
                  <Link className="fw-row__name" href={`/admin/tags?open=${t.id}#tag-${t.id}`}>
                    {t.name}
                  </Link>
                  {t.icon ? <Icon name={t.icon} size={20} /> : null}
                </span>
                <span className="fw-row__l2">
                  <Link href={`/admin/chores?tag=${t.id}`}>
                    {uses[t.id] ?? 0} {uses[t.id] === 1 ? 'item' : 'items'}
                  </Link>
                </span>
              </HoldRow>
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
