import { test, expect } from '@playwright/test';

import { setupApp } from './helpers/app.js';
import { makeItem } from './helpers/onedrive.js';
import { clearMilestones, seedMilestones } from './helpers/db.js';
import { isolateDb } from './helpers/test.js';

isolateDb(test);

// Oldest -> newest (server orders by id ASC; there are no dates).
const ITEMS = [
  makeItem({ id: 'm1', title: 'First steps', subtitle: 'One wobbly step at a time', mime: 'image/png' }),
  makeItem({ id: 'm2', title: 'Started school', subtitle: 'A brand new backpack', mime: 'video/mp4' }),
  makeItem({ id: 'm3', title: 'Learned to swim', subtitle: 'No more floaties', mime: 'image/jpeg' }),
  makeItem({ id: 'm4', title: 'Graduated', subtitle: 'Cap and gown', mime: 'video/mp4' }),
];

test('shows the empty state when there are no milestones yet', async ({ page }) => {
  await setupApp(page);
  await page.goto('/');

  await expect(page.getByTestId('timeline-empty')).toBeVisible();
  await expect(page.getByTestId('add-button')).toBeVisible();
});

test('renders seeded milestones as a vertical wall, oldest first', async ({ page, request }) => {
  await clearMilestones(request);
  await seedMilestones(request, ITEMS);
  await setupApp(page, { items: ITEMS });
  await page.goto('/');

  await expect(page.getByTestId('timeline-wall')).toBeVisible();
  await expect(page.getByTestId('milestone-title')).toHaveText(ITEMS.map((i) => i.title));
  await expect(page.getByTestId('milestone-subtitle')).toHaveText(
    ITEMS.map((i) => i.subtitle)
  );

  // Lazily-resolved thumbnails, no full media until clicked.
  await expect(page.getByTestId('milestone-thumb')).toHaveCount(ITEMS.length);
  await expect(page.getByTestId('milestone-photo')).toHaveCount(0);
  await expect(page.getByTestId('milestone-video')).toHaveCount(0);
  await expect(page.getByTestId('milestone-load-button')).toHaveCount(ITEMS.length);

  // First item is an image -> expands to a photo.
  await page.getByTestId('milestone-load-button').first().click();
  await expect(page.getByTestId('milestone-photo')).toHaveCount(1);
  await expect(page.getByTestId('milestone-thumb')).toHaveCount(ITEMS.length - 1);

  // Second item is a video -> expands to a video.
  await page.getByTestId('milestone-load-button').first().click();
  await expect(page.getByTestId('milestone-video')).toHaveCount(1);

  await expect(page.getByTestId('milestone-date')).toHaveCount(0);
});
