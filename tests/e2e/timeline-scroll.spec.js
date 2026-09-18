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

  // Lazily-resolved thumbnails, no full media until clicked. The media boxes
  // are reserved, so rows below the fold only resolve once scrolled into view.
  await page.getByTestId('milestone-item').last().scrollIntoViewIfNeeded();
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

test('expanding keeps the thumbnail visible until the full photo loads', async ({
  page,
  request,
}) => {
  await clearMilestones(request);
  const item = makeItem({ id: 'swap-1', title: 'Swap', mime: 'image/png' });
  await seedMilestones(request, [item]);
  await setupApp(page, { items: [item] });

  // Delay only the full-resolution download (the thumbnail URL carries
  // `?thumb=1`) so the swap is observable.
  await page.route('**/media.example/swap-1', async (route) => {
    if (!route.request().url().includes('thumb=1')) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return route.continue();
  });

  await page.goto('/');
  await expect(page.getByTestId('milestone-thumb')).toBeVisible();
  await page.getByTestId('milestone-load-button').first().click();

  const photo = page.getByTestId('milestone-photo');
  await expect(photo).toBeVisible();
  // Thumbnail is shown immediately, no blank white box.
  await expect(photo).toHaveAttribute('src', /thumb=1/);
  // Then the full-resolution image swaps in seamlessly.
  await expect(photo).toHaveAttribute('src', 'https://media.example/swap-1');
});
