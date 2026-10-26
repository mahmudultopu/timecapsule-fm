'use client';

import { LICENSES, SOUND_CATEGORIES, type License, type SoundCategory } from '@timecapsule/shared';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useId, useOptimistic, useState, useTransition } from 'react';
import { toSearchParams, type Filters } from '@/lib/filters';
import { TimeSlider } from './TimeSlider';

/**
 * Filters live in the URL (shareable, back-button friendly). Changing one
 * replaces the query string; the server page re-renders with the new filters.
 */
export function FilterBar({
  filters: committed,
  showSearch = true,
  compact = false,
}: {
  filters: Filters;
  showSearch?: boolean;
  /** Narrow stacked layout for the floating map panel. */
  compact?: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  // Controls reflect a change immediately while the server re-renders;
  // without this the slider snaps back between key presses.
  const [filters, setOptimistic] = useOptimistic(committed);
  const [q, setQ] = useState(committed.q ?? '');
  const ids = { category: useId(), license: useId(), q: useId() };

  const apply = (next: Filters) => {
    const qs = toSearchParams(next).toString();
    startTransition(() => {
      setOptimistic(next);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  };

  // Debounced search-as-you-type.
  useEffect(() => {
    if ((filters.q ?? '') === q.trim()) return;
    const timer = setTimeout(() => apply({ ...filters, q: q.trim() || undefined }), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when the text changes
  }, [q]);

  const hasFilters = Object.values(filters).some((v) => v !== undefined);

  return (
    <form
      role="search"
      aria-label={t('filters.heading')}
      onSubmit={(e) => {
        e.preventDefault();
        apply({ ...filters, q: q.trim() || undefined });
      }}
      className={compact ? 'grid grid-cols-2 gap-3' : 'flex flex-wrap items-end gap-4'}
    >
      <div className={compact ? 'col-span-2' : 'min-w-64 flex-1'}>
        <TimeSlider value={filters.decade} onChange={(decade) => apply({ ...filters, decade })} />
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={ids.category} className="label mb-0">
          {t('filters.category')}
        </label>
        <select
          id={ids.category}
          value={filters.category ?? ''}
          onChange={(e) => apply({ ...filters, category: (e.target.value || undefined) as SoundCategory | undefined })}
          className="field"
        >
          <option value="">{t('filters.allCategories')}</option>
          {SOUND_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`category.${c}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={ids.license} className="label mb-0">
          {t('filters.license')}
        </label>
        <select
          id={ids.license}
          value={filters.license ?? ''}
          onChange={(e) => apply({ ...filters, license: (e.target.value || undefined) as License | undefined })}
          className="field"
        >
          <option value="">{t('filters.allLicenses')}</option>
          {LICENSES.map((l) => (
            <option key={l} value={l}>
              {t(`license.${l}`)}
            </option>
          ))}
        </select>
      </div>

      {showSearch && (
        <div className="flex min-w-52 flex-col gap-1 text-sm">
          <label htmlFor={ids.q} className="label mb-0">
            {t('filters.search')}
          </label>
          <input
            id={ids.q}
            type="search"
            value={q}
            maxLength={100}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('filters.searchPlaceholder')}
            className="field"
            dir="auto"
          />
        </div>
      )}

      {hasFilters && (
        <button
          type="button"
          className={`btn btn-ghost text-sm text-accent ${compact ? 'col-span-2 justify-self-start px-2' : ''}`}
          onClick={() => {
            setQ('');
            apply({});
          }}
        >
          {t('filters.clear')}
        </button>
      )}
    </form>
  );
}
