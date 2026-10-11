import { Icon } from '@familywise/ui';
import Link from 'next/link';
import { SETTINGS_PAGES } from '@/lib/admin-nav';
import type { StatusLine } from '@/lib/settings-status';
import { AdminHeader } from '../header';
import type { NavWho } from '../nav';

/**
 * [NFR-15][US-107] Settings (WP-51, D-81): a tile for each page set once and left alone (School,
 * Calendars, Boards, Tags, Reminders, Health), each with what it is for and how it stands now.
 */
export function SettingsView({
  status,
  waiting,
  who,
}: {
  /** Each page's line, by its href. */
  status: Record<string, StatusLine>;
  /** For a dev page; the live page leaves them to the header. */
  waiting?: number;
  who?: NavWho | null;
}) {
  return (
    <main className="fw-page fw-page--wide">
      <AdminHeader current="/admin/settings" waiting={waiting} who={who} />
      <header className="fw-settings__head">
        <h1>Settings</h1>
        <p className="fw-muted">
          How FamilyWise is set up for your family. Most of it is set once and left alone.
        </p>
      </header>
      <ul className="fw-settings" aria-label="Settings">
        {SETTINGS_PAGES.map((p) => {
          const line = status[p.href];
          return (
            <li key={p.href}>
              <Link href={p.href} className="fw-settings__tile">
                <span className="fw-settings__icon">
                  <Icon name={p.icon} size={24} />
                </span>
                <span className="fw-settings__name">{p.label}</span>
                <Icon name="chevron-right" size={20} className="fw-settings__go" />
                <span className="fw-settings__what">{p.what}</span>
                {line ? (
                  <span className="fw-settings__status" data-warn={line.warn || undefined}>
                    {line.warn ? <Icon name="warning" size={18} /> : null}
                    {line.text}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
