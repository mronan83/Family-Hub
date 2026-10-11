'use client';

import { Banner, Button } from '@familywise/ui';
import { dayName } from '@/lib/board-calendar';
import { useFormAction } from '@/lib/forms';
import { menuWords } from '@/lib/menus';
import { type CsvState, loadMenuFile } from './actions';

/**
 * [MENU-03][US-802] Load a menu file: choose it, look at what it holds (how many days, from when to
 * when, the first few), then load them. Loaded days are the parent's own: a feed never replaces them.
 */
export function MenuFileForm({
  id,
  name,
  initial,
}: {
  id: string;
  name: string;
  initial?: CsvState;
}) {
  const [state, onSubmit, pending] = useFormAction(loadMenuFile, initial ?? ({} as CsvState));
  return (
    <form onSubmit={onSubmit} className="fw-form" aria-label={`Load a file into ${name}`}>
      <input type="hidden" name="id" value={id} />
      <label className="fw-field">
        <span className="fw-field__label">Menu file (CSV)</span>
        <input className="fw-input" type="file" name="file" accept=".csv,text/csv" />
        <span className="fw-field__help">
          A row per item, with the columns date, item and (if you like) section. A date with no item
          means no lunch that day; its section says why, like Presidents’ Day.
        </span>
      </label>
      {state.problems?.length ? (
        <Banner kind="notice">
          <span>The file wasn’t loaded:</span>
          <ul className="fw-menu-problems">
            {state.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Banner>
      ) : null}
      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      {state.preview && state.days ? (
        <div className="fw-menu-preview" role="region" aria-label="The file holds">
          <p>
            <strong>
              {state.preview.count} {state.preview.count === 1 ? 'day' : 'days'}
            </strong>
            , {dayName(state.preview.first)} to {dayName(state.preview.last)}
            {state.preview.noLunch > 0 ? `, ${state.preview.noLunch} with no lunch` : ''}.
          </p>
          <ul className="fw-menu-days">
            {state.preview.sample.map((d) => (
              <li key={d.date}>
                <span className="fw-menu-days__date">{dayName(d.date)}</span>{' '}
                {menuWords(d)}
              </li>
            ))}
          </ul>
          <input type="hidden" name="days" value={state.days} />
          <p className="fw-muted">Loading replaces anything already here on those days.</p>
        </div>
      ) : null}
      <div className="fw-actions">
        <Button
          type="submit"
          name="intent"
          value="preview"
          variant="secondary"
          disabled={pending}
          icon="file-text"
        >
          {pending ? 'Reading…' : 'Look at the file'}
        </Button>
        {state.preview && state.days ? (
          <Button type="submit" name="intent" value="load" disabled={pending} icon="check">
            {`Load ${state.preview.count} ${state.preview.count === 1 ? 'day' : 'days'}`}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
