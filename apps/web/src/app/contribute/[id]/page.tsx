import { Agreement, RecordingId, SubmissionDetail } from '@timecapsule/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { SubmissionEditor } from '@/components/contribute/SubmissionEditor';
import { apiAsViewer } from '@/lib/server/api';
import { MAP_WORKER_URL, mapStyleUrl } from '@/lib/runtime-config';
import { requireViewer } from '@/lib/server/session';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('editor'))('pageTitle') };
}

export default async function EditSubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireViewer(`/contribute/${id}`);
  if (!RecordingId.safeParse(id).success) notFound();
  const [detail, agreement] = await Promise.all([
    apiAsViewer(SubmissionDetail, `/v1/submissions/${id}`),
    apiAsViewer(Agreement, '/v1/agreements/current'),
  ]);
  if (!detail) notFound();
  return <SubmissionEditor initial={detail} agreement={agreement} styleUrl={mapStyleUrl()} workerUrl={MAP_WORKER_URL} />;
}
