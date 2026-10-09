import { Banner, Button } from '@familywise/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { BOARD_THEMES, boardThemeSetting } from '@/lib/devices';
import { dayAndTime } from '@/lib/format';
import { serverClient } from '@/lib/supabase/server';
import { AdminHeader } from '../header';
import { disconnectDevice, renameDevice, setBoardTheme } from './actions';
import { PairingForm } from './pairing-form';

export const metadata: Metadata = { title: 'Boards' };

interface DeviceRow {
  id: string;
  name: string;
  status: 'active' | 'revoked';
  last_seen_at: string | null;
  created_at: string;
  revoked_at: string | null;
  board_config: unknown;
}

// [DEV-01][DEV-03][DEV-05] The household's boards: pair a new one, rename, set its theme, see when
// each was last seen, and disconnect one that is lost or retired. Disconnected boards stay listed.
export default async function DevicesPage() {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/devices');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const { data, error } = await db!
    .from('device')
    .select('id, name, status, last_seen_at, created_at, revoked_at, board_config')
    .eq('household_id', household.id)
    .order('created_at');
  if (error) throw new Error(`devices: ${error.message}`);
  const devices = (data ?? []) as DeviceRow[];
  const active = devices.filter((d) => d.status === 'active');
  const revoked = devices.filter((d) => d.status === 'revoked');
  const tz = household.timezone;

  return (
    <main className="fw-page fw-page--wide">
      <AdminHeader current="/admin/devices" />
      <section className="fw-card" aria-labelledby="boards-heading">
        <h1 id="boards-heading">Boards</h1>
        {active.length === 0 ? (
          <p className="fw-muted">No boards yet. Pair the first one below.</p>
        ) : (
          <ul className="fw-list" aria-label="Paired boards">
            {active.map((d) => (
              <li key={d.id} className="fw-list__row">
                <span>
                  <strong>{d.name}</strong>
                  <span className="fw-muted">
                    {' · '}
                    {d.last_seen_at
                      ? `Last seen ${dayAndTime(d.last_seen_at, tz)}`
                      : 'Not seen yet'}
                  </span>
                </span>
                <span className="fw-actions">
                  <form
                    action={renameDevice}
                    className="fw-actions"
                    aria-label={`Rename ${d.name}`}
                  >
                    <input type="hidden" name="id" value={d.id} />
                    <label className="fw-visually-hidden" htmlFor={`name-${d.id}`}>
                      New name for {d.name}
                    </label>
                    <input
                      id={`name-${d.id}`}
                      className="fw-input"
                      name="name"
                      defaultValue={d.name}
                      maxLength={60}
                      required
                    />
                    <Button type="submit" variant="secondary">
                      Rename
                    </Button>
                  </form>
                  <form
                    action={setBoardTheme}
                    className="fw-actions"
                    aria-label={`Theme for ${d.name}`}
                  >
                    <input type="hidden" name="id" value={d.id} />
                    <label className="fw-visually-hidden" htmlFor={`theme-${d.id}`}>
                      Theme for {d.name}
                    </label>
                    <select
                      id={`theme-${d.id}`}
                      className="fw-input"
                      name="theme"
                      defaultValue={boardThemeSetting(d.board_config)}
                    >
                      {BOARD_THEMES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <Button type="submit" variant="secondary">
                      Set theme
                    </Button>
                  </form>
                  <form action={disconnectDevice}>
                    <input type="hidden" name="id" value={d.id} />
                    <Button type="submit" variant="ghost" icon="minus-circle">
                      Disconnect {d.name}
                    </Button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="fw-card" aria-labelledby="pair-heading">
        <h2 id="pair-heading">Add a board</h2>
        <p className="fw-muted">
          Open the board on the display (it starts on the pairing screen), then enter the code you
          get here.
        </p>
        <PairingForm timeZone={tz} />
      </section>

      {revoked.length > 0 ? (
        <section className="fw-card" aria-labelledby="revoked-heading">
          <h2 id="revoked-heading">Disconnected</h2>
          <Banner kind="info">
            A disconnected board reads nothing and cannot sign in again. Pair it again for a new
            code.
          </Banner>
          <ul className="fw-list" aria-label="Disconnected boards">
            {revoked.map((d) => (
              <li key={d.id} className="fw-list__row">
                <span>{d.name}</span>
                <span className="fw-muted">
                  Disconnected {d.revoked_at ? dayAndTime(d.revoked_at, tz) : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
