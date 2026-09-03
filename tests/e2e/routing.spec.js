import { test, expect } from '@playwright/test';

const PASSPHRASE = 'correct horse battery staple';

test('Add is a distinct route, and the browser back button returns to the Timeline', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('passphrase-input').fill(PASSPHRASE);
  await page.getByTestId('unlock-button').click();
  await expect(page.getByTestId('timeline-empty')).toBeVisible();

  await page.getByTestId('add-button').click();
  await expect(page.getByTestId('photo-input')).toBeVisible();
  expect(page.url()).toContain('#add');

  await page.goBack();

  await expect(page.getByTestId('timeline-empty')).toBeVisible();
  expect(page.url()).not.toContain('#add');
});
