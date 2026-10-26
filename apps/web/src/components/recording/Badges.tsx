import type { SourceType } from '@timecapsule/shared';
import { isSynthetic } from '@timecapsule/shared';
import { useTranslations } from 'next-intl';

/** Shown wherever a reconstruction's title is shown, so it is never mistaken for authentic audio. */
export function RecordingBadges({ sourceType, isDemo }: { sourceType: SourceType; isDemo: boolean }) {
  const t = useTranslations('recording');
  if (!isSynthetic(sourceType) && !isDemo) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {isSynthetic(sourceType) && (
        <span className="rounded-full bg-warn-bg px-2.5 py-0.5 text-xs font-semibold text-warn-ink">{t('synthetic')}</span>
      )}
      {isDemo && (
        <span className="rounded-full bg-ink px-2.5 py-0.5 text-xs font-semibold text-paper">{t('demo')}</span>
      )}
    </span>
  );
}
