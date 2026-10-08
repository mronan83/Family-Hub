// FamilyWise design system (component `UI`, 06 §11). Styles: import '@familywise/ui/ui.css' once at
// the root; it carries the brand tokens. Fonts are served from /brand/fonts.css.
export const BRAND_NAME = 'FamilyWise';

export { ICONS, ICON_NAMES, type IconName } from './generated/icons';
export { BRAND_COLORS } from './generated/colors';
export { Icon, iconLabel, type IconProps } from './Icon';
export {
  Avatar,
  AVATAR_KEYS,
  MEMBER_COLORS,
  initials,
  type AvatarKey,
  type AvatarProps,
  type MemberColor,
} from './Avatar';
export { ChoreTile, type ChoreTileProps } from './ChoreTile';
export {
  DISPLAY_STATES,
  TILE_STATES,
  tileState,
  type DisplayState,
  type TileState,
  type TileTone,
} from './tile-states';
export { PointsChip, type PointsChipProps } from './PointsChip';
export { GoalMeter, type GoalMeterProps } from './GoalMeter';
export { Banner, type BannerKind } from './Banner';
export { Button, type ButtonProps, type ButtonVariant } from './Button';
export { BootSplash } from './BootSplash';
export { Logo, type LogoProps } from './Logo';
export {
  BOARD_THEME_SCHEDULE,
  boardTheme,
  localMinutes,
  themeBootScript,
  type Theme,
  type ThemeOverride,
} from './theme';
export { BoardThemeController, SystemThemeController, ThemeLock } from './ThemeControllers';
