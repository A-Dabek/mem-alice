import { test, expect } from '@playwright/test';

import { setupApp } from './helpers/app.js';
import { makeItem } from './helpers/onedrive.js';
import { clearMilestones, seedMilestones } from './helpers/db.js';
import { isolateDb } from './helpers/test.js';

isolateDb(test);

const ITEMS = [
  makeItem({ id: 'e1', title: 'First', subtitle: 'sub one', mime: 'image/png' }),
  makeItem({ id: 'e2', title: 'Second', subtitle: 'sub two', mime: 'video/mp4' }),
  makeItem({ id: 'e3', title: 'Third', subtitle: 'sub three', mime: 'image/jpeg' }),
];

async function seedAndOpenEdit(page, request, items = ITEMS) {
  await clearMilestones(request);
  await seedMilestones(request, items);
  await setupApp(page, { items });
  await page.goto('/');
  await page.getByTestId('home-edit').click();
}

test('the edit route shows an edit button per row; the timeline shows none', async ({
  page,
  request,
}) => {
  await seedAndOpenEdit(page, request);

  await expect(page.getByTestId('milestone-title')).toHaveText(['First', 'Second', 'Third']);
  await expect(page.getByTestId('edit-button')).toHaveCount(3);

  await page.getByTestId('header-home').click();
  await page.getByTestId('home-timeline').click();
  await expect(page.getByTestId('milestone-title')).toHaveText(['First', 'Second', 'Third']);
  await expect(page.getByTestId('edit-button')).toHaveCount(0);
});

test('cancelling an edit discards the changes', async ({ page, request }) => {
  await seedAndOpenEdit(page, request);

  await page.getByTestId('edit-button').first().click();
  await expect(page.getByTestId('edit-title-input')).toBeVisible();

  await page.getByTestId('edit-title-input').fill('Zmieniony');
  await page.getByTestId('edit-cancel-button').click();

  await expect(page.getByTestId('edit-title-input')).toHaveCount(0);
  await expect(page.getByTestId('milestone-title')).toHaveText(['First', 'Second', 'Third']);
});

test('Escape cancels an in-progress edit', async ({ page, request }) => {
  await seedAndOpenEdit(page, request);

  await page.getByTestId('edit-button').first().click();
  await page.getByTestId('edit-title-input').fill('Zmieniony');

  await page.keyboard.press('Escape');

  await expect(page.getByTestId('edit-title-input')).toHaveCount(0);
  await expect(page.getByTestId('milestone-title')).toHaveText(['First', 'Second', 'Third']);
});

test('saving updates title and subtitle in place and persists', async ({ page, request }) => {
  await seedAndOpenEdit(page, request);

  await page.getByTestId('edit-button').first().click();
  await page.getByTestId('edit-title-input').fill('Nowy tytuł');
  await page.getByTestId('edit-subtitle-input').fill('Nowy podtytuł');
  await page.getByTestId('edit-save-button').click();

  await expect(page.getByTestId('edit-title-input')).toHaveCount(0);
  await expect(page.getByTestId('milestone-title')).toHaveText(['Nowy tytuł', 'Second', 'Third']);
  await expect(page.getByTestId('milestone-subtitle')).toHaveText([
    'Nowy podtytuł',
    'sub two',
    'sub three',
  ]);

  await page.reload();
  await expect(page.getByTestId('milestone-title')).toHaveText(['Nowy tytuł', 'Second', 'Third']);
  await expect(page.getByTestId('milestone-subtitle')).toHaveText([
    'Nowy podtytuł',
    'sub two',
    'sub three',
  ]);
});

test('an empty title shows an inline error and does not PATCH', async ({ page, request }) => {
  await seedAndOpenEdit(page, request);

  let patchCount = 0;
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && request.url().includes('/api/milestones/')) {
      patchCount += 1;
    }
  });

  await page.getByTestId('edit-button').first().click();
  await page.getByTestId('edit-title-input').fill('   ');
  await page.getByTestId('edit-save-button').click();

  await expect(page.getByTestId('edit-error')).toHaveText('Wpisz tytuł.');
  expect(patchCount).toBe(0);
});
