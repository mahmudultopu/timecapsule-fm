import { RecordingId } from '@timecapsule/shared';
import { ExploreView } from '@/components/map/ExploreView';
import { getRecording } from '@/lib/api';
import { parseFilters } from '@/lib/filters';
import { MAP_WORKER_URL, mapStyleUrl } from '@/lib/runtime-config';

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseFilters(params);
  const r = RecordingId.safeParse(Array.isArray(params.r) ? params.r[0] : params.r);
  // Shared links (?r=…) render with the recording already open.
  const initialRecording = r.success ? await getRecording(r.data, { cache: 'no-store' }).catch(() => null) : null;
  return (
    <ExploreView
      filters={filters}
      initialSelected={r.success ? r.data : null}
      initialRecording={initialRecording}
      styleUrl={mapStyleUrl()}
      workerUrl={MAP_WORKER_URL}
    />
  );
}
