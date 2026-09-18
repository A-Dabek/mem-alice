import { test, expect } from '@playwright/test';

import { setupApp } from './helpers/app.js';
import { isolateDb } from './helpers/test.js';

isolateDb(test);

test('Add is a distinct route and the browser back button returns to the Timeline', async ({
  page,
}) => {
  await setupApp(page);
  await page.goto('/');
  await expect(page.getByTestId('timeline-empty')).toBeVisible();

  await page.getByTestId('add-button').click();
  await expect(page.getByTestId('picker-button')).toBeVisible();
  expect(page.url()).toContain('#add');

  await page.goBack();

  await expect(page.getByTestId('timeline-empty')).toBeVisible();
  expect(page.url()).not.toContain('#add');
});
