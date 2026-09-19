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

async function openEditMode(page) {
  const toggle = page.getByTestId('edit-mode-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
}

test('move/delete controls stay hidden until edit mode is toggled', async ({ page, request }) => {
  await clearMilestones(request);
  await seedMilestones(request, ITEMS);
  await setupApp(page, { items: ITEMS });
  await page.goto('/');

  await expect(page.getByTestId('milestone-title')).toHaveText(['First', 'Second', 'Third']);
  await expect(page.getByTestId('delete-button')).toHaveCount(0);
  await expect(page.getByTestId('move-up-button')).toHaveCount(0);
  await expect(page.getByTestId('move-down-button')).toHaveCount(0);

  await openEditMode(page);
  await expect(page.getByTestId('delete-button')).toHaveCount(3);
  await expect(page.getByTestId('move-up-button')).toHaveCount(3);
  await expect(page.getByTestId('move-down-button')).toHaveCount(3);
});

test('edit mode blocks media expansion and hides the load button', async ({ page, request }) => {
  await clearMilestones(request);
  await seedMilestones(request, ITEMS);
  await setupApp(page, { items: ITEMS });
  await page.goto('/');

  await page.getByTestId('milestone-item').last().scrollIntoViewIfNeeded();
  await expect(page.getByTestId('milestone-thumb')).toHaveCount(3);

  await page.getByTestId('milestone-load-button').first().click();
  await expect(page.getByTestId('milestone-photo')).toHaveCount(1);

  await openEditMode(page);
  await expect(page.getByTestId('milestone-photo')).toHaveCount(0);
  await expect(page.getByTestId('milestone-video')).toHaveCount(0);
  await expect(page.getByTestId('milestone-load-button')).toHaveCount(0);
});

test('move controls are disabled at the edges', async ({ page, request }) => {
  await clearMilestones(request);
  await seedMilestones(request, ITEMS);
  await setupApp(page, { items: ITEMS });
  await page.goto('/');

  await openEditMode(page);
  await expect(page.getByTestId('move-up-button').first()).toBeDisabled();
  await expect(page.getByTestId('move-down-button').last()).toBeDisabled();
  await expect(page.getByTestId('move-down-button').first()).toBeEnabled();
  await expect(page.getByTestId('move-up-button').last()).toBeEnabled();
});

test('cancelling a move keeps the order', async ({ page, request }) => {
  await clearMilestones(request);
  await seedMilestones(request, ITEMS);
  await setupApp(page, { items: ITEMS });
  await page.goto('/');

  await openEditMode(page);
  await page.getByTestId('move-down-button').first().click();

  const dialog = page.getByTestId('move-confirm-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Przenieść ten kamień milowy niżej?');

  await page.getByTestId('move-cancel').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('milestone-title')).toHaveText(['First', 'Second', 'Third']);
});

test('Escape dismisses the move confirmation', async ({ page, request }) => {
  await clearMilestones(request);
  await seedMilestones(request, ITEMS);
  await setupApp(page, { items: ITEMS });
  await page.goto('/');

  await openEditMode(page);
  await page.getByTestId('move-up-button').nth(1).click();

  const dialog = page.getByTestId('move-confirm-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Przenieść ten kamień milowy wyżej?');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('milestone-title')).toHaveText(['First', 'Second', 'Third']);
});

test('confirming a move reorders the wall and persists', async ({ page, request }) => {
  await clearMilestones(request);
  await seedMilestones(request, ITEMS);
  await setupApp(page, { items: ITEMS });
  await page.goto('/');

  await openEditMode(page);
  await page.getByTestId('move-down-button').first().click();
  await page.getByTestId('move-confirm').click();

  await expect(page.getByTestId('move-confirm-dialog')).toBeHidden();
  await expect(page.getByTestId('milestone-title')).toHaveText(['Second', 'First', 'Third']);

  // Re-ordered positions survive a reload.
  await page.reload();
  await expect(page.getByTestId('milestone-title')).toHaveText(['Second', 'First', 'Third']);
});
