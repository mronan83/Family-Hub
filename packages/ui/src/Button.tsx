// Buttons (06 §7.2): primary (teal), secondary (teal tint), ghost (line border). On the board a
// button always pairs an icon with a word; touch height comes from the surface (56 board, 44 admin).
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon } from './Icon';
import type { IconName } from './generated/icons';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: IconName;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  icon,
  children,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`fw-btn fw-btn--${variant}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {icon ? <Icon name={icon} className="fw-btn__icon" /> : null}
      <span>{children}</span>
    </button>
  );
}
