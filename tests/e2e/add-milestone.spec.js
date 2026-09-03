import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_IMAGE = path.join(__dirname, 'fixtures', 'sample.png');
const PASSPHRASE = 'correct horse battery staple';

test('adding a milestone shows it decrypted in the Timeline immediately', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('passphrase-input').fill(PASSPHRASE);
  await page.getByTestId('unlock-button').click();
  await expect(page.getByTestId('timeline-empty')).toBeVisible();

  await page.getByTestId('add-button').click();
  await expect(page.getByTestId('photo-input')).toBeVisible();

  await page.getByTestId('photo-input').setInputFiles(FIXTURE_IMAGE);
  await page.getByTestId('title-input').fill('Learned to ride a bike');
  await page.getByTestId('save-button').click();

  // Saving switches back to the Timeline (the `#add` route), which should
  // immediately show the freshly decrypted milestone (client-side
  // decryption round-trip).
  await expect(page.getByTestId('milestone-title')).toHaveText('Learned to ride a bike');
  await expect(page.getByTestId('milestone-photo')).toBeVisible();
});
