import { Banner, Button, Icon } from '@familywise/ui';
import {
  type BoardSleep,
  type SchoolDays,
  sleepStatus,
  hhmm,
  IDLE_CHOICES,
  idleLabel,
  MISSED_CHOICES,
  sleepSummary,
} from '@/lib/board-sleep';
import { setBoardSleep } from './actions';

/** The times a board without set times is offered: the mockup's (D-116). */
const DEFAULT_TIMES = {
  school: { sleep: 21 * 60 + 30, wake: 6 * 60 + 30 },
  weekend: { sleep: 22 * 60 + 30, wake: 7 * 60 + 30 },
};

/**
 * [DEV-07][US-207] A board's "Sleep and wake" on Boards (WP-34, D-116): when it counts as
 * missed, its set times for school nights and weekends, and how long untouched before it sleeps.
 * It folds like the board's Calendars and Home screen, its summary saying how it is set.
 */
export function SleepForm({
  device,
  name,
  sleep,
  open,
  notice,
}: {
  device: string;
  name: string;
  sleep: BoardSleep;
  open: boolean;
  /** Saved, or not, just now. */
  notice?: 'saved' | 'error' | null;
}) {
  const times = sleep.schedule ?? DEFAULT_TIMES;
  const id = (k: string) => `${k}-${device}`;
  return (
    <details id={`sleep-${device}`} className="fw-board-cals" open={open}>
      <summary>
        Sleep and wake on {name}: {sleepSummary(sleep)}
      </summary>
      {notice === 'error' ? (
        <Banner kind="notice">
          That wasn’t saved. Give each night a sleep time and a different wake time.
        </Banner>
      ) : notice === 'saved' ? (
        <Banner kind="info">Saved sleep and wake for {name}. It follows them in a moment.</Banner>
      ) : null}
      <form action={setBoardSleep} className="fw-form" aria-label={`Sleep and wake for ${name}`}>
        <input type="hidden" name="id" value={device} />
        <input type="hidden" name="name" value={name} />

        <fieldset className="fw-field fw-fieldset">
          <legend className="fw-field__label">Tell me when {name} isn’t seen</legend>
          <div className="fw-sleep-choices">
            {MISSED_CHOICES.map((c) => (
              <label key={c.value} className="fw-choice fw-sleep-choice">
                <input
                  type="radio"
                  name="missed"
                  value={c.value}
                  defaultChecked={sleep.missed === c.value}
                />
                <span>
                  {c.label}
                  <span className="fw-field__help">{c.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="fw-field fw-fieldset">
          <legend className="fw-field__label">Sleep at night</legend>
          <label className="fw-choice">
            <input type="checkbox" name="scheduled" defaultChecked={sleep.schedule !== null} />
            {name} sleeps and wakes at set times
          </label>
          <div className="fw-sleep-nights">
            {(
              [
                [
                  'school',
                  'School nights',
                  'Sunday to Thursday night, when school is the next day.',
                ],
                [
                  'weekend',
                  'Weekends and days off',
                  'Friday and Saturday night, and any night before a day off from school.',
                ],
              ] as const
            ).map(([k, title, help]) => (
              <div key={k} className="fw-sleep-night">
                <strong>{title}</strong>
                <div className="fw-actions">
                  <label className="fw-field" htmlFor={id(`${k}-sleep`)}>
                    <span className="fw-field__help">Sleeps at</span>
                    <input
                      id={id(`${k}-sleep`)}
                      className="fw-input"
                      type="time"
                      name={`${k}_sleep`}
                      defaultValue={hhmm(times[k].sleep)}
                    />
                  </label>
                  <label className="fw-field" htmlFor={id(`${k}-wake`)}>
                    <span className="fw-field__help">Wakes at</span>
                    <input
                      id={id(`${k}-wake`)}
                      className="fw-input"
                      type="time"
                      name={`${k}_wake`}
                      defaultValue={hhmm(times[k].wake)}
                    />
                  </label>
                </div>
                <span className="fw-field__help">{help}</span>
              </div>
            ))}
          </div>
          <span className="fw-field__help">
            School days come from School in Settings. Without a school year, every weekday is a
            school day.
          </span>
        </fieldset>

        <div className="fw-field">
          <label className="fw-field__label" htmlFor={id('idle')}>
            Sleep when nobody touches it
          </label>
          <select
            id={id('idle')}
            className="fw-input"
            name="idle"
            defaultValue={sleep.idleMinutes ? String(sleep.idleMinutes) : 'never'}
          >
            <option value="never">Never</option>
            {IDLE_CHOICES.map((m) => (
              <option key={m} value={String(m)}>
                After {idleLabel(m)}
              </option>
            ))}
          </select>
          <span className="fw-field__help">
            A touch, a click or moving the mouse wakes it. That first touch only wakes it: it never
            checks off a chore or presses a button. A touch in the night wakes it for this long (5
            minutes if Never), then it sleeps again.
          </span>
        </div>

        <div className="fw-actions">
          <Button type="submit" variant="secondary" icon="moon">
            Save sleep and wake
          </Button>
        </div>
      </form>
    </details>
  );
}

/** [DEV-07] Whether a board is asleep at its set times now, and when that changes; none without. */
export function SleepStatus({
  sleep,
  now,
  timeZone,
  school,
}: {
  sleep: BoardSleep;
  now: number;
  timeZone: string;
  school: SchoolDays | null;
}) {
  const st = sleepStatus(sleep, now, timeZone, school);
  return st ? (
    <span className="fw-sleep-status" data-asleep={st.asleep}>
      <Icon name={st.asleep ? 'moon' : 'sun'} size={18} />
      {st.text}
    </span>
  ) : null;
}
