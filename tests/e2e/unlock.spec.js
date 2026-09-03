import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_IMAGE = path.join(__dirname, 'fixtures', 'sample.png');
const PASSPHRASE = 'correct horse battery staple';

test.describe('Unlock flow', () => {
  test('unlocking succeeds trivially against an empty database', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('passphrase-input').fill(PASSPHRASE);
    await page.getByTestId('unlock-button').click();

    // Nothing to decrypt yet, so any passphrase unlocks the app.
    await expect(page.getByTestId('unlock-error')).toHaveCount(0);
    await expect(page.getByTestId('timeline-empty')).toBeVisible();
  });

  test('wrong passphrase after a milestone exists shows an error and keeps the app locked', async ({
    page,
  }) => {
    // Unlock and add a milestone so there is something to validate against.
    await page.goto('/');
    await page.getByTestId('passphrase-input').fill(PASSPHRASE);
    await page.getByTestId('unlock-button').click();
    await expect(page.getByTestId('timeline-empty')).toBeVisible();

    await page.getByTestId('add-button').click();
    await page.getByTestId('photo-input').setInputFiles(FIXTURE_IMAGE);
    await page.getByTestId('title-input').fill('First milestone');
    await page.getByTestId('save-button').click();
    await expect(page.getByTestId('milestone-title')).toHaveText('First milestone');

    // Reload (fresh in-memory key) and try an incorrect passphrase.
    await page.reload();
    await page.getByTestId('passphrase-input').fill('definitely the wrong passphrase');
    await page.getByTestId('unlock-button').click();

    await expect(page.getByTestId('unlock-error')).toBeVisible();
    await expect(page.getByTestId('add-button')).toHaveCount(0);

    // The correct passphrase still unlocks afterwards.
    await page.getByTestId('passphrase-input').fill(PASSPHRASE);
    await page.getByTestId('unlock-button').click();
    await expect(page.getByTestId('unlock-error')).toHaveCount(0);
    await expect(page.getByTestId('milestone-title')).toHaveText('First milestone');
  });
});
