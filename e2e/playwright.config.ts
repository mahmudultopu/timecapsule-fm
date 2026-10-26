import { defineConfig, devices } from '@playwright/test';

// Runs against a full stack (web + API + Postgres/PostGIS + object storage)
// started separately, e.g. `docker compose -f infra/docker-compose.yml up`
// followed by `pnpm db:migrate && pnpm db:seed`. See README.
export default defineConfig({
  testDir: './tests',
  // A local `next dev` compiles each route on first visit (often 20s+);
  // CI runs a production build, so it gets tighter limits.
  timeout: process.env.CI ? 45_000 : 150_000,
  expect: { timeout: process.env.CI ? 15_000 : 45_000 },
  fullyParallel: true,
  // A dev server compiles on demand; parallel runs are for CI's production build.
  workers: process.env.CI ? 2 : 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    locale: 'en-US',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // Software WebGL for the map, and audio playback without a user prompt.
          args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
        },
      },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      grep: /@mobile/,
    },
  ],
});
