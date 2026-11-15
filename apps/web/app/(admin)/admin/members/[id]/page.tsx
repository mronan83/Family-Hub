import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { LINK_ERRORS } from '@/lib/link-me';
import { memberOpen } from '@/lib/reward-facts';
import { serverClient } from '@/lib/supabase/server';
import { addDays } from '@/lib/board-sleep';
import { householdNow, MISSED_OR_LATE_DAYS, missedOrLate, onTimeNotice } from '@/lib/on-time';
import { loadCheckOffs, type OnTimeParams, onTimeRow } from '../../on-time';
import { loadMemberChores } from '../../today/data';
import { loadAdmins, loadMembers, loadPoints } from '../data';
import { MemberView } from '../view';

export const metadata: Metadata = { title: 'Edit member' };

export default async function EditMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<
    { adjusted?: string; did?: string; error?: string; open?: string } & OnTimeParams
  >;
}) {
  const { id } = await params;
  const db = await serverClient();
  const user = await requireSignedIn(db, `/admin/members/${id}`);
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const [members, admins] = await Promise.all([
    loadMembers(db!, household.id),
    loadAdmins(db!, household.id),
  ]);
  const member = members.find((m) => m.id === id);
  if (!member) notFound();
  const points = await loadPoints(db!, member.id);
  const linkedElsewhere = new Set(
    members.filter((m) => m.id !== id && m.userId).map((m) => m.userId),
  );
  // [D-61] Sign-ins on another member are named, not silently left out of the choice.
  const elsewhere = members
    .filter((m) => m.id !== id && m.userId)
    .map((m) => ({
      email: admins.find((a) => a.userId === m.userId)?.email ?? 'an admin',
      name: m.displayName,
      archived: Boolean(m.archivedAt),
    }));
  // [D-61] "This is me": an adult still here with no sign-in, for a parent not linked to anyone still
  // here (their sign-in on no one, or on an archived record, which it moves from).
  const mine = members.find((m) => m.userId === user.userId) ?? null;
  const offerMe =
    member.role === 'adult' && !member.archivedAt && !member.userId && (!mine || !!mine.archivedAt);
  // An adjustment shows who made it: the admin's member name, else their email.
  const adminName = (userId: string) =>
    members.find((m) => m.userId === userId)?.displayName ??
    admins.find((a) => a.userId === userId)?.email ??
    'an admin';
  const query = await searchParams;
  // [CHR-24] Missed or late (WP-117): this member's chores of the last 14 days, a child's or anyone's
  // who earns rewards.
  const now = householdNow(household.timezone);
  const today = now.slice(0, 10);
  const from = addDays(today, -(MISSED_OR_LATE_DAYS - 1));
  const late =
    member.role === 'child' || member.earnsRewards
      ? await (async () => {
          const chores = await loadMemberChores(db!, household.id, member.id, from, today);
          const checks = await loadCheckOffs(
            db!,
            chores.map((c) => c.id),
          );
          const items = chores.map((c) => ({ ...c, checkOff: checks.get(c.id) ?? null }));
          const rows = missedOrLate(items, checks, now, from);
          const onTime = await onTimeRow(
            db!,
            household,
            rows.map((r) => r.item),
            query,
            members,
            `/admin/members/${member.id}?open=late`,
            now,
          );
          return { rows, onTime };
        })()
      : null;
  const lateNotice =
    query.did === 'ontime' && late
      ? onTimeNotice(late.rows.find((r) => r.item.id === query.item)?.item.title ?? 'it', [
          member.displayName,
        ])
      : null;
  return (
    <MemberView
      member={member}
      admins={admins.filter((a) => !linkedElsewhere.has(a.userId))}
      elsewhere={elsewhere}
      offerMe={offerMe ? { mine: mine?.displayName ?? null } : null}
      linked={query.did === 'linked' && member.userId === user.userId}
      linkError={query.error ? (LINK_ERRORS[query.error] ?? LINK_ERRORS.link_failed!) : null}
      points={points}
      adminName={adminName}
      timezone={household.timezone}
      today={today}
      adjusted={Number(query.adjusted)}
      pointsOpen={memberOpen(query).points}
      requestId={randomUUID()}
      late={
        late
          ? {
              ...late,
              people: members.filter((m) => !m.archivedAt),
              open: query.open === 'late' || Boolean(query.confirm),
              notice: lateNotice,
              error:
                query.error?.startsWith('ontime') || (query.open === 'late' && query.error)
                  ? 'That wasn’t marked on time. Choose On time, or a time on its day up to its due time, and who did it.'
                  : null,
            }
          : null
      }
    />
  );
}
