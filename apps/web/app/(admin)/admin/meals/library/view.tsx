import { Banner, Button, Fold, Icon, type IconName } from '@familywise/ui';
import { mealCopy } from '@/lib/meal-copy';
import type { MealFormValue } from '@/lib/meals';
import Link from 'next/link';
import { type MealRow, SLOT_WORDS } from '@/lib/meals';
import { AdminHeader } from '../../header';
import { HoldRow } from '../../hold-row';
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

/** A meal as its form takes it. */
const formValue = (m: MealRow): MealFormValue => ({
  name: m.name,
  description: m.description,
  icon: m.icon,
  mealTypes: m.mealTypes,
  recipeUrl: m.recipeUrl,
  ingredients: m.ingredients ?? [],
  recipeSteps: m.recipeSteps ?? [],
  recipeFiles: m.recipeFiles ?? [],
});

/**
 * [MEAL-02][NFR-18] The meal library: Add a meal folded to its button (WP-93); Our meals open, each
 * one with what it's good for and its recipe, to change or archive (plans that use it keep its
 * name); Archived folded to its count, to restore, and open again after a meal is archived (D-120).
 * [D-132] Each meal is one two-line row with ⋯ (Edit, Duplicate, Archive), as Chores' rows (WP-96,
 * Q10): Edit opens its form in place under the row; Duplicate opens Add a meal filled in, "(copy)".
 */
export function MealLibraryView({
  meals,
  notice,
  error,
  openArchived = false,
  householdId,
  editing = null,
  copy = null,
  menu = null,
}: {
  meals: MealRow[];
  notice: string | null;
  error: string | null;
  /** Archived shown open: just after a meal was archived. */
  openArchived?: boolean;
  /** [MEAL-25] Where the meals' photos and PDFs go in storage (WP-105). */
  householdId: string;
  /** A meal's form shown open under its row (?edit=). */
  editing?: string | null;
  /** Duplicate: Add a meal opened, filled in from this meal (?copy=). */
  copy?: string | null;
  /** The dev page's picture of a meal's ⋯ open: its id. */
  menu?: string | null;
}) {
  const original = copy ? meals.find((m) => m.id === copy) : undefined;
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
        open={meals.length === 0 || Boolean(original)}
      >
        {original ? (
          <Banner kind="info">
            A copy of <b>{original.name}</b>. Nothing is saved until you tap <b>Add meal</b>.
          </Banner>
        ) : null}
        <MealForm
          key={original?.id ?? 'new'}
          householdId={householdId}
          copy={original ? mealCopy(original) : undefined}
          copyFrom={original?.id}
        />
      </Fold>

      <section className="fw-card" aria-labelledby="our-meals-heading">
        <h2 id="our-meals-heading">Our meals</h2>
        {active.length === 0 ? (
          <p className="fw-muted">No meals yet. Add the ones you make most.</p>
        ) : (
          <ul className="fw-rows" aria-label="Meals">
            {active.map((m) => (
              <HoldRow
                key={m.id}
                id={`meal-${m.id}`}
                className="fw-row--tile"
                menuLabel={`More for ${m.name}`}
                open={menu === m.id}
                menu={
                  <>
                    <Link
                      className="fw-row__mi"
                      href={`/admin/meals/library?edit=${m.id}#meal-${m.id}`}
                      aria-label={`Edit ${m.name}`}
                    >
                      <Icon name="edit" size={20} />
                      Edit
                    </Link>
                    <Link
                      className="fw-row__mi"
                      href={`/admin/meals/library?copy=${m.id}#add-meal`}
                      aria-label={`Duplicate ${m.name}`}
                    >
                      <Icon name="copy" size={20} />
                      Duplicate
                    </Link>
                    <span className="fw-row__sep" aria-hidden />
                    <form action={setMealArchived}>
                      <input type="hidden" name="id" value={m.id} />
                      <input type="hidden" name="archive" value="true" />
                      <button
                        type="submit"
                        className="fw-row__mi fw-row__mi--arch"
                        aria-label={`Archive ${m.name}`}
                      >
                        <Icon name="archive" size={20} />
                        Archive
                      </button>
                    </form>
                  </>
                }
                after={
                  editing === m.id ? (
                    <div className="fw-form">
                      <MealForm householdId={householdId} id={m.id} initial={formValue(m)} />
                      <Link href="/admin/meals/library">Cancel</Link>
                    </div>
                  ) : null
                }
              >
                <span className="fw-row__icon">
                  <span className="fw-row__tile" aria-hidden>
                    <Icon name={m.icon as IconName} size={22} />
                  </span>
                </span>
                <span className="fw-row__l1">
                  <Link
                    className="fw-row__name"
                    href={`/admin/meals/library?edit=${m.id}#meal-${m.id}`}
                  >
                    {m.name}
                  </Link>
                </span>
                <span className="fw-row__l2">
                  {goodFor(m)}
                  {m.ingredients?.length
                    ? ` · ${m.ingredients.length} ingredient${m.ingredients.length === 1 ? '' : 's'}`
                    : ''}
                  {m.description ? ` · ${m.description}` : ''}
                  {m.recipeUrl ? (
                    <>
                      {' · '}
                      <a
                        href={m.recipeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Recipe for ${m.name}`}
                      >
                        Recipe
                      </a>
                    </>
                  ) : null}
                </span>
              </HoldRow>
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
