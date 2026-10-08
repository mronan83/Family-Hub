// SPIKE-05 probe (01 §5.6): pg_net calls it the way pg_cron jobs will call the job endpoints, to
// measure how long a call may run on Vercel Hobby and what an invocation costs. It sleeps for
// `?seconds=` and reports its instance, whether it was a cold start, and the CPU it used.
import { cpuMs, probeAuthError, probeSeconds } from '@/lib/jobs/probe';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const bootCpuMs = cpuMs();
const instance = crypto.randomUUID().slice(0, 8);
let served = 0;

export async function POST(request: Request) {
  const refused = probeAuthError(request);
  if (refused) return refused;

  const started = Date.now();
  const cpu = process.cpuUsage();
  served += 1;
  const cold = served === 1;
  const seconds = probeSeconds(new URL(request.url));
  const body: unknown = await request.json().catch(() => null);
  const tag =
    body && typeof body === 'object' && 'tag' in body && typeof body.tag === 'string'
      ? body.tag.slice(0, 40)
      : null;

  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));

  return Response.json({
    tag,
    seconds,
    instance,
    cold,
    bootCpuMs: cold ? bootCpuMs : null,
    cpuMs: cpuMs(cpu),
    ranMs: Date.now() - started,
    region: process.env.VERCEL_REGION ?? 'local',
  });
}
