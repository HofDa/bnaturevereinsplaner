import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
// Overridable so parallel worktrees can run their browser suites side by side.
const web = process.env.E2E_WEB_PORT ?? '5174',
  api = process.env.E2E_API_PORT ?? '3002';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${web}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath:
        process.env.CHROME_PATH ??
        (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined),
      args: ['--no-sandbox'],
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: [
    {
      command:
        'bun --env-file=.env.test scripts/test-prepare.ts && bun --env-file=.env.test apps/api/src/server.ts',
      url: `http://localhost:${api}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        APP_URL: `http://localhost:${web}`,
        PORT: api,
        DOCUMENT_STORAGE_DIR: 'test-results/e2e-documents',
      },
    },
    {
      command: `${process.env.E2E_PREBUILT === 'true' ? '' : 'bun run --filter @bnature/web build && '}bun run --filter @bnature/web preview --port ${web}`,
      url: `http://localhost:${web}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { NODE_ENV: 'production', API_PROXY_URL: `http://127.0.0.1:${api}` },
    },
  ],
});
