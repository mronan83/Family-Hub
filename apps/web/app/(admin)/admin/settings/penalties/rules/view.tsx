import { Icon } from '@familywise/ui';
import Link from 'next/link';
import type { PenaltyReason } from '@/lib/penalties';
import type { PenaltyRule, RuleChore } from '@/lib/penalty-rules';
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
}) {
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
      <section className="fw-card" aria-labelledby="rule-heading">
        <h2 id="rule-heading">The rule</h2>
        <RuleForm
          rule={rule}
          reasons={reasons}
          people={people}
          chores={chores}
          tags={tags}
          today={today}
          on={on}
        />
      </section>
    </main>
  );
}
