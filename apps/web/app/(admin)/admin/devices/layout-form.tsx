import { Button } from '@familywise/ui';
import {
  type BoardLayout,
  CALENDAR_SPANS,
  CARD_LABELS,
  isRowCard,
  SPAN_LABELS,
} from '@/lib/board-layout';
import { saveBoardLayout } from './actions';

/**
 * [BRD-05][US-1004] A home screen layout (WP-35, D-67): what the calendar shows, and the cards under
 * it, ticked to show and in order; (WP-45) whether the weather shows; and (WP-28) whether today's
 * meals show above Today's list. Moving a card saves at once; so does Save.
 */
export function LayoutForm({
  layout,
  device,
  name,
}: {
  layout: BoardLayout;
  /** The board with its own layout, or null for the household's. */
  device: string | null;
  /** Who it's for, in the notice after saving: a board's name, or "every board". */
  name: string;
}) {
  const key = device ?? 'household';
  const row = layout.cards.filter((c) => isRowCard(c.id));
  const meals = layout.cards.find((c) => c.id === 'meals');
  return (
    <form
      action={saveBoardLayout}
      className="fw-form"
      aria-label={device ? `Home screen on ${name}` : 'Home screen for every board'}
    >
      <input type="hidden" name="device" value={device ?? ''} />
      <input type="hidden" name="name" value={name} />
      {layout.cards.map((c) => (
        <input key={c.id} type="hidden" name="order" value={c.id} />
      ))}
      <fieldset className="fw-field fw-fieldset">
        <legend className="fw-field__label">The calendar shows</legend>
        <div className="fw-picker">
          {CALENDAR_SPANS.map((s) => (
            <label key={s} className="fw-picker__item">
              <input type="radio" name="span" value={s} defaultChecked={layout.calendar === s} />
              {SPAN_LABELS[s]}
            </label>
          ))}
        </div>
      </fieldset>
      {/* [BRD-04] The weather beside the clock (WP-45), when the household has a place (Home). */}
      <label className="fw-picker__item" htmlFor={`weather-${key}`}>
        <input
          id={`weather-${key}`}
          type="checkbox"
          name="weather"
          defaultChecked={layout.weather}
        />
        <span>
          Show the weather beside the clock
          <span className="fw-muted fw-layout-cards__note">
            The temperature now and today’s high, once a place is set on Home
          </span>
        </span>
      </label>
      {/* [MEAL-06][D-80] Today's meals (WP-28), above Today's list: shown or not, with no place in the order. */}
      <label className="fw-picker__item" htmlFor={`show-${key}-meals`}>
        <input
          id={`show-${key}-meals`}
          type="checkbox"
          name="show"
          value="meals"
          defaultChecked={meals?.show ?? true}
        />
        <span>
          Show {CARD_LABELS.meals.label.toLowerCase()}
          <span className="fw-muted fw-layout-cards__note">{CARD_LABELS.meals.note}</span>
        </span>
      </label>
      <fieldset className="fw-field fw-fieldset">
        <legend className="fw-field__label">Under the calendar, in this order</legend>
        <ol className="fw-layout-cards">
          {row.map((c, i) => {
            const { label, note } = CARD_LABELS[c.id];
            return (
              <li key={c.id} className="fw-layout-cards__row">
                <label className="fw-picker__item" htmlFor={`show-${key}-${c.id}`}>
                  <input
                    id={`show-${key}-${c.id}`}
                    type="checkbox"
                    name="show"
                    value={c.id}
                    defaultChecked={c.show}
                  />
                  <span>
                    {label}
                    <span className="fw-muted fw-layout-cards__note">{note}</span>
                  </span>
                </label>
                <span className="fw-actions">
                  <Button
                    type="submit"
                    name="move"
                    value={`${c.id}:-1`}
                    variant="ghost"
                    icon="chevron-up"
                    disabled={i === 0}
                    aria-label={`Move ${label} up`}
                  >
                    Up
                  </Button>
                  <Button
                    type="submit"
                    name="move"
                    value={`${c.id}:1`}
                    variant="ghost"
                    icon="chevron-down"
                    disabled={i === row.length - 1}
                    aria-label={`Move ${label} down`}
                  >
                    Down
                  </Button>
                </span>
              </li>
            );
          })}
        </ol>
      </fieldset>
      <div className="fw-actions">
        <Button type="submit" variant="secondary" icon="check">
          Save layout
        </Button>
      </div>
    </form>
  );
}
