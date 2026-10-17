import { Banner, Button, Fold, Icon, type IconName } from '@familywise/ui';
import Link from 'next/link';
import { type MealRow, SLOT_WORDS } from '@/lib/meals';
import { AdminHeader } from '../../header';
import { setMealArchived } from '../actions';
import { MealForm } from '../meal-form';

/** "Breakfast or lunch", or "Any meal" when none is ticked. */
const goodFor = (m: MealRow) =>
  m.mealTypes.length === 0
    ? 'Any meal'
    : m.mealTypes
        .map((t, i) => (i === 0 ? SLOT_WORDS[t] : SLOT_WORDS[t].toLowerCase()))
        .join(m.mealTypes.length === 2 ? ' or ' : ', ')
        .replace(/, ([^,]*)$/, ' or $1');

/**
 * [MEAL-02][NFR-18] The meal library: Add a meal folded to its button (WP-93); Our meals open, each
 * one with what it's good for and its recipe, to change or archive (plans that use it keep its
 * name); Archived folded to its count, to restore, and open again after a meal is archived (D-120).
 */
export function MealLibraryView({
  meals,
  notice,
  error,
  openArchived = false,
}: {
  meals: MealRow[];
  notice: string | null;
  error: string | null;
  /** Archived shown open: just after a meal was archived. */
  openArchived?: boolean;
}) {
  const active = meals.filter((m) => !m.archivedAt);
  const archived = meals.filter((m) => m.archivedAt);
  return (
    <main className="fw-page">
      <AdminHeader current="/admin/meals" />
      {error ? (
        <Banner kind="notice">{error}</Banner>
      ) : notice ? (
        <Banner kind="info">{notice}</Banner>
      ) : null}
      <section className="fw-card" aria-labelledby="library-heading">
        <h1 id="library-heading">Meal library</h1>
        <p className="fw-muted">
          The meals your family makes again, to choose from when you plan. Back to{' '}
          <Link href="/admin/meals">the week’s meals</Link>.
        </p>
      </section>

      {/* With no meal yet, adding one is all there is to do here. */}
      <Fold
        id="add-meal"
        title="Add a meal"
        headingId="add-meal-heading"
        button={{ label: 'Add a meal', icon: 'plus' }}
        open={meals.length === 0}
      >
        <MealForm />
      </Fold>

      <section className="fw-card" aria-labelledby="our-meals-heading">
        <h2 id="our-meals-heading">Our meals</h2>
        {active.length === 0 ? (
          <p className="fw-muted">No meals yet. Add the ones you make most.</p>
        ) : (
          <ul className="fw-list" aria-label="Meals">
            {active.map((m) => (
              <li key={m.id} className="fw-list__row fw-list__row--stack">
                <span className="fw-item">
                  <span className="fw-reward__icon" aria-hidden>
                    <Icon name={m.icon as IconName} size={28} />
                  </span>
                  <span className="fw-item__body">
                    <strong>{m.name}</strong>
                    <span className="fw-muted">
                      {goodFor(m)}
                      {m.description ? ` · ${m.description}` : ''}
                    </span>
                    {m.recipeUrl ? (
                      <a href={m.recipeUrl} target="_blank" rel="noopener noreferrer">
                        Recipe for {m.name}
                      </a>
                    ) : null}
                  </span>
                </span>
                <details>
                  <summary>Edit {m.name}</summary>
                  <MealForm
                    id={m.id}
                    initial={{
                      name: m.name,
                      description: m.description,
                      icon: m.icon,
                      mealTypes: m.mealTypes,
                      recipeUrl: m.recipeUrl,
                    }}
                  />
                  <form action={setMealArchived}>
                    <input type="hidden" name="id" value={m.id} />
                    <input type="hidden" name="archive" value="true" />
                    <Button type="submit" variant="ghost" icon="minus-circle">
                      Archive {m.name}
                    </Button>
                  </form>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      {archived.length > 0 ? (
        <Fold
          id="archived-meals"
          title="Archived"
          headingId="archived-meals-heading"
          summary={[<b key="n">{archived.length} archived</b>]}
          open={openArchived}
        >
          <p className="fw-muted">Not offered when you plan; plans that used them keep them.</p>
          <ul className="fw-list" aria-label="Archived meals">
            {archived.map((m) => (
              <li key={m.id} className="fw-list__row">
                <span>{m.name}</span>
                <form action={setMealArchived}>
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="archive" value="false" />
                  <Button type="submit" variant="ghost" icon="undo">
                    Restore {m.name}
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
