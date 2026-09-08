import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_IMAGE = path.join(__dirname, 'fixtures', 'sample.png');
const FIXTURE_VIDEO = path.join(__dirname, 'fixtures', 'sample-small.mp4');
const PASSPHRASE = 'correct horse battery staple';

test('adding an image milestone shows thumbnail first, full photo after click', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('passphrase-input').fill(PASSPHRASE);
  await page.getByTestId('unlock-button').click();
  await expect(page.getByTestId('timeline-empty')).toBeVisible();

  await page.getByTestId('add-button').click();
  // Accept either old photo-input or new media-input for backwards compat
  const mediaInput = page.getByTestId('media-input').or(page.getByTestId('photo-input')).first();
  await expect(mediaInput).toBeVisible();

  // Prefer media-input but fallback to photo-input alias
  const inputToUse = (await page.getByTestId('media-input').count()) > 0 ? page.getByTestId('media-input') : page.getByTestId('photo-input');
  await inputToUse.setInputFiles(FIXTURE_IMAGE);
  // Wait for thumbnail generation (best-effort) — if it appears, ensure it's visible before saving
  // Not strictly required for image, but ensures thumb is included
  const thumbPreview = page.getByTestId('thumb-preview');
  // thumb-preview may appear after async generation; wait briefly but don't fail if not
  await thumbPreview.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  await page.getByTestId('title-input').fill('Learned to ride a bike');
  await page.getByTestId('subtitle-input').fill('No training wheels this time');
  await page.getByTestId('save-button').click();

  // Saving switches back to the Timeline — should show thumbnail (click-to-load) not full media yet
  await expect(page.getByTestId('milestone-title')).toHaveText('Learned to ride a bike');
  await expect(page.getByTestId('milestone-subtitle')).toHaveText('No training wheels this time');
  await expect(page.getByTestId('milestone-thumb')).toBeVisible();
  await expect(page.getByTestId('milestone-photo')).toHaveCount(0);
  await expect(page.getByTestId('milestone-video')).toHaveCount(0);
  await expect(page.getByTestId('milestone-load-button')).toBeVisible();

  // Click thumb or button to load full media
  await page.getByTestId('milestone-load-button').first().click();
  await expect(page.getByTestId('milestone-photo')).toBeVisible();
  // Thumbnail should be replaced inline
  await expect(page.getByTestId('milestone-thumb')).toHaveCount(0);
});

test('adding a video milestone shows thumbnail first, video after click', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('passphrase-input').fill(PASSPHRASE);
  await page.getByTestId('unlock-button').click();
  // When run together with the image test the DB is shared (per-file isolation),
  // so do not assert empty — just ensure we can add.
  await expect(page.getByTestId('add-button')).toBeVisible();

  await page.getByTestId('add-button').click();
  const mediaInput = page.getByTestId('media-input').or(page.getByTestId('photo-input')).first();
  await expect(mediaInput).toBeVisible();

  const inputToUse = (await page.getByTestId('media-input').count()) > 0 ? page.getByTestId('media-input') : page.getByTestId('photo-input');
  await inputToUse.setInputFiles(FIXTURE_VIDEO);
  // Wait for video thumbnail generation (can take ~1s due to seek)
  const thumbPreview = page.getByTestId('thumb-preview');
  await thumbPreview.waitFor({ state: 'visible', timeout: 7000 }).catch(() => {});
  await page.getByTestId('title-input').fill('First video milestone');
  await page.getByTestId('subtitle-input').fill('A video of the big day');
  await page.getByTestId('save-button').click();

  await expect(page.getByTestId('milestone-title').last()).toHaveText('First video milestone');
  await expect(page.getByTestId('milestone-subtitle').last()).toHaveText('A video of the big day');
  // There should be at least the new video thumb plus possibly previous image thumb
  // Initial state: thumbnails only, no full media for the newly added item.
  // Check that the last item has a thumb and load button
  const thumbs = page.getByTestId('milestone-thumb');
  const count = await thumbs.count();
  expect(count).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId('milestone-load-button').last()).toBeVisible();
  // Video not yet loaded
  await expect(page.getByTestId('milestone-video')).toHaveCount(0);

  // Click load for the video milestone (last button)
  await page.getByTestId('milestone-load-button').last().click();
  const video = page.getByTestId('milestone-video').last();
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute('controls', '');
});
