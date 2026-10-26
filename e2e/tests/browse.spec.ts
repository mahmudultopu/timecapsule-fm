import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function expectNoSeriousA11yIssues(page: Page) {
  // Scan the settled page: mid-fade text is semi-transparent and would be
  // misreported as low contrast.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    // The WebGL map canvas is decorative for assistive tech; the list is the alternative.
    .exclude('.maplibregl-canvas')
    .analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test.describe('browse', () => {
  test('list view shows recordings with provenance and synthetic labels @mobile', async ({ page }) => {
    await page.goto('/list');
    await expect(page.getByRole('heading', { level: 1, name: 'Recordings' })).toBeVisible();
    const items = page.getByRole('listitem').filter({ has: page.getByRole('button', { name: /^Play / }) });
    await expect(items.first()).toBeVisible();
    expect(await items.count()).toBeGreaterThanOrEqual(1);
    // Every seeded demo row is a reconstruction and must say so.
    for (const item of await items.all()) {
      if (await item.getByText('Demo placeholder').count()) {
        await expect(item.getByText(/not an authentic recording/)).toBeVisible();
      }
    }
    await expectNoSeriousA11yIssues(page);
  });

  test('decade filter narrows the list and is reflected in the URL', async ({ page }) => {
    await page.goto('/list');
    const slider = page.getByRole('slider', { name: 'Decade' });
    await slider.focus();
    // "All decades" -> 1890s ... step right to the 1980s (10 steps).
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
    // Each step re-renders on the server; the controls update optimistically meanwhile.
    await expect(slider).toHaveAttribute('aria-valuetext', '1980s');
    await expect(page).toHaveURL(/decade=1980/, { timeout: 30_000 });
    // Every card left in the list is from the 1980s.
    const cards = page.getByRole('listitem').filter({ has: page.getByRole('button', { name: /^Play / }) });
    await expect(cards.first()).toBeVisible();
    for (const text of await cards.allTextContents()) expect(text).toMatch(/\b198\d\b/);
  });

  test('city search matches local-language names', async ({ page }) => {
    await page.goto(`/list?q=${encodeURIComponent('東京')}`);
    await expect(page.getByRole('link', { name: /Shibuya Crossing/ })).toBeVisible();
  });

  test('recording page shows every provenance field', async ({ page }) => {
    await page.goto('/list');
    await page.getByRole('link', { name: /Shibuya Crossing/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Shibuya Crossing');
    const prov = page.getByRole('region', { name: 'Provenance' });
    for (const label of [
      'Source',
      'Audio captured',
      'Date confidence',
      'Recorder',
      'Location precision',
      'Rights',
      'License',
      'Rights holder',
      'Attribution',
      'Speech',
      'How this was made',
    ]) {
      await expect(prov.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('渋谷スクランブル交差点').first()).toHaveAttribute('lang', 'ja');
    await expectNoSeriousA11yIssues(page);
  });

  test('switching to Arabic renders right-to-left', async ({ page }) => {
    await page.goto('/list');
    await page.getByLabel('Language').selectOption('ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.getByRole('heading', { level: 1, name: 'التسجيلات' })).toBeVisible();
    await page.context().clearCookies();
  });

  test('map explorer lists recordings in view and opens the detail panel', async ({ page }) => {
    const cspErrors: string[] = [];
    page.on('console', (m) => {
      if (/Content Security Policy/i.test(m.text())) cspErrors.push(m.text());
    });
    await page.goto('/');
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    const inView = page.getByRole('region', { name: /recordings? in view/ });
    await expect(inView.getByRole('button').first()).toBeVisible();
    await inView.getByRole('button', { name: /Times Square/ }).click();
    await expect(page.getByRole('heading', { level: 2, name: /Times Square/ })).toBeVisible();
    await expect(page).toHaveURL(/[?&]r=[0-9a-f-]{36}/);
    expect(cspErrors).toEqual([]);
  });

  test('shared links open with the recording selected', async ({ page }) => {
    await page.goto('/list');
    const href = await page.getByRole('link', { name: /Nile riverbank/ }).getAttribute('href');
    const id = href!.split('/').pop();
    await page.goto(`/?r=${id}`);
    await expect(page.getByRole('heading', { level: 2, name: /Nile riverbank/ })).toBeVisible();
  });

  test('sets security headers', async ({ request }) => {
    const res = await request.get('/list');
    const h = res.headers();
    expect(h['content-security-policy']).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['strict-transport-security']).toContain('max-age=');
    expect(h['permissions-policy']).toContain('camera=()');
  });
});
