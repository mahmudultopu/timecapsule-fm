import { RecordingId } from '@timecapsule/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { RecordingDetailView } from '@/components/recording/RecordingDetailView';
import { getRecording } from '@/lib/api';

const load = cache(async (raw: string) => {
  const id = RecordingId.safeParse(raw);
  if (!id.success) return null;
  return getRecording(id.data, { cache: 'no-store' });
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const rec = await load((await params).id);
  return rec ? { title: rec.title.en, description: rec.sceneDescription.en } : {};
}

export default async function RecordingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rec = await load(id);
  if (!rec) notFound();
  const t = await getTranslations('recording');
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <nav className="flex items-center justify-between text-sm">
        <Link href="/list" className="text-muted hover:text-ink">
          ← {t('backToList')}
        </Link>
        <Link href={`/?r=${rec.id}`} className="text-muted hover:text-ink">
          {t('showOnMap')}
        </Link>
      </nav>
      <div className="card p-6 sm:p-8 motion-safe:animate-fade-up">
        <RecordingDetailView recording={rec} headingLevel={1} />
      </div>
      <p className="text-center text-xs text-muted">
        {t('reportPrompt')}{' '}
        <Link href={`/legal/takedown?recording=${rec.id}`} className="underline hover:text-ink">
          {t('report')}
        </Link>
      </p>
    </div>
  );
}
