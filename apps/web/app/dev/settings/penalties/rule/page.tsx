import type { Metadata } from 'next';
import { RuleView } from '../../../../(admin)/admin/settings/penalties/rules/view';
import {
  PAYBACK_GOALS,
  PENALTY_PEOPLE,
  PENALTY_REASONS,
  penaltyRules,
  RULE_CHORES,
  RULE_TAGS,
} from '../../../penalties-fixture';

// [PTS-10] A penalty rule's page (WP-121) with the made-up family and no database, for the UI suite and
// the side-by-side: "Folder home", $1 a missed school day for Maya, max $10. ?state=new for Add a rule;
// ?rule=bed for "Bed by 8", which has added nothing (Remove offered); ?state=stopped for a stopped
// rule; ?theme=evening. [PTS-11] Each is paid back by a goal (WP-122): "Folder home" paying back,
// "Bed by 8" paused with nothing owed.
export const metadata: Metadata = { title: 'Penalty rule', robots: { index: false } };

const TODAY = '2026-11-19';

export default async function DevPenaltyRulePage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string; state?: string; rule?: string }>;
}) {
  const p = await searchParams;
  return (
    <div className={`admin ${p.theme === 'evening' ? 'theme-evening' : 'theme-day'}`}>
      <RuleView
        rule={
          p.state === 'new'
            ? null
            : {
                ...penaltyRules(TODAY)[p.rule === 'bed' ? 1 : 0]!,
                ...(p.state === 'stopped' ? { stoppedAt: '2026-11-19T15:00:00Z' } : {}),
              }
        }
        timezone="America/Chicago"
        reasons={PENALTY_REASONS}
        people={PENALTY_PEOPLE}
        chores={RULE_CHORES}
        tags={RULE_TAGS}
        goals={PAYBACK_GOALS}
        today={TODAY}
        on
        waiting={2}
        who={{ name: 'Alex', avatarKey: 'owl', color: 'member-1' }}
      />
    </div>
  );
}
