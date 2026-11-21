import { Banner, Button, Icon } from '@familywise/ui';
import Link from 'next/link';
import type { PenaltyReason } from '@/lib/penalties';
import { type PenaltyRule, type RuleChore, stoppedWords } from '@/lib/penalty-rules';
import { removeRule, stopRule } from '../../../penalties/actions';
import { AdminHeader } from '../../../header';
import type { NavWho } from '../../../nav';
import { RuleForm, type RulePerson } from './rule-form';

/** [PTS-10][US-1112] A penalty rule's page (WP-121): back to Penalties, its name, and the form. */
export function RuleView({
  rule,
  reasons,
  people,
  chores,
  tags,
  today,
  on,
  waiting,
  who,
  timezone = 'UTC',
}: {
  rule: PenaltyRule | null;
  reasons: PenaltyReason[];
  people: RulePerson[];
  chores: RuleChore[];
  tags: { id: string; name: string }[];
  today: string;
  on: boolean;
  waiting?: number;
  who?: NavWho | null;
  timezone?: string;
}) {
  const stopped = rule?.stoppedAt ?? null;
  return (
    <main className="fw-page">
      <AdminHeader current="/admin/settings/penalties" waiting={waiting} who={who} />
      <Link href="/admin/settings/penalties#rules" className="fw-crumb">
        <Icon name="chevron-left" size={18} />
        Penalties
      </Link>
      <header className="fw-settings__head">
        <h1>{rule ? rule.name : 'Add a rule'}</h1>
      </header>
      {stopped ? (
        <Banner kind="info">
          {stoppedWords(stopped, timezone)}. It adds nothing more and can’t be changed; what it
          added stays until it’s paid or taken back.
        </Banner>
      ) : null}
      <section className="fw-card" aria-labelledby="rule-heading">
        <h2 id="rule-heading">The rule</h2>
        <RuleForm
          rule={rule}
          reasons={reasons}
          people={people}
          chores={chores}
          tags={tags}
          today={today}
          on={on && !stopped}
        />
      </section>
      {/* [PTS-10] Stop now, and Remove while the rule has added nothing (the owner, 21 November). */}
      {rule && !stopped ? (
        <section className="fw-card" id="stop" aria-labelledby="stop-heading">
          <h2 id="stop-heading">Stop or remove</h2>
          <form action={stopRule} className="fw-rule__end">
            <input type="hidden" name="ruleId" value={rule.id} />
            <p className="fw-muted">
              Stop now: nothing more is added, from today. What it added stays until it’s paid or
              taken back. A stopped rule can’t be started again.
            </p>
            <Button type="submit" variant="secondary" icon="close">
              Stop now
            </Button>
          </form>
          {(rule.added ?? 0) === 0 ? (
            <form action={removeRule} className="fw-rule__end">
              <input type="hidden" name="ruleId" value={rule.id} />
              <p className="fw-muted">It hasn’t added anything yet, so it can be removed.</p>
              <Button type="submit" variant="ghost" icon="trash">
                Remove the rule
              </Button>
            </form>
          ) : (
            <p className="fw-muted">
              It has added {rule.added} {rule.added === 1 ? 'miss' : 'misses'}, so it can’t be
              removed; stop it instead.
            </p>
          )}
        </section>
      ) : null}
    </main>
  );
}
