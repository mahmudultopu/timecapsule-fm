import { expect, test, type Page } from '@playwright/test';

const audioTime = (page: Page) => page.evaluate(() => document.querySelector('audio')?.currentTime ?? 0);

test.describe('listening', () => {
  test('plays streamed audio with a waveform, seek and loop', async ({ page }) => {
    await page.goto('/list');
    await page.getByRole('button', { name: /^Play .*Shibuya Crossing/ }).first().click();

    const player = page.getByRole('region', { name: 'Audio player' });
    await expect(player.getByRole('button', { name: 'Pause' })).toBeVisible();
    await expect.poll(() => audioTime(page)).toBeGreaterThan(0.5);

    // Signed URL, never a raw bucket path. (Demo-mode deployments serve the
    // public synthetic clips as static files instead; E2E_DEMO=1 skips this.)
    if (!process.env.E2E_DEMO) {
      const src = await page.evaluate(() => document.querySelector('audio')!.currentSrc);
      expect(src).toMatch(/X-Amz-Signature=/);
      const expires = Number(/X-Amz-Expires=(\d+)/.exec(src)?.[1]);
      expect(expires).toBeGreaterThanOrEqual(300);
      expect(expires).toBeLessThanOrEqual(900);
    }

    const seek = player.getByRole('slider', { name: 'Seek' });
    await seek.focus();
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
    await expect.poll(() => audioTime(page)).toBeGreaterThan(9);

    // With loop on, reaching the end wraps around and keeps playing.
    await player.getByRole('button', { name: 'Loop' }).click();
    await expect(player.getByRole('button', { name: 'Loop' })).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => document.querySelector('audio')!.loop)).toBe(true);
    await seek.focus();
    await page.keyboard.press('End');
    await expect.poll(() => audioTime(page), { timeout: 8_000 }).toBeLessThan(5);

    await player.getByRole('button', { name: 'Pause' }).click();
    await expect(player.getByRole('button', { name: 'Play' })).toBeVisible();
  });

  test('keeps playing while navigating to and panning the map', async ({ page }) => {
    await page.goto('/list');
    await page.getByRole('button', { name: /^Play / }).first().click();
    await expect.poll(() => audioTime(page)).toBeGreaterThan(0.3);
    // Demo clips are 20 s; loop so the check is about continuity, not clip length.
    await page.getByRole('region', { name: 'Audio player' }).getByRole('button', { name: 'Loop' }).click();

    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Map' }).click();
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    const before = await audioTime(page);

    const canvas = page.locator('.maplibregl-canvas');
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 200, box.y + box.height / 2 + 80, { steps: 10 });
    await page.mouse.up();

    await expect.poll(() => audioTime(page)).toBeGreaterThan(before + 0.5);
    await expect(page.getByRole('region', { name: 'Audio player' }).getByRole('button', { name: 'Pause' })).toBeVisible();
  });

  test('player controls are keyboard operable', async ({ page }) => {
    await page.goto('/list');
    const play = page.getByRole('button', { name: /^Play / }).first();
    await play.focus();
    await page.keyboard.press('Enter');
    const player = page.getByRole('region', { name: 'Audio player' });
    await expect(player.getByRole('button', { name: 'Pause' })).toBeVisible();
    await player.getByRole('button', { name: 'Pause' }).focus();
    await page.keyboard.press('Space');
    await expect(player.getByRole('button', { name: 'Play' })).toBeVisible();
  });
});
