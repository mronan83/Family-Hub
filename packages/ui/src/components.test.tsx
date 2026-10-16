import { OCCURRENCE_STATUSES } from '@familywise/rules-engine';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Avatar, initials } from './Avatar';
import { Banner } from './Banner';
import { Button } from './Button';
import { ChoreTile } from './ChoreTile';
import { Fold } from './Fold';
import { GoalMeter } from './GoalMeter';
import { Icon, iconLabel } from './Icon';
import { PointsChip } from './PointsChip';
import { TILE_STATES } from './tile-states';

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe('Icon', () => {
  it('[NFR-13] is hidden from screen readers next to a word, named when alone', () => {
    expect(html(<Icon name="check" />)).toContain('aria-hidden="true"');
    expect(html(<Icon name="wifi-off" label={iconLabel('wifi-off')} />)).toContain(
      'aria-label="wifi off"',
    );
    expect(iconLabel('chore-dishes')).toBe('dishes');
  });
});

describe('ChoreTile', () => {
  it.each(OCCURRENCE_STATUSES)('[NFR-13] renders %s with its icon and word', (status) => {
    const out = html(<ChoreTile title="Make bed" status={status} icon="chore-bed" />);
    expect(out).toContain(`data-icon="${TILE_STATES[status].icon}"`);
    expect(out).toContain(TILE_STATES[status].label);
    expect(out).toContain(`fw-tile--${TILE_STATES[status].tone}`);
  });

  it('[CHR-09] names who did a shared item, and who covered it for the others', () => {
    expect(html(<ChoreTile title="Dishes" status="completed" doneBy="Maya" />)).toContain(
      'by Maya',
    );
    const covered = html(
      <ChoreTile title="Dishes" status="completed" display="covered" coveredBy="Leo" />,
    );
    expect(covered).toContain('Covered');
    expect(covered).toContain('by Leo');
  });

  it('[CHR-13] shows the private badge in admin views only', () => {
    expect(html(<ChoreTile title="Gift" status="scheduled" isPrivate view="admin" />)).toContain(
      'Private',
    );
    expect(
      html(<ChoreTile title="Gift" status="scheduled" isPrivate view="board" />),
    ).not.toContain('Private');
  });

  it('[NFR-11] titles sit one level below the heading they are under', () => {
    expect(html(<ChoreTile title="Dishes" status="scheduled" />)).toContain('<h3');
    expect(html(<ChoreTile title="Dishes" status="scheduled" headingLevel={4} />)).toContain(
      '<h4 class="fw-tile__title">Dishes</h4>',
    );
  });

  it('[NFR-13] uses admin words in admin views', () => {
    expect(html(<ChoreTile title="Dishes" status="pending_approval" view="admin" />)).toContain(
      'Needs review',
    );
  });
});

describe('PointsChip', () => {
  it('[NFR-13] shows a balance, a signed award, and a calm negative balance', () => {
    expect(html(<PointsChip points={120} />)).toContain('>120<');
    expect(html(<PointsChip points={5} signed />)).toContain('+5');
    const negative = html(<PointsChip points={-5} />);
    expect(negative).toContain('−5 to earn back');
    expect(negative).toContain('fw-points--negative');
  });
});

describe('GoalMeter', () => {
  it('[NFR-13] always writes the count and percentage, clamped to 0–100', () => {
    expect(html(<GoalMeter label="Movie night" value={4} target={5} />)).toContain('4 of 5 · 80%');
    expect(html(<GoalMeter label="x" value={9} target={5} />)).toContain('aria-valuenow="100"');
    expect(html(<GoalMeter label="x" value={1} target={0} />)).toContain('aria-valuenow="0"');
  });
});

describe('Avatar, Banner, Button', () => {
  it('[NFR-13] avatar shows the character, or initials on the member color', () => {
    expect(html(<Avatar name="Maya" avatarKey="fox" />)).toContain('/brand/avatars/avatar-fox.svg');
    const fallback = html(<Avatar name="Sam Rivera" color="member-2" />);
    expect(fallback).toContain('>SR<');
    expect(fallback).toContain('var(--member-2)');
    expect(initials('  alex ')).toBe('A');
  });

  it('[NFR-13] banners pair an icon with words and announce politely', () => {
    const out = html(<Banner kind="offline">Offline: your check-offs are saved</Banner>);
    expect(out).toContain('role="status"');
    expect(out).toContain('data-icon="wifi-off"');
  });

  it('[NFR-13] buttons pair an icon with a word', () => {
    const out = html(
      <Button variant="secondary" icon="plus">
        Add
      </Button>,
    );
    expect(out).toContain('fw-btn--secondary');
    expect(out).toContain('data-icon="plus"');
    expect(out).toContain('type="button"');
  });
});

describe('Fold', () => {
  it('[NFR-18][D-120] a card folds to its title and its button, closed at first', () => {
    const out = html(
      <Fold
        title="Add a board"
        headingId="pair"
        id="add"
        button={{ label: 'Add a board', icon: 'plus' }}
      >
        <p>Form</p>
      </Fold>,
    );
    expect(out).toMatch(
      /^<section id="add" class="fw-card fw-fold" aria-labelledby="pair"><details>/,
    );
    expect(out).toContain('<h2 id="pair">Add a board</h2>');
    expect(out).toContain('class="fw-btn fw-btn--secondary fw-fold__closed" aria-hidden="true"');
    expect(out).toContain('<div class="fw-fold__body"><p>Form</p></div>');
  });

  it('[NFR-18][D-120] opens after a save in it; an inner fold has an h3 and its summary lines', () => {
    const out = html(
      <Fold variant="inner" title="Usual week" open summary={['Sam: Mon Buy', 'Maya: Fri Buy']}>
        x
      </Fold>,
    );
    expect(out).toMatch(/^<details class="fw-fold fw-fold--inner" open="">/);
    expect(out).toContain('<h3>Usual week</h3>');
    expect(out).toContain(
      '<span class="fw-fold__sum"><span>Sam: Mon Buy</span><span>Maya: Fri Buy</span></span>',
    );
  });

  it('[NFR-18][DEV-09][D-118] a row shows its name, its facts and its warning on the header', () => {
    const out = html(
      <Fold
        variant="row"
        id="board-1"
        title="Playroom"
        meta="Awake · no set times"
        warning="Not seen for 2 days"
      >
        x
      </Fold>,
    );
    expect(out).toMatch(/^<details id="board-1" class="fw-fold fw-fold--row">/);
    expect(out).toContain('<h2 class="fw-fold__name">Playroom</h2>');
    expect(out).toContain('<span class="fw-fold__meta">Awake · no set times</span>');
    const head = out.slice(0, out.indexOf('</summary>'));
    expect(head).toContain('Not seen for 2 days');
    expect(head).toContain('data-icon="warning"');
  });
});
