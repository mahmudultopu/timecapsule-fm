import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { safeReturnTo } from '@/lib/return-to';

// Reads the colour tokens straight from globals.css so a palette change that
// breaks WCAG 2.2 AA contrast fails the build.
const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
const token = (name: string) => {
  const m = new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(css);
  if (!m) throw new Error(`token ${name} not found`);
  return m[1]!;
};

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('colour contrast (WCAG 2.2 AA)', () => {
  it.each([
    ['ink', 'paper'],
    ['ink', 'card'],
    ['muted', 'paper'],
    ['muted', 'card'],
    ['accent', 'paper'],
    ['accent', 'card'],
    ['accent', 'accent-soft'],
    ['warn-ink', 'warn-bg'],
    ['danger', 'danger-bg'],
    ['success', 'success-bg'],
    ['paper', 'night'],
    ['mist', 'night'],
    ['glow', 'night'],
  ])('%s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it('white text on the accent and danger buttons is at least 4.5:1', () => {
    expect(contrast('#ffffff', token('accent'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', token('danger'))).toBeGreaterThanOrEqual(4.5);
  });

  it('the focus ring is at least 3:1 against the page', () => {
    expect(contrast(token('focus'), token('paper'))).toBeGreaterThanOrEqual(3);
  });
});

describe('safeReturnTo', () => {
  it.each([
    ['/contribute/abc', '/contribute/abc'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    [undefined, '/'],
  ])('%j -> %j', (input, out) => expect(safeReturnTo(input)).toBe(out));
});
