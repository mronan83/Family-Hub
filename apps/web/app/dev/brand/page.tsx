import {
  AVATAR_KEYS,
  Avatar,
  Banner,
  Button,
  ChoreTile,
  GoalMeter,
  ICONS,
  ICON_NAMES,
  Icon,
  Logo,
  MEMBER_COLORS,
  PointsChip,
  TILE_STATES,
  ThemeLock,
  type Theme,
} from '@familywise/ui';
import type { Metadata } from 'next';
import './brand.css';

// The brand specimen rendered from the real components (WP-37). Day and Evening sit side by side;
// ?surface=board|admin switches the type scale, ?theme=day|evening the page around them.
export const metadata: Metadata = { title: 'Brand', robots: { index: false } };

const STATUSES = Object.keys(TILE_STATES) as (keyof typeof TILE_STATES)[];
const ROLES = [
  'bg',
  'surface',
  'line',
  'text',
  'text-soft',
  'primary',
  'primary-text',
  'primary-tint',
  'reward',
  'reward-text',
  'reward-tint',
  'success',
  'missed',
  'missed-text',
  'missed-tint',
  'info',
  'focus',
];

function Panel({ theme, view }: { theme: Theme; view: 'board' | 'admin' }) {
  return (
    <section className={`specimen-panel theme-${theme}`} data-testid={`panel-${theme}`}>
      <h2>{theme === 'day' ? 'Day' : 'Evening'}</h2>
      <div className="specimen-tiles" data-testid={`tiles-${theme}`}>
        {STATUSES.map((status) => (
          <ChoreTile
            key={status}
            title="Make bed"
            status={status}
            icon="chore-bed"
            points={status === 'missed' || status === 'skipped' ? undefined : 5}
            view={view}
          />
        ))}
        <ChoreTile title="Call the plumber" status="scheduled" icon="chore-pack" display="overdue" view={view} />
        <ChoreTile title="Brush teeth" status="scheduled" icon="chore-teeth" display="past-time" view={view} />
        <ChoreTile title="Dishes" status="completed" icon="chore-dishes" doneBy="Maya" points={5} view={view} />
        <ChoreTile
          title="Dishes"
          status="completed"
          icon="chore-dishes"
          display="covered"
          coveredBy="Maya"
          view={view}
        />
        <ChoreTile title="Birthday gift" status="scheduled" icon="chore-pack" isPrivate view="admin" />
      </div>
      <div className="specimen-row">
        <PointsChip points={120} size={view} />
        <PointsChip points={-5} size={view} />
      </div>
      <GoalMeter label="Movie night" value={4} target={5} />
      <div className="specimen-stack">
        <Banner kind="stale">Updated 12 minutes ago</Banner>
        <Banner kind="offline">Offline: your check-offs are saved</Banner>
      </div>
      <div className="specimen-row">
        <Button icon="check">Done</Button>
        <Button variant="secondary" icon="undo">
          Undo
        </Button>
        <Button variant="ghost" icon="close">
          Cancel
        </Button>
        {/* A link styled as a button keeps the button's colors on admin, where links are teal. */}
        <a className="fw-btn fw-btn--primary" href="#specimen-buttons">
          Link button
        </a>
      </div>
      <ul className="specimen-swatches" aria-label="Role colors">
        {ROLES.map((role) => (
          <li key={role}>
            <span className="specimen-swatch" style={{ background: `var(--${role})` }} />
            <code>--{role}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function BrandPage({
  searchParams,
}: {
  searchParams: Promise<{ surface?: string; theme?: string }>;
}) {
  const params = await searchParams;
  const view = params.surface === 'board' ? 'board' : 'admin';
  const theme: Theme = params.theme === 'evening' ? 'evening' : 'day';
  const link = (next: { surface?: string; theme?: string }) =>
    `?${new URLSearchParams({ surface: view, theme, ...next })}`;

  return (
    <div className={`specimen ${view}`}>
      <ThemeLock theme={theme} />
      <header className="specimen-header">
        <Logo />
        <nav className="specimen-row" aria-label="Specimen options">
          <a href={link({ surface: 'admin' })} aria-current={view === 'admin' ? 'page' : undefined}>
            Admin size
          </a>
          <a href={link({ surface: 'board' })} aria-current={view === 'board' ? 'page' : undefined}>
            Board size
          </a>
          <a href={link({ theme: 'day' })} aria-current={theme === 'day' ? 'page' : undefined}>
            Day page
          </a>
          <a href={link({ theme: 'evening' })} aria-current={theme === 'evening' ? 'page' : undefined}>
            Evening page
          </a>
        </nav>
      </header>

      <div className="specimen-panels">
        <Panel theme="day" view={view} />
        <Panel theme="evening" view={view} />
      </div>

      <section className="specimen-section">
        <h2>Type</h2>
        <p className="specimen-type" style={{ fontSize: 'var(--t-hero)' }}>
          Hero
        </p>
        <p className="specimen-type" style={{ fontSize: 'var(--t-title)' }}>
          Title
        </p>
        <p className="specimen-type" style={{ fontSize: 'var(--t-heading)' }}>
          Heading
        </p>
        <p style={{ fontSize: 'var(--t-body)' }}>Body: everyone knows what&apos;s next.</p>
        <p style={{ fontSize: 'var(--t-small)' }}>Small: updated 12 minutes ago</p>
      </section>

      <section className="specimen-section">
        <h2>Avatars</h2>
        <div className="specimen-row">
          {AVATAR_KEYS.map((key) => (
            <Avatar key={key} name={key} avatarKey={key} />
          ))}
          {MEMBER_COLORS.map((color, i) => (
            <Avatar key={color} name={['Sam', 'Alex', 'Jo', 'Pat', 'Kai', 'Lee'][i]!} color={color} />
          ))}
        </div>
      </section>

      <section className="specimen-section">
        <h2>Icons ({ICON_NAMES.length})</h2>
        <ul className="specimen-icons">
          {ICON_NAMES.map((name) => (
            <li key={name} title={ICONS[name].keywords.join(', ')}>
              <Icon name={name} size={view === 'board' ? 36 : 24} />
              <span>{name}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
