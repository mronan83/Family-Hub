'use client';
// Keep <html data-theme> current after the boot script: the board re-checks the clock every
// minute (with the household timezone once known); the admin app follows the device's dark mode.
import { useEffect } from 'react';
import { boardTheme, type Theme, type ThemeOverride } from './theme';

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function BoardThemeController({
  timeZone,
  override = 'auto',
}: {
  timeZone?: string;
  override?: ThemeOverride;
}) {
  useEffect(() => {
    const update = () => apply(boardTheme(new Date(), { timeZone, override }));
    update();
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, [timeZone, override]);
  return null;
}

export function SystemThemeController() {
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const update = () => apply(query.matches ? 'evening' : 'day');
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return null;
}

/** Forces one theme while mounted (the brand page's theme switch). */
export function ThemeLock({ theme }: { theme: Theme }) {
  useEffect(() => apply(theme), [theme]);
  return null;
}
