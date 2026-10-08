// [NFR-14] Production smoke check target: answers without touching the database.
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({
    status: 'ok',
    app: 'familywise',
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local',
  });
}
