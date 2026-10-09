// Chore tile (06 §7.1): every status is an icon, a word and a tone. Display states (overdue, past
// its time, covered), who did it, and a private badge (admin views only) sit on top of a status.
import type { OccurrenceStatus } from '@familywise/rules-engine';
import { Icon } from './Icon';
import { PointsChip } from './PointsChip';
import type { IconName } from './generated/icons';
import { tileState, type DisplayState } from './tile-states';

export interface ChoreTileProps {
  title: string;
  status: OccurrenceStatus;
  /** The chore's picker icon (`chore.icon`). */
  icon?: IconName;
  display?: DisplayState;
  points?: number;
  /** Who did it, for done and waiting tiles of shared items ("Maya"). */
  doneBy?: string;
  /** Who covered it, for the `covered` display state. */
  coveredBy?: string;
  /** Private items show a badge in admin views only (D-34). */
  isPrivate?: boolean;
  view?: 'board' | 'admin';
  /** The title's heading level, one below the heading it sits under (3 by default). */
  headingLevel?: 3 | 4;
}

export function ChoreTile({
  title,
  status,
  icon,
  display,
  points,
  doneBy,
  coveredBy,
  isPrivate,
  view = 'board',
  headingLevel = 3,
}: ChoreTileProps) {
  const state = tileState(status, display);
  const label = view === 'board' ? state.label : state.adminLabel;
  const who = display === 'covered' ? coveredBy : doneBy;
  const board = view === 'board';
  const Title = headingLevel === 4 ? 'h4' : 'h3';
  return (
    <article
      className={`fw-tile fw-tile--${state.tone}`}
      data-status={status}
      data-display={display}
      data-view={view}
    >
      {icon ? <Icon name={icon} size={board ? 56 : 24} className="fw-tile__icon" /> : null}
      <div className="fw-tile__body">
        <Title className="fw-tile__title">{title}</Title>
        <p className="fw-tile__status">
          <Icon name={state.icon} size={board ? 36 : 20} className="fw-tile__status-icon" />
          <span>
            {label}
            {who ? <span className="fw-tile__who"> · by {who}</span> : null}
          </span>
        </p>
      </div>
      {isPrivate && !board ? (
        <span className="fw-tile__private">
          <Icon name="lock" size={16} />
          Private
        </span>
      ) : null}
      {points ? <PointsChip points={points} signed size={view} /> : null}
    </article>
  );
}
