import { Banner, Button, Fold, Icon, type IconName } from '@familywise/ui';
import Link from 'next/link';
import type { HomeAlert } from '@/lib/home-alerts';
import { AdminHeader } from './header';
import { noSchoolToday, refreshMenus, undoNoSchool } from './home-actions';
import type { NavWho } from './nav';
import { ClosureForm } from './school/forms';

/** [MEAL-12] Home's lunch card (WP-73): the lunch week it opens, and what it says of it. */
export interface LunchQuick {
  /** `/admin/meals?week=…#lunch`: this week Monday to Friday, the coming week at the weekend. */
  href: string;
  /** "This week: Maya has 1 day to pick; Leo is all set." */
  words: string;
}

/** Today at school, for Home's school tile. */
export type SchoolToday =
  | { state: 'school'; yearId: string }
  /** Today is off: by a snow day made here (undoable), or by another day off or break. */
  | { state: 'off'; yearId: string; name: string; snowDayId: string | null }
  | { state: 'weekend'; yearId: string }
  /** Today is outside every school year; the next one (if any) takes a day off. */
  | { state: 'none'; yearId: string | null };

export const HOME_NOTICES: Record<string, { kind: 'info' | 'notice'; text: string }> = {
  welcome: {
    kind: 'info',
    text: 'Your household is ready. Invite another admin from Settings, Family options, when you like.',
  },
  joined: { kind: 'info', text: 'You’ve joined the household.' },
  password: { kind: 'info', text: 'Your password is changed.' },
  snow: { kind: 'info', text: 'No school today. Today’s chores follow a day off school.' },
  'school-back': { kind: 'info', text: 'Today is a school day again.' },
  dayoff: { kind: 'info', text: 'Day off saved.' },
  'menus-fetched': { kind: 'info', text: 'School menus fetched.' },
  'menus-failed': {
    kind: 'notice',
    text: 'A school menu couldn’t be fetched. School menus says why.',
  },
  'no-feed': {
    kind: 'notice',
    text: 'There’s no school menu feed to fetch. Add one in School menus.',
  },
  'no-year': { kind: 'notice', text: 'Today isn’t in a school year. Set one up in School.' },
  failed: { kind: 'notice', text: 'That didn’t save. Try again in a moment.' },
};

function Tile({ icon, href, label }: { icon: IconName; href: string; label: string }) {
  return (
    <li>
      <Link href={href} className="fw-quick__tile">
        <span className="fw-quick__icon">
          <Icon name={icon} size={24} />
        </span>
        <span className="fw-quick__name">{label}</span>
      </Link>
    </li>
  );
}

function AlertRow({ a }: { a: HomeAlert }) {
  return (
    <li className="fw-alert" data-level={a.level}>
      <Icon name={a.icon} size={22} className="fw-alert__icon" />
      <span className="fw-alert__text">{a.text}</span>
      <Link href={a.href} className="fw-btn fw-btn--secondary fw-alert__go">
        {a.cta}
      </Link>
    </li>
  );
}

/**
 * [NFR-17][US-109] Home at a glance (WP-57, D-84): what needs a parent now and what to know soon,
 * each with where to deal with it, then one tap to add a chore, a task, a reward, a goal or a meal,
 * to call off school today or add a day off, and to fetch the school menus. The household's options
 * moved to Settings, Family options. [MEAL-12][US-709] Beside Add a meal, the school lunches card
 * opens the lunch week (WP-73, D-98); it shows only when a child has school lunch.
 */
