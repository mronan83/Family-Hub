import {
  Avatar,
  type AvatarKey,
  Banner,
  Button,
  Fold,
  Icon,
  type IconName,
  type MemberColor,
} from '@familywise/ui';
import Image from 'next/image';
import Link from 'next/link';
import { bonusFacts, describeBonus, type BonusRule } from '@/lib/bonus';
import { dayAndTime } from '@/lib/format';
import { pointsWord } from '@/lib/points';
import {
  archivedBonusesLine,
  archivedWhen,
  bonusLine,
  latelyLine,
  type RewardsOpen,
  settledAt,
  shopArchivedLine,
} from '@/lib/reward-facts';
import { itemFacts, STATUS_WORDS } from '@/lib/rewards';
import { Line } from '../fold-line';
import { AdminHeader } from '../header';
import { applyBonusesNow, bonusRuleAction, redemptionAction, setRewardArchived } from './actions';
import { BonusForm } from './bonus-form';
import type { RedemptionRow, RewardRow } from './data';

export interface RewardsViewProps {
  catalog: RewardRow[];
  redemptions: RedemptionRow[];
  members: { id: string; displayName: string; avatarKey: AvatarKey | null; color: MemberColor }[];
  /** Each child's balance now. */
  balances: Map<string, number>;
  timezone: string;
  /** The household's date (YYYY-MM-DD). */
  today: string;
  /** [PTS-05] The bonus rules, archived ones included. */
  bonusRules: BonusRule[];
  /** [PTS-06] What each child is saving for: member id to reward id. */
  wishes: Map<string, string>;
  notice: string | null;
  error: string | null;
  /** [NFR-18] The folds a save comes back to open (WP-95). */
  open?: RewardsOpen;
}

function Picture({
  item,
  size = 48,
}: {
  item: Pick<RewardRow, 'title' | 'icon' | 'imageUrl'>;
  size?: number;
}) {
  return item.imageUrl ? (
    <Image
      src={item.imageUrl}
      alt=""
      width={size}
      height={size}
      unoptimized
      className="fw-reward__photo"
    />
  ) : (
    <span className="fw-reward__icon" aria-hidden>
      <Icon name={item.icon as IconName} size={28} />
    </span>
  );
}

/**
 * [PTS-03][PTS-04] The rewards shop for a parent: what the children asked for (approve, or not this
 * time), what is approved and still to give (mark given, or cancel and refund), the shop itself (and
 * who is saving for what, PTS-06), the bonus rules (PTS-05), and what happened lately. [NFR-18] Folded as
 * the fold audit draws it (WP-95, D-120): what waits for a parent and the shop open; the shop's
 * Archived, Bonus points (Add a bonus and Archived bonuses inside it) and Lately folded.
 */
