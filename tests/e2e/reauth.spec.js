import { test, expect } from '@playwright/test';

import { setupApp } from './helpers/app.js';
import { isolateDb } from './helpers/test.js';

isolateDb(test);

test('an empty silent id token shows the re-auth prompt and recovers', async ({ page }) => {
  await setupApp(page, { signedIn: true, silentIdToken: '' });
  await page.goto('/');

  await expect(page.getByTestId('timeline-reauth')).toBeVisible();
  await expect(page.getByTestId('timeline-error')).toHaveText(
    'Sesja wygasła. Zaloguj się ponownie.'
  );
  await expect(page.getByTestId('timeline-wall')).toHaveCount(0);

  await page.getByTestId('timeline-reauth').click();

  await expect(page.getByTestId('timeline-empty')).toBeVisible();
  await expect(page.getByTestId('timeline-reauth')).toHaveCount(0);
});

test('a re-authenticated token is persisted across a reload', async ({ page }) => {
  await setupApp(page, { signedIn: true, silentIdToken: '' });
  await page.goto('/');

  await page.getByTestId('timeline-reauth').click();
  await expect(page.getByTestId('timeline-empty')).toBeVisible();

  await page.reload();

  await expect(page.getByTestId('timeline-empty')).toBeVisible();
  await expect(page.getByTestId('timeline-reauth')).toHaveCount(0);
});