export function HomeView({
  name,
  dateLine,
  alerts,
  school,
  menuFeeds,
  lunch,
  notice,
  waiting,
  who,
}: {
  name: string;
  /** Today, in words. */
  dateLine: string;
  alerts: HomeAlert[];
  school: SchoolToday;
  menuFeeds: number;
  /** None when no child has school lunch. */
  lunch?: LunchQuick | null;
  notice?: string | null;
  waiting?: number;
  who?: NavWho | null;
}) {
  const n = notice ? HOME_NOTICES[notice] : undefined;
  const act = alerts.filter((a) => a.level === 'act');
  const note = alerts.filter((a) => a.level === 'note');
  return (
    <main className="fw-page fw-page--wide">
      <AdminHeader current="/admin" waiting={waiting} who={who} />
      {n ? <Banner kind={n.kind}>{n.text}</Banner> : null}
      <header className="fw-settings__head">
        <h1>{name}</h1>
        <p className="fw-muted">{dateLine}</p>
      </header>

      <section className="fw-card" aria-labelledby="needs-heading">
        <h2 id="needs-heading">Needs you</h2>
        {act.length ? (
          <ul className="fw-alerts" aria-label="Needs you">
            {act.map((a) => (
              <AlertRow key={a.key} a={a} />
            ))}
          </ul>
        ) : (
          <p className="fw-alerts__clear">
            <Icon name="check" size={22} />
            Nothing needs you right now.
          </p>
        )}
        {note.length ? (
          <>
            <h3 id="heads-up-heading">Heads-up</h3>
            <ul className="fw-alerts" aria-label="Heads-up">
              {note.map((a) => (
                <AlertRow key={a.key} a={a} />
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <section aria-labelledby="quick-heading" className="fw-quick-wrap">
        <h2 id="quick-heading">Quick actions</h2>
        <ul className="fw-quick" aria-label="Quick actions">
          <Tile icon="clipboard-check" href="/admin/chores/new" label="Add a chore" />
          <Tile icon="list-check" href="/admin/chores/new?kind=task" label="Add a task" />
          <Tile icon="gift" href="/admin/rewards/new" label="Add a reward" />
          <Tile icon="target" href="/admin/goals/new" label="Add a goal" />
        </ul>
        <ul className="fw-quick fw-quick--cards" aria-label="More quick actions">
          <li className="fw-quick__card" aria-labelledby="meal-heading">
            <span className="fw-quick__icon">
              <Icon name="utensils" size={24} />
            </span>
            <span className="fw-quick__name" id="meal-heading">
              Add a meal
            </span>
            <div className="fw-quick__actions">
              <Link href="/admin/meals#add" className="fw-btn fw-btn--secondary">
                Plan a meal
              </Link>
              <Link href="/admin/meals/library" className="fw-btn fw-btn--ghost">
                New in the library
              </Link>
            </div>
          </li>
          {lunch ? (
            <li className="fw-quick__card" aria-labelledby="lunch-quick-heading">
              <span className="fw-quick__icon">
                <Icon name="lunch" size={24} />
              </span>
              <span className="fw-quick__name" id="lunch-quick-heading">
                School lunches
              </span>
              <p className="fw-quick__status fw-quick__words">{lunch.words}</p>
              <div className="fw-quick__actions">
                <Link href={lunch.href} className="fw-btn fw-btn--primary">
                  Pick lunches
                </Link>
              </div>
            </li>
          ) : null}
          <li className="fw-quick__card" aria-labelledby="school-heading">
            <span className="fw-quick__icon">
              <Icon name="snowflake" size={24} />
            </span>
            <span className="fw-quick__name" id="school-heading">
              School today
            </span>
            <div className="fw-quick__actions">
              {school.state === 'school' ? (
                <form action={noSchoolToday}>
                  <Button type="submit" variant="secondary" icon="snowflake">
                    No school today
                  </Button>
                </form>
              ) : school.state === 'off' ? (
                <>
                  <span className="fw-quick__status">No school today: {school.name}</span>
                  {school.snowDayId ? (
                    <form action={undoNoSchool}>
                      <input type="hidden" name="id" value={school.snowDayId} />
                      <Button type="submit" variant="ghost" icon="undo">
                        Undo
                      </Button>
                    </form>
                  ) : null}
                </>
              ) : (
                <span className="fw-quick__status">
                  {school.state === 'weekend'
                    ? 'No school today: the weekend'
                    : 'No school year today'}
                </span>
              )}
            </div>
            {school.yearId ? (
              // [NFR-18] The fold's look, as a school year's Add a day off (WP-94).
              <Fold variant="inner" id="home-day-off" title="Add a day off">
                <ClosureForm schoolYearId={school.yearId} fromHome />
              </Fold>
            ) : (
              <Link href="/admin/school" className="fw-quick__link">
                Set up the school year
              </Link>
            )}
          </li>
          <li className="fw-quick__card" aria-labelledby="menu-heading">
            <span className="fw-quick__icon">
              <Icon name="sync" size={24} />
            </span>
            <span className="fw-quick__name" id="menu-heading">
              School menu
            </span>
            <div className="fw-quick__actions">
              {menuFeeds ? (
                <form action={refreshMenus}>
                  <Button type="submit" variant="secondary" icon="sync">
                    Refresh school menu
                  </Button>
                </form>
              ) : (
                <Link href="/admin/meals/menus" className="fw-btn fw-btn--ghost">
                  Set up school menus
                </Link>
              )}
            </div>
          </li>
        </ul>
      </section>
    </main>
  );
}
