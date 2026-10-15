// [DEV-05] A board picks up a new deploy by itself (WP-78, D-99). A kiosk left open ran the version
// it first loaded until something went wrong: the owner's kitchen board still showed the menu as it
// was before WP-64. The board asks /api/health which commit is deployed, and when it isn't the one
// the board runs, reloads once nobody is using it: no dialog open, and nobody has touched it for a
// while. It never reloads in the middle of a tap.

/** How often a board asks which version is deployed. */
export const DEPLOY_CHECK_MS = 5 * 60_000;
/** How long nobody has touched a board before it may reload. */
export const IDLE_MS = 2 * 60_000;
/** How often a board that has seen a new deploy looks for a moment to reload. */
export const RELOAD_CHECK_MS = 10_000;

const SHA = /^[0-9a-f]{7,40}$/i;

/**
 * True when the deployed commit is not the one the board runs. Only real commits count: a local or
 * dev build ("dev", "local") never reloads.
 */
export function isNewDeploy(running: string, deployed: unknown): boolean {
  if (typeof deployed !== 'string' || !SHA.test(running) || !SHA.test(deployed)) return false;
  const n = Math.min(running.length, deployed.length);
  return running.slice(0, n).toLowerCase() !== deployed.slice(0, n).toLowerCase();
}

/** True when a board may reload now: no dialog open, and untouched for IDLE_MS. */
export function mayReload(now: number, lastTouch: number, dialogOpen: boolean): boolean {
  return !dialogOpen && now - lastTouch >= IDLE_MS;
}
