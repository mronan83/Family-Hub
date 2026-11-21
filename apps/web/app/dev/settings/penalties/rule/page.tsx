import type { Metadata } from 'next';
import { RuleView } from '../../../../(admin)/admin/settings/penalties/rules/view';
import {
  PENALTY_PEOPLE,
  PENALTY_REASONS,
  penaltyRules,
  RULE_CHORES,
  RULE_TAGS,
} from '../../../penalties-fixture';

// [PTS-10] A penalty rule's page (WP-121) with the made-up family and no database, for the UI suite and
// the side-by-side: "Folder home", $1 a missed school day for Maya, max $10. ?state=new for Add a rule;
// ?theme=evening.
export const metadata: Metadata = { title: 'Penalty rule', robots: { index: false } };

const TODAY = '2026-11-19';

export default async function DevPenaltyRulePage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string; state?: string }>;
}) {
  const p = await searchParams;
  return (
    <div className={`admin ${p.theme === 'evening' ? 'theme-evening' : 'theme-day'}`}>
      <RuleView
        rule={p.state === 'new' ? null : penaltyRules(TODAY)[0]!}
        reasons={PENALTY_REASONS}
        people={PENALTY_PEOPLE}
        chores={RULE_CHORES}
        tags={RULE_TAGS}
        today={TODAY}
        on
        waiting={2}
        who={{ name: 'Alex', avatarKey: 'owl', color: 'member-1' }}
      />
    </div>
  );
}
