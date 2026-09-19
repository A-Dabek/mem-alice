import { test, expect } from '@playwright/test';

import { setupApp } from './helpers/app.js';
import { makeItem } from './helpers/onedrive.js';
import { clearMilestones, seedMilestones } from './helpers/db.js';
import { isolateDb } from './helpers/test.js';

isolateDb(test);

const ITEMS = [
  makeItem({ id: 'd1', title: 'First', subtitle: 'sub one', mime: 'image/png' }),
  makeItem({ id: 'd2', title: 'Second', subtitle: 'sub two', mime: 'video/mp4' }),
  makeItem({ id: 'd3', title: 'Third', subtitle: 'sub three', mime: 'image/jpeg' }),
];

test('deleting a milestone with confirmation removes it from the wall', async ({
  page,
  request,
}) => {
  await clearMilestones(request);
  await seedMilestones(request, ITEMS);
  await setupApp(page, { items: ITEMS });
  await page.goto('/');

  await expect(page.getByTestId('timeline-wall')).toBeVisible();
  await expect(page.getByTestId('milestone-thumb')).toHaveCount(3);
  await page.getByTestId('edit-mode-toggle').click();
  await expect(page.getByTestId('delete-button')).toHaveCount(3);

  // Cancel keeps everything.
  await page.getByTestId('delete-button').first().click();
  await expect(page.getByTestId('delete-confirm-dialog')).toBeVisible();
  await expect(page.getByTestId('delete-confirm-dialog')).toContainText(
    'Czy na pewno usunąć ten kamień milowy?'
  );
  await page.getByTestId('delete-cancel').click();
  await expect(page.getByTestId('delete-confirm-dialog')).toBeHidden();
  await expect(page.getByTestId('delete-button')).toHaveCount(3);

  // Confirm removes the first row.
  await page.getByTestId('delete-button').first().click();
  await page.getByTestId('delete-confirm').click();

  await expect(page.getByTestId('delete-confirm-dialog')).toBeHidden();
  await expect(page.getByTestId('delete-button')).toHaveCount(2);
  await expect(page.getByTestId('milestone-title')).toHaveText(['Second', 'Third']);
});

test('cancel via Escape dismisses the modal', async ({ page, request }) => {
  await clearMilestones(request);
  await seedMilestones(request, [ITEMS[0]]);
  await setupApp(page, { items: [ITEMS[0]] });
  await page.goto('/');

  await page.getByTestId('edit-mode-toggle').click();
  await expect(page.getByTestId('delete-button')).toHaveCount(1);
  await page.getByTestId('delete-button').first().click();
  await expect(page.getByTestId('delete-confirm-dialog')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('delete-confirm-dialog')).toBeHidden();
  await expect(page.getByTestId('delete-button')).toHaveCount(1);
});
