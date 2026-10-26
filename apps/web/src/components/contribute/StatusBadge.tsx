import type { RecordingStatus } from '@timecapsule/shared';
import { useTranslations } from 'next-intl';

const TONE: Record<RecordingStatus, string> = {
  draft: 'bg-ink/8 text-ink',
  processing: 'bg-[#e6ecfb] text-[#1d3fa8]',
  processing_failed: 'bg-danger-bg text-danger',
  ready: 'bg-[#e6ecfb] text-[#1d3fa8]',
  pending_review: 'bg-warn-bg text-warn-ink',
  published: 'bg-success-bg text-success',
  rejected: 'bg-danger-bg text-danger',
  unpublished: 'bg-ink/8 text-muted',
};

export function StatusBadge({ status }: { status: RecordingStatus }) {
  const t = useTranslations('status');
  return <span className={`chip ${TONE[status]}`}>{t(status)}</span>;
}
