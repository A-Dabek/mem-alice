import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Each `playwright test` invocation gets its own throwaway sqlite file so
// specs never see leftover data from a previous run.
const dbPath = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'milestones-e2e-')),
  'milestones.db'
);

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
  webServer: {
    command: 'node server/index.js',
    env: {
      PORT: String(PORT),
      DB_PATH: dbPath,
      MS_CLIENT_ID: 'e2e-client-id',
      AUTH_DISABLED: '1',
    },
    url: `${BASE_URL}/api/config`,
    reuseExistingServer: false,
    timeout: 20000,
  },
});
