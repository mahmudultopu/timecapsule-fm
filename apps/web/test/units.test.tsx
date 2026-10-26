import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TimeSlider } from '@/components/filters/TimeSlider';
import { viewportBBox } from '@/components/map/MapExplorer';
import { buildCsp, mapOriginsFromEnv } from '@/lib/csp';
import { parseFilters, toSearchParams } from '@/lib/filters';
import { formatDuration } from '@/lib/format';
import { dirFor, negotiate } from '@/i18n/config';
import ar from '../messages/ar.json';
import en from '../messages/en.json';
import ja from '../messages/ja.json';
import { renderWithIntl } from './utils';

describe('TimeSlider', () => {
  it('starts at "all decades" and announces the decade as text', () => {
    const onChange = vi.fn();
    renderWithIntl(<TimeSlider value={undefined} onChange={onChange} />);
    const slider = screen.getByRole('slider', { name: 'Decade' });
    expect(slider).toHaveAttribute('aria-valuetext', 'All decades');
    fireEvent.change(slider, { target: { value: '10' } });
    expect(onChange).toHaveBeenCalledWith(1980);
  });

  it('reflects the selected decade', () => {
    renderWithIntl(<TimeSlider value={1970} onChange={() => {}} />);
    expect(screen.getByRole('slider', { name: 'Decade' })).toHaveAttribute('aria-valuetext', '1970s');
  });
});

describe('CSP', () => {
  const opts = { nonce: 'abc123', mediaOrigins: ['https://media.test'], mapOrigins: ['https://tiles.test'] };

  it('is strict in production', () => {
    const csp = buildCsp({ ...opts, dev: false, upgradeInsecure: true });
    const script = csp.split('; ').find((d) => d.startsWith('script-src '))!;
    const style = csp.split('; ').find((d) => d.startsWith('style-src '))!;
    expect(script).toContain("'nonce-abc123'");
    expect(script).not.toMatch(/unsafe-(inline|eval)/);
    expect(style).not.toContain('unsafe-inline');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain('upgrade-insecure-requests');
    expect(csp).toMatch(/media-src [^;]*https:\/\/media\.test/);
    expect(csp).toMatch(/connect-src [^;]*https:\/\/tiles\.test/);
  });

  it('only relaxes for development, and only upgrades requests on HTTPS', () => {
    expect(buildCsp({ ...opts, dev: false, upgradeInsecure: false })).not.toContain('upgrade-insecure-requests');
    expect(buildCsp({ ...opts, dev: true, upgradeInsecure: false })).toContain("'unsafe-eval'");
    expect(buildCsp({ ...opts, dev: false, upgradeInsecure: false })).not.toContain("'unsafe-eval'");
  });

  it('derives map origins from the style URL', () => {
    expect(mapOriginsFromEnv({ MAP_STYLE_URL: 'https://maps.example.org/style.json' })).toEqual(['https://maps.example.org']);
    expect(mapOriginsFromEnv({ NODE_ENV: 'production' })).toEqual([]);
  });
});

describe('filters', () => {
  it('drops invalid values from the URL', () => {
    expect(parseFilters(new URLSearchParams('decade=1985&category=shops&license=cc0&q=%20Tokyo%20'))).toEqual({
      license: 'cc0',
      q: 'Tokyo',
    });
  });

  it('round-trips', () => {
    const f = { decade: 1980, category: 'transit' as const, q: 'Paris' };
    expect(parseFilters(toSearchParams(f))).toEqual(f);
  });
});

describe('viewportBBox', () => {
  it('wraps longitudes past ±180', () => {
    expect(viewportBBox(170, -10, 190, 10)).toEqual({ west: 170, south: -10, east: -170, north: 10 });
  });
  it('covers the world when zoomed far out', () => {
    expect(viewportBBox(-400, -100, 400, 100)).toEqual({ west: -180, south: -90, east: 180, north: 90 });
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [75_000, '1:15'],
    [3_725_000, '1:02:05'],
  ])('%i ms -> %s', (ms, out) => expect(formatDuration(ms)).toBe(out));
});

describe('i18n', () => {
  const keys = (o: object, prefix = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));

  it.each([
    ['ar', ar],
    ['ja', ja],
  ])('%s has exactly the same keys as en', (_locale, messages) => {
    expect(keys(messages).sort()).toEqual(keys(en).sort());
  });

  it('negotiates from Accept-Language', () => {
    expect(negotiate('fr-FR,ja;q=0.8,en;q=0.5')).toBe('ja');
    expect(negotiate('ar-EG')).toBe('ar');
    expect(negotiate('de')).toBe('en');
    expect(negotiate(null)).toBe('en');
  });

  it('marks Arabic as right-to-left', () => {
    expect(dirFor('ar')).toBe('rtl');
    expect(dirFor('ja')).toBe('ltr');
  });
});
