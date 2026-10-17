import { Banner, Button, Fold, Icon } from '@familywise/ui';
import Link from 'next/link';
import { dayAndTime } from '@/lib/format';
import type { ReminderSettings } from '@/lib/reminder-settings';
import { devicesFacts, remindLine } from '@/lib/setup-facts';
import { Line } from '../fold-line';
import { AdminHeader } from '../header';
import { type LinkCandidate, LinkMe } from '../link-me';
import { deviceAction, setReminders } from './actions';
import type { DeviceRow } from './data';
import { SettingsForm } from './settings-form';
import { ThisDevice } from './this-device';

export interface RemindersViewProps {
  /** The member linked to this sign-in; null when there is none yet. */
  me: string | null;
  /** [D-61] Without one: the adults this sign-in can be linked to, to choose from here. */
  candidates?: LinkCandidate[];
  settings: ReminderSettings;
  devices: DeviceRow[];
  vapidKey: string | null;
  timezone: string;
  notice: string | null;
  error: string | null;
  /** [NFR-18] The fold saved in, open again (WP-94). */
  open?: 'devices' | 'when' | null;
  /** A device was just removed: it could no longer get notifications. */
  removed?: boolean;
  /** For when a device was last reached; a dev page fixes it. */
  now?: Date;
}

/**
 * [CHR-15][CHR-16][CHR-17][US-317][US-318][US-319] A person's own reminders: on or off, the devices
 * they go to (test, switch off, remove), and when to remind. Nobody else sees these. [NFR-18][D-120]
 * The state line and its buttons stay open; My devices and When to remind me fold to how they stand,
 * a device just removed on its header (WP-94).
 */
export function RemindersView({
  me,
  candidates = [],
  settings,
  devices,
  vapidKey,
  timezone,
  notice,
  error,
  open = null,
  removed = false,
  now = new Date(),
}: RemindersViewProps) {
  const header = (
    <>
      <AdminHeader current="/admin/reminders" />
      {error ? (
        <Banner kind="notice">{error}</Banner>
      ) : notice ? (
        <Banner kind="info">{notice}</Banner>
      ) : null}
    </>
  );
  if (!me) {
    return (
      <main className="fw-page">
        {header}
        <section className="fw-card">
          <h1>Reminders</h1>
          <p>Reminders are for someone in the family with a sign-in.</p>
          <LinkMe candidates={candidates} back="/admin/reminders" purpose="your reminders" />
        </section>
      </main>
    );
  }
  const on = settings.enabled;
  const facts = devicesFacts(devices, removed, now, timezone);
  return (
    <main className="fw-page">
      {header}
      <section className="fw-card" aria-labelledby="reminders-heading">
        <h1 id="reminders-heading">Reminders</h1>
        <p className="fw-reminders__state" data-on={on || undefined}>
          <Icon name="bell" size={24} />
          <span>
            {on
              ? devices.some((d) => d.enabled)
                ? 'On. Reminders come to the devices below.'
                : 'On, but no device is switched on: nothing comes yet.'
              : 'Off. Nothing is sent to you.'}
          </span>
        </p>
        <div className="fw-actions">
          {!on && devices.length > 0 ? (
            <form action={setReminders}>
              <input type="hidden" name="enabled" value="on" />
              <Button type="submit" icon="bell">
                Turn reminders back on
              </Button>
            </form>
          ) : null}
          <ThisDevice
            vapidKey={vapidKey}
            label={on || devices.length > 0 ? 'Add this device' : 'Turn on reminders'}
          />
          {on ? (
            <form action={setReminders}>
              <input type="hidden" name="enabled" value="off" />
              <Button type="submit" variant="ghost" icon="minus-circle">
                Turn off reminders
              </Button>
            </form>
          ) : null}
        </div>
      </section>

      <Fold
        id="devices"
        title="My devices"
        headingId="devices-heading"
        open={open === 'devices'}
        summary={[<Line key="d" line={facts.line} />]}
        warning={facts.warning}
      >
        {devices.length === 0 ? (
          <p className="fw-muted">
            None yet. Turn on reminders on each phone or computer you want them on.
          </p>
        ) : (
          <form action={deviceAction}>
            <ul className="fw-list" aria-labelledby="devices-heading">
              {devices.map((d) => (
                <li key={d.id} className="fw-list__row fw-reward__row" data-device={d.id}>
                  <span className="fw-item">
                    <span className="fw-reward__icon" aria-hidden>
                      <Icon name={d.enabled ? 'bell' : 'minus-circle'} size={28} />
                    </span>
                    <span className="fw-item__body">
                      <strong>{d.label}</strong>
                      <span className="fw-muted">
                        {d.enabled ? 'On' : 'Off'} · added {dayAndTime(d.createdAt, timezone)}
                        {d.lastSuccessAt
                          ? ` · last reached ${dayAndTime(d.lastSuccessAt, timezone)}`
                          : ''}
                      </span>
                    </span>
                  </span>
                  <span className="fw-actions">
                    <Button
                      type="submit"
                      name="act"
                      value={`test:${d.id}`}
                      variant="secondary"
                      icon="bell"
                      aria-label={`Send a test to ${d.label}`}
                      disabled={!d.enabled}
                    >
                      Send a test
                    </Button>
                    <Button
                      type="submit"
                      name="act"
                      value={`${d.enabled ? 'off' : 'on'}:${d.id}`}
                      variant="ghost"
                      icon={d.enabled ? 'minus-circle' : 'check-circle'}
                      aria-label={`${d.enabled ? 'Switch off' : 'Switch on'} ${d.label}`}
                    >
                      {d.enabled ? 'Switch off' : 'Switch on'}
                    </Button>
                    <Button
                      type="submit"
                      name="act"
                      value={`remove:${d.id}`}
                      variant="ghost"
                      icon="trash"
                      aria-label={`Remove ${d.label}`}
                    >
                      Remove
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </form>
        )}
      </Fold>

      <Fold
        id="when"
        title="When to remind me"
        headingId="when-heading"
        open={open === 'when'}
        summary={[remindLine(settings)]}
      >
        <SettingsForm initial={settings} />
        <p className="fw-muted">
          Each item in <Link href="/admin/my">My tasks</Link> has a bell, to switch its reminders on
          or off for you. Nothing comes for an item once it’s done.
        </p>
      </Fold>
    </main>
  );
}
