import { test, expect } from '@playwright/test';

import { setupApp } from './helpers/app.js';
import { makeItem } from './helpers/onedrive.js';
import { clearMilestones, seedMilestones } from './helpers/db.js';
import { isolateDb } from './helpers/test.js';

isolateDb(test);

test('home -> add, and the browser back button returns home', async ({ page }) => {
  await setupApp(page);
  await page.goto('/');
  await expect(page.getByTestId('home-add')).toBeVisible();

  await page.getByTestId('home-add').click();
  await expect(page.getByTestId('picker-button')).toBeVisible();
  await expect(page.getByTestId('header-home')).toBeVisible();
  expect(page.url()).toContain('#add');

  await page.goBack();

  await expect(page.getByTestId('home-add')).toBeVisible();
  expect(page.url()).not.toContain('#add');
});

test('home -> timeline, and the read-only timeline hides add/edit/logout', async ({ page }) => {
  await setupApp(page);
  await page.goto('/');
  await expect(page.getByTestId('home-timeline')).toBeVisible();

  await page.getByTestId('home-timeline').click();
  await expect(page.getByTestId('timeline-empty')).toBeVisible();
  expect(page.url()).toContain('#timeline');

  await expect(page.getByTestId('add-button')).toHaveCount(0);
  await expect(page.getByTestId('delete-button')).toHaveCount(0);
  await expect(page.getByTestId('move-up-button')).toHaveCount(0);
  await expect(page.getByTestId('signout-button')).toHaveCount(0);
  await expect(page.getByTestId('app-account')).toHaveCount(0);
  await expect(page.getByTestId('header-home')).toHaveCount(0);

  await page.goBack();
  await expect(page.getByTestId('home-timeline')).toBeVisible();
});

test('home -> edit, and the browser back button returns home', async ({ page, request }) => {
  const items = [
    makeItem({ id: 'r1', title: 'First', mime: 'image/png' }),
    makeItem({ id: 'r2', title: 'Second', mime: 'image/png' }),
  ];
  await clearMilestones(request);
  await seedMilestones(request, items);
  await setupApp(page, { items });
  await page.goto('/');
  await expect(page.getByTestId('home-edit')).toBeVisible();

  await page.getByTestId('home-edit').click();
  await expect(page.getByTestId('delete-button')).toHaveCount(2);
  await expect(page.getByTestId('header-home')).toBeVisible();
  expect(page.url()).toContain('#edit');

  await page.goBack();
  await expect(page.getByTestId('home-edit')).toBeVisible();
});
