'use client';

import { DECADES } from '@timecapsule/shared';
import { useTranslations } from 'next-intl';
import { useId } from 'react';

/**
 * Decade filter as a native range input (full keyboard support: arrows,
 * Home/End, PageUp/PageDown). Position 0 means "all decades".
 */
export function TimeSlider({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (decade: number | undefined) => void;
}) {
  const t = useTranslations('filters');
  const id = useId();
  const index = value === undefined ? 0 : DECADES.indexOf(value) + 1;
  const label = value === undefined ? t('allDecades') : t('decadeLabel', { decade: value });

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <label htmlFor={id} className="font-semibold">
          {t('decade')}
        </label>
        <output htmlFor={id} className="font-display text-lg font-semibold tabular-nums text-accent" aria-hidden="true">
          {label}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={DECADES.length}
        step={1}
        value={index}
        aria-valuetext={label}
        onChange={(e) => {
          const i = Number(e.target.value);
          onChange(i === 0 ? undefined : DECADES[i - 1]);
        }}
        className="w-full cursor-pointer accent-accent"
      />
      <div className="flex justify-between text-xs text-muted" aria-hidden="true">
        <span>{t('allDecades')}</span>
        <span>{DECADES[0]}</span>
        <span>{DECADES[Math.floor(DECADES.length / 2)]}</span>
        <span>{DECADES.at(-1)}</span>
      </div>
    </div>
  );
}
