import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_IMAGE = path.join(__dirname, 'fixtures', 'sample.png');
const FIXTURE_VIDEO = path.join(__dirname, 'fixtures', 'sample-small.mp4');
const PASSPHRASE = 'correct horse battery staple';

test('adding an image milestone shows it decrypted in the Timeline immediately', async ({ page }) => {
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
  await page.getByTestId('title-input').fill('Learned to ride a bike');
  await page.getByTestId('subtitle-input').fill('No training wheels this time');
  await page.getByTestId('save-button').click();

  // Saving switches back to the Timeline (the `#add` route), which should
  // immediately show the freshly decrypted milestone (client-side
  // decryption round-trip).
  await expect(page.getByTestId('milestone-title')).toHaveText('Learned to ride a bike');
  await expect(page.getByTestId('milestone-subtitle')).toHaveText('No training wheels this time');
  await expect(page.getByTestId('milestone-photo')).toBeVisible();
});

test('adding a video milestone shows it decrypted as a video element', async ({ page }) => {
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
  await page.getByTestId('title-input').fill('First video milestone');
  await page.getByTestId('subtitle-input').fill('A video of the big day');
  await page.getByTestId('save-button').click();

  await expect(page.getByTestId('milestone-title').last()).toHaveText('First video milestone');
  await expect(page.getByTestId('milestone-subtitle').last()).toHaveText('A video of the big day');
  await expect(page.getByTestId('milestone-video')).toBeVisible();
  const video = page.getByTestId('milestone-video').last();
  await expect(video).toHaveAttribute('controls', '');
});
