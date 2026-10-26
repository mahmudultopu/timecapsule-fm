import { Decade, LicenseSchema, SoundCategorySchema, type License, type SoundCategory } from '@timecapsule/shared';

export interface Filters {
  decade?: number;
  category?: SoundCategory;
  license?: License;
  q?: string;
}

type RawParams = URLSearchParams | Record<string, string | string[] | undefined>;

function read(params: RawParams, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

/** Parses filters from the URL, silently dropping anything invalid. */
export function parseFilters(params: RawParams): Filters {
  const out: Filters = {};
  const decade = Decade.safeParse(read(params, 'decade'));
  if (decade.success) out.decade = decade.data;
  const category = SoundCategorySchema.safeParse(read(params, 'category'));
  if (category.success) out.category = category.data;
  const license = LicenseSchema.safeParse(read(params, 'license'));
  if (license.success) out.license = license.data;
  const q = read(params, 'q')?.trim().slice(0, 100);
  if (q) out.q = q;
  return out;
}

export function toSearchParams(f: Filters, opts: { q?: boolean } = {}): URLSearchParams {
  const qs = new URLSearchParams();
  if (f.decade !== undefined) qs.set('decade', String(f.decade));
  if (f.category) qs.set('category', f.category);
  if (f.license) qs.set('license', f.license);
  if (f.q && opts.q !== false) qs.set('q', f.q);
  return qs;
}

export function filtersEqual(a: Filters, b: Filters): boolean {
  return toSearchParams(a).toString() === toSearchParams(b).toString();
}
