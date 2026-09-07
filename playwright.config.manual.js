import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://[::1]:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    ...devices['Pixel 5'],
  },
  // No webServer - we start it manually
});
