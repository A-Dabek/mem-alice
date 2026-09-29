import { test, expect } from '@playwright/test';

import { setupApp } from './helpers/app.js';
import { makeItem } from './helpers/onedrive.js';
import { clearMilestones, seedMilestones } from './helpers/db.js';
import { isolateDb } from './helpers/test.js';

isolateDb(test);

const ITEMS = [
  makeItem({ id: 'mv1', title: 'First', mime: 'image/png' }),
  makeItem({ id: 'mv2', title: 'Second', mime: 'image/png' }),
  makeItem({ id: 'mv3', title: 'Third', mime: 'image/png' }),
];

async function seedAndOpenEdit(page, request, items = ITEMS) {
  await clearMilestones(request);
  await seedMilestones(request, items);
  await setupApp(page, { items });
  await page.goto('/');
  await page.getByTestId('home-edit').click();
}

test('the edit route shows delete/move controls immediately', async ({ page, request }) => {
  await seedAndOpenEdit(page, request);

  await expect(page.getByTestId('milestone-title')).toHaveText(['First', 'Second', 'Third']);
  await expect(page.getByTestId('delete-button')).toHaveCount(3);
  await expect(page.getByTestId('move-up-button')).toHaveCount(3);
  await expect(page.getByTestId('move-down-button')).toHaveCount(3);
});

test('the edit route blocks media expansion and hides the load button', async ({
  page,
  request,
}) => {
  await seedAndOpenEdit(page, request);

  await page.getByTestId('milestone-item').last().scrollIntoViewIfNeeded();
  await expect(page.getByTestId('milestone-thumb')).toHaveCount(3);
  await expect(page.getByTestId('milestone-load-button')).toHaveCount(0);
  await expect(page.getByTestId('milestone-photo')).toHaveCount(0);
  await expect(page.getByTestId('milestone-video')).toHaveCount(0);
});

test('move controls are disabled at the edges', async ({ page, request }) => {
  await seedAndOpenEdit(page, request);

  await expect(page.getByTestId('move-up-button').first()).toBeDisabled();
  await expect(page.getByTestId('move-down-button').last()).toBeDisabled();
  await expect(page.getByTestId('move-down-button').first()).toBeEnabled();
  await expect(page.getByTestId('move-up-button').last()).toBeEnabled();
});

test('cancelling a move keeps the order', async ({ page, request }) => {
  await seedAndOpenEdit(page, request);

  await page.getByTestId('move-down-button').first().click();

  const dialog = page.getByTestId('move-confirm-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Przenieść ten kamień milowy niżej?');

  await page.getByTestId('move-cancel').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('milestone-title')).toHaveText(['First', 'Second', 'Third']);
});

test('Escape dismisses the move confirmation', async ({ page, request }) => {
  await seedAndOpenEdit(page, request);

  await page.getByTestId('move-up-button').nth(1).click();

  const dialog = page.getByTestId('move-confirm-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Przenieść ten kamień milowy wyżej?');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('milestone-title')).toHaveText(['First', 'Second', 'Third']);
});

test('confirming a move reorders the wall and persists', async ({ page, request }) => {
  await seedAndOpenEdit(page, request);

  await page.getByTestId('move-down-button').first().click();
  await page.getByTestId('move-confirm').click();

  await expect(page.getByTestId('move-confirm-dialog')).toBeHidden();
  await expect(page.getByTestId('milestone-title')).toHaveText(['Second', 'First', 'Third']);

  // Re-ordered positions survive a reload.
  await page.reload();
  await expect(page.getByTestId('milestone-title')).toHaveText(['Second', 'First', 'Third']);
});
