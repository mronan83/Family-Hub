import { Banner, Button } from '@familywise/ui';
import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound, redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { serverClient } from '@/lib/supabase/server';
import { AdminHeader } from '../../header';
import { removePhoto, setRewardArchived } from '../actions';
import { loadCatalog, REWARD_ICONS } from '../data';
import { RewardForm } from '../reward-form';

export const metadata: Metadata = { title: 'Edit reward' };

/** [PTS-03] Change a reward, its photo, or archive it (past requests keep the cost they had). */
export default async function EditRewardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ photo?: string }>;
}) {
  const { id } = await params;
  const db = await serverClient();
  const user = await requireSignedIn(db, `/admin/rewards/${id}`);
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const item = (await loadCatalog(db!, household.id)).find((r) => r.id === id);
  if (!item) notFound();
  const removed = (await searchParams).photo === 'removed';

  return (
    <main className="fw-page">
      <AdminHeader current="/admin/rewards" />
      {removed ? <Banner kind="info">The photo is removed; the icon shows instead.</Banner> : null}
      <section className="fw-card">
        <h1>{item.title}</h1>
        {item.imageUrl ? (
          <div className="fw-reward__photo-row">
            <Image
              src={item.imageUrl}
              alt={`Photo of ${item.title}`}
              width={160}
              height={160}
              unoptimized
              className="fw-reward__photo fw-reward__photo--large"
            />
            <form action={removePhoto}>
              <input type="hidden" name="id" value={item.id} />
              <Button type="submit" variant="ghost" icon="trash">
                Remove photo
              </Button>
            </form>
          </div>
        ) : null}
        <RewardForm id={item.id} initial={item} icons={REWARD_ICONS} hasPhoto={!!item.imagePath} />
      </section>
      <section className="fw-card" aria-labelledby="archive-heading">
        <h2 id="archive-heading">{item.archivedAt ? 'Put back' : 'Archive'}</h2>
        <p className="fw-muted">
          {item.archivedAt
            ? 'Put it back in the shop.'
            : 'It leaves the shop. Requests made for it keep the cost they had.'}
        </p>
        <form action={setRewardArchived}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="archive" value={item.archivedAt ? 'false' : 'true'} />
          <Button type="submit" variant="ghost" icon={item.archivedAt ? 'undo' : 'minus-circle'}>
            {item.archivedAt ? `Put ${item.title} back` : `Archive ${item.title}`}
          </Button>
        </form>
      </section>
    </main>
  );
}
