import { test, expect } from '@playwright/test';

import { setupApp } from './helpers/app.js';
import { DEFAULT_ACCOUNT } from './helpers/auth.js';
import { isolateDb } from './helpers/test.js';

isolateDb(test);

test('signed out shows the sign-in gate', async ({ page }) => {
  await setupApp(page, { signedIn: false });
  await page.goto('/');

  await expect(page.getByTestId('signin-button')).toBeVisible();
  await expect(page.getByTestId('timeline-wall')).toHaveCount(0);
});

test('signing in reveals the timeline and the account name', async ({ page }) => {
  await setupApp(page, { signedIn: false });
  await page.goto('/');

  await page.getByTestId('signin-button').click();

  await expect(page.getByTestId('timeline-empty')).toBeVisible();
  await expect(page.getByTestId('app-account')).toHaveText(DEFAULT_ACCOUNT.name);
});

test('signing out returns to the gate and clears the account', async ({ page }) => {
  await setupApp(page, { signedIn: true });
  await page.goto('/');

  await expect(page.getByTestId('timeline-empty')).toBeVisible();
  await expect(page.getByTestId('app-account')).toHaveText(DEFAULT_ACCOUNT.name);

  await page.getByTestId('signout-button').click();

  await expect(page.getByTestId('signin-button')).toBeVisible();
  await expect(page.getByTestId('signout-button')).toHaveCount(0);
});
