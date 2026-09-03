import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Each `playwright test` invocation (see package.json's `test:e2e`, which
// runs one spec file per invocation) gets its own throwaway sqlite file so
// specs never see leftover data from a previous run - the server never
// persists plaintext, but we still want a clean slate of ciphertext rows
// per spec file.
const dbPath = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'milestones-e2e-')),
  'milestones.db'
);

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

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
    },
    url: `${BASE_URL}/api/salt`,
    reuseExistingServer: false,
    timeout: 20000,
  },
});
