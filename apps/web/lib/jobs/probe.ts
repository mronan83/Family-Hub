import { jobAuthError } from './auth';

/** The probe sleeps on request, so it is capped just past Vercel Hobby's 300 s limit (01 §5.6). */
export const PROBE_MAX_SECONDS = 330;

/**
 * SPIKE-05 probe access. Production needs the job secret, like every job endpoint. Previews have no
 * job secret by design (D-37); there the probe relies on Vercel deployment protection, which only the
 * automation bypass secret or a team login gets through, so the spike can measure a pull request's
 * preview. Local runs refuse.
 */
export function probeAuthError(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): Response | null {
  if (env.VERCEL_ENV === 'preview') return null;
  return jobAuthError(request, env.JOB_SIGNING_SECRET);
}

/** How long the probe should run: whole seconds from `?seconds=`, 0 to PROBE_MAX_SECONDS. */
export function probeSeconds(url: URL): number {
  const n = Math.floor(Number(url.searchParams.get('seconds')));
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), PROBE_MAX_SECONDS) : 0;
}

/** Process CPU time (user and system) since `since`, in milliseconds. */
export function cpuMs(since?: NodeJS.CpuUsage): number {
  const { user, system } = process.cpuUsage(since);
  return Math.round((user + system) / 1000);
}