export function RewardsView({
  catalog,
  redemptions,
  members,
  balances,
  timezone,
  today,
  bonusRules,
  wishes,
  notice,
  error,
  open = { archived: false, bonus: false, archivedBonuses: false },
}: RewardsViewProps) {
  const name = (id: string) => members.find((m) => m.id === id)?.displayName ?? 'Someone';
  const item = (id: string) => catalog.find((c) => c.id === id);
  const waiting = redemptions.filter((r) => r.status === 'requested').reverse();
  const toGive = redemptions.filter((r) => r.status === 'approved');
  // Newest settled first, so Lately's folded header says the last one (WP-95).
  const lately = redemptions
    .filter((r) => r.status === 'fulfilled' || r.status === 'denied' || r.status === 'cancelled')
    .sort((a, b) => settledAt(b).localeCompare(settledAt(a)))
    .slice(0, 10);
  const shop = catalog.filter((c) => !c.archivedAt);
  const archived = catalog.filter((c) => c.archivedAt);
  const savers = (itemId: string) =>
    members.filter((m) => wishes.get(m.id) === itemId).map((m) => m.displayName);
  const rules = bonusRules.filter((r) => !r.archivedAt);
  const oldRules = bonusRules.filter((r) => r.archivedAt);

  // [NFR-18] A request's row leads with the child's avatar, as the fold audit draws it (WP-95).
  const row = (r: RedemptionRow, buttons: React.ReactNode, extra?: string) => {
    const it = item(r.itemId);
    const title = it?.title ?? 'A reward';
    const who = members.find((m) => m.id === r.memberId);
    return (
      <li key={r.id} className="fw-list__row fw-reward__row fw-reward__ask">
        <span className="fw-item">
          {who ? (
            <Avatar
              name={who.displayName}
              avatarKey={who.avatarKey}
              color={who.color}
              size={40}
              decorative
            />
          ) : null}
          <span className="fw-item__body">
            <strong>
              {name(r.memberId)}: {title}
            </strong>
            <span className="fw-muted">
              {r.goalTitle
                ? `Reached ${r.goalTitle}, ${dayAndTime(r.requestedAt, timezone)}`
                : `${pointsWord(r.cost)} · asked ${dayAndTime(r.requestedAt, timezone)}`}
              {extra ? ` · ${extra}` : ''}
            </span>
          </span>
        </span>
        {buttons ? <span className="fw-actions">{buttons}</span> : null}
      </li>
    );
  };
  const button = (
    act: string,
    r: RedemptionRow,
    text: string,
    label: string,
    icon: IconName,
    primary = false,
  ) => (
    <Button
      type="submit"
      name="act"
      value={`${act}:${r.id}`}
      variant={primary ? 'primary' : 'ghost'}
      icon={icon}
      aria-label={label}
    >
      {text}
    </Button>
  );

  return (
    <main className="fw-page fw-page--wide">
      <AdminHeader current="/admin/rewards" />
      {error ? (
        <Banner kind="notice">{error}</Banner>
      ) : notice ? (
        <Banner kind="info">{notice}</Banner>
      ) : null}

      <header className="fw-settings__head">
        <h1>Rewards</h1>
      </header>

      {/* What waits for a parent is marked, as Home's Needs you is (the fold audit's frame). */}
      <section
        className={`fw-card${waiting.length ? ' fw-card--attn' : ''}`}
        aria-labelledby="asked-heading"
      >
        <h2 id="asked-heading">Asked for</h2>
        {waiting.length === 0 ? (
          <p className="fw-muted">
            Nothing waiting. When a child asks for a reward on the board, it shows here.
          </p>
        ) : (
          <form action={redemptionAction}>
            <ul className="fw-list" aria-label="Asked for">
              {waiting.map((r) => {
                const title = item(r.itemId)?.title ?? 'a reward';
                return row(
                  r,
                  <>
                    {button(
                      'approve',
                      r,
                      'Approve',
                      `Approve ${title} for ${name(r.memberId)}`,
                      'check',
                      true,
                    )}
                    {button(
                      'deny',
                      r,
                      'Not this time',
                      `Not this time: ${title} for ${name(r.memberId)}`,
                      'close',
                    )}
                  </>,
                  `has ${pointsWord(balances.get(r.memberId) ?? 0)}`,
                );
              })}
            </ul>
          </form>
        )}
        <p className="fw-muted">
          Approving spends the points. Check the chores were really done first, if you like.
        </p>
      </section>

      {toGive.length > 0 ? (
        <section className="fw-card" aria-labelledby="give-heading">
          <h2 id="give-heading">To give</h2>
          <form action={redemptionAction}>
            <ul className="fw-list" aria-label="To give">
              {toGive.map((r) => {
                const title = item(r.itemId)?.title ?? 'a reward';
                return row(
                  r,
                  <>
                    {button(
                      'fulfil',
                      r,
                      'Given',
                      `Mark ${title} given to ${name(r.memberId)}`,
                      'check',
                      true,
                    )}
                    {button(
                      'cancel',
                      r,
                      r.goalTitle ? 'Cancel' : 'Cancel and refund',
                      r.goalTitle
                        ? `Cancel ${title} for ${name(r.memberId)}`
                        : `Cancel ${title} for ${name(r.memberId)} and refund`,
                      'undo',
                    )}
                  </>,
                );
              })}
            </ul>
          </form>
        </section>
      ) : null}

      <section className="fw-card" aria-labelledby="shop-heading">
        <h2 id="shop-heading">The shop</h2>
        {shop.length === 0 ? (
          <p className="fw-muted">
            No rewards yet. Add the first one: a treat, an outing, a privilege.
          </p>
        ) : (
          <ul className="fw-list" aria-label="The shop">
            {shop.map((c) => (
              <li key={c.id} className="fw-list__row fw-reward__row">
                <span className="fw-item">
                  <Picture item={c} />
                  <span className="fw-item__body">
                    <strong>{c.title}</strong>
                    <span className="fw-muted">
                      {itemFacts(c)}
                      {c.active ? '' : ' · not in the shop now'}
                    </span>
                    {savers(c.id).length > 0 ? (
                      <span className="fw-muted fw-reward__savers">
                        <Icon name="target" size={20} />
                        {savers(c.id).join(' and ')} {savers(c.id).length === 1 ? 'is' : 'are'}{' '}
                        saving for it
                      </span>
                    ) : null}
                  </span>
                </span>
                <Link href={`/admin/rewards/${c.id}`} aria-label={`Edit ${c.title}`}>
                  Edit
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="fw-actions">
          <Link href="/admin/rewards/new" className="fw-btn fw-btn--secondary">
            <Icon name="plus" className="fw-btn__icon" />
            <span>Add a reward</span>
          </Link>
        </div>
        {archived.length > 0 ? (
          <Fold
            variant="inner"
            id="shop-archived"
            title="Archived"
            headingId="shop-archived-heading"
            open={open.archived}
            summary={[<Line key="n" line={shopArchivedLine(archived.length)} />]}
          >
            <ul className="fw-list" aria-label="Archived rewards">
              {archived.map((c) => (
                <li key={c.id} className="fw-list__row fw-reward__row">
                  <span className="fw-item">
                    <Picture item={c} />
                    <span className="fw-item__body">
                      <Link href={`/admin/rewards/${c.id}`}>
                        <strong>{c.title}</strong>
                      </Link>
                      <span className="fw-muted">{archivedWhen(c.archivedAt!, timezone)}</span>
                    </span>
                  </span>
                  <form action={setRewardArchived}>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="archive" value="false" />
                    <Button
                      type="submit"
                      variant="secondary"
                      icon="undo"
                      aria-label={`Put ${c.title} back`}
                    >
                      Put back
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          </Fold>
        ) : null}
      </section>

      <Fold
        id="bonus"
        title="Bonus points"
        headingId="bonus-heading"
        open={open.bonus}
        summary={[<Line key="b" line={bonusLine(bonusRules)} />]}
      >
        <p className="fw-muted">
          Extra points paid automatically, overnight once a day is over. Each bonus is paid once.
        </p>
        {rules.length === 0 ? (
          <p className="fw-muted">No bonuses yet. A streak bonus rewards keeping it up.</p>
        ) : (
          <form action={bonusRuleAction}>
            <ul className="fw-list" aria-label="Bonus points">
              {rules.map((r) => {
                const words = describeBonus(r);
                return (
                  <li key={r.id} className="fw-list__row fw-reward__row" data-bonus={r.id}>
                    <span className="fw-item">
                      <span className="fw-reward__icon" aria-hidden>
                        <Icon
                          name={r.ruleType === 'streak_bonus' ? 'flame' : 'sparkles'}
                          size={28}
                        />
                      </span>
                      <span className="fw-item__body">
                        <strong>{words}</strong>
                        <span className="fw-muted">{bonusFacts(r, today)}</span>
                      </span>
                    </span>
                    <span className="fw-actions">
                      <Button
                        type="submit"
                        name="act"
                        value={`${r.active ? 'off' : 'on'}:${r.id}`}
                        variant="ghost"
                        icon={r.active ? 'minus-circle' : 'check-circle'}
                        aria-label={`${r.active ? 'Turn off' : 'Turn on'}: ${words}`}
                      >
                        {r.active ? 'Turn off' : 'Turn on'}
                      </Button>
                      <Button
                        type="submit"
                        name="act"
                        value={`archive:${r.id}`}
                        variant="ghost"
                        icon="trash"
                        aria-label={`Archive: ${words}`}
                      >
                        Archive
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </form>
        )}
        <Fold
          variant="inner"
          id="add-bonus"
          title="Add a bonus"
          headingId="add-bonus-heading"
          button={{ label: 'Add a bonus', icon: 'plus' }}
        >
          <BonusForm today={today} />
        </Fold>
        {rules.some((r) => r.active) ? (
          <form action={applyBonusesNow} className="fw-actions">
            <Button type="submit" variant="secondary" icon="sync">
              Pay bonuses now
            </Button>
            <span className="fw-muted">For the days already over, as tonight would.</span>
          </form>
        ) : null}
        {oldRules.length > 0 ? (
          <Fold
            variant="inner"
            id="archived-bonuses"
            title="Archived bonuses"
            headingId="archived-bonuses-heading"
            open={open.archivedBonuses}
            summary={[<Line key="n" line={archivedBonusesLine(oldRules.length)} />]}
          >
            <ul className="fw-list" aria-label="Archived bonuses">
              {oldRules.map((r) => (
                <li key={r.id} className="fw-list__row">
                  <span>{describeBonus(r)}</span>
                </li>
              ))}
            </ul>
          </Fold>
        ) : null}
      </Fold>

      {lately.length > 0 ? (
        <Fold
          id="lately"
          title="Lately"
          headingId="lately-heading"
          summary={[
            <Line
              key="l"
              line={latelyLine(
                lately,
                (id) => item(id)?.title ?? 'A reward',
                name,
                timezone,
                today,
              )}
            />,
          ]}
        >
          <ul className="fw-list" aria-label="Lately">
            {lately.map((r) => row(r, null, STATUS_WORDS[r.status]))}
          </ul>
        </Fold>
      ) : null}
    </main>
  );
}
