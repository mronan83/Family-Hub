// [NFR-18][D-120] The fold (WP-75's on Meals, made one component in WP-91): a section folded at first,
// the browser's own <details>, so it opens before the page hydrates. Its header: the chevron, the
// title, then what it shows while closed (its button, or its summary lines). A warning stays on the
// header, open or closed, so a fold never hides a problem.
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import type { IconName } from './generated/icons';

export interface FoldProps {
  /** The fold's title: a section's heading, or a row's name. */
  title: ReactNode;
  /**
   * card: a section of its own on the page (an h2 in a card); inner: a fold inside a card (an h3);
   * row: one of several things a list holds (a board, a calendar), its name and facts on the header.
   */
  variant?: 'card' | 'inner' | 'row';
  /** The heading's level: h2 for a card or a row, h3 inside one. */
  level?: 2 | 3;
  /** The heading's id, for the section's name. */
  headingId?: string;
  /** The fold's id, for a link or a redirect back to it. */
  id?: string;
  /** Open at first: after a save, an add or an error inside it. */
  open?: boolean;
  /** A button shown on the header while closed (a form that adds something folds to it). */
  button?: { label: string; icon?: IconName };
  /** Summary lines shown while closed, each a line; the key fact in <b>. */
  summary?: ReactNode[];
  /** A row's facts, under its name, open or closed. */
  meta?: ReactNode;
  /** A warning on the header, in amber with the sign, open or closed. */
  warning?: ReactNode;
  children: ReactNode;
}

export function Fold({
  title,
  variant = 'card',
  level,
  headingId,
  id,
  open,
  button,
  summary,
  meta,
  warning,
  children,
}: FoldProps) {
  const H = `h${level ?? (variant === 'inner' ? 3 : 2)}` as 'h2' | 'h3';
  const flag = warning ? (
    <span className="fw-fold__flag">
      <Icon name="warning" className="fw-fold__flag-icon" />
      {warning}
    </span>
  ) : null;
  const details = (
    <details
      id={variant === 'card' ? undefined : id}
      className={variant === 'card' ? undefined : `fw-fold fw-fold--${variant}`}
      open={open || undefined}
    >
      <summary className="fw-fold__head">
        <Icon name="chevron-right" className="fw-lunchday__chev" />
        {variant === 'row' ? (
          <span className="fw-fold__main">
            <H id={headingId} className="fw-fold__name">
              {title}
            </H>
            {meta ? <span className="fw-fold__meta">{meta}</span> : null}
          </span>
        ) : (
          <H id={headingId}>{title}</H>
        )}
        {flag}
        {button ? (
          <span className="fw-btn fw-btn--secondary fw-fold__closed" aria-hidden="true">
            {button.icon ? <Icon name={button.icon} className="fw-btn__icon" /> : null}
            <span>{button.label}</span>
          </span>
        ) : null}
        {summary && summary.length > 0 ? (
          <span className="fw-fold__sum">
            {summary.map((line, i) => (
              <span key={i}>{line}</span>
            ))}
          </span>
        ) : null}
      </summary>
      <div className="fw-fold__body">{children}</div>
    </details>
  );
  return variant === 'card' ? (
    <section id={id} className="fw-card fw-fold" aria-labelledby={headingId}>
      {details}
    </section>
  ) : (
    details
  );
}
