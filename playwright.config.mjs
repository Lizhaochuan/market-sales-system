import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 30000,
  expect: { timeout: 10000 },
  workers: 1,
  retries: 0,
  reporter: [['list'],['html',{open:'never',outputFolder:'playwright-report'}]],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node src/server.mjs',
    url: 'http://127.0.0.1:3100/api/v1/health',
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      MS_STAGE: 'isolated-test',
      ...process.env
    }
  }
});
