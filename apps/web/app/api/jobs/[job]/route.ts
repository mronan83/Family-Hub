// [NFR-07] Job endpoints (01 §5.6): pg_cron calls POST /api/jobs/<job> through pg_net with the job
// secret. The URL uses kebab-case; the job is registered under its snake_case schedule name.
import { handleJob } from '@/lib/jobs/run';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ job: string }> }) {
  const { job } = await params;
  return handleJob(request, job.replaceAll('-', '_'));
}
