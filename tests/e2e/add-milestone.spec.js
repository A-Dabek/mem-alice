import { test, expect } from '@playwright/test';

import { setupApp } from './helpers/app.js';
import { closePicker, pickFile } from './helpers/picker.js';
import { makeItem, TEST_ENDPOINT } from './helpers/onedrive.js';
import { isolateDb } from './helpers/test.js';

isolateDb(test);

const IMAGE = makeItem({ id: 'img-1', mime: 'image/png', name: 'photo.png' });
const VIDEO = makeItem({ id: 'vid-1', mime: 'video/mp4', name: 'clip.mp4' });

test('adding an image milestone previews, saves and renders a thumbnail', async ({ page }) => {
  await setupApp(page, { items: [IMAGE] });
  await page.goto('/');
  await expect(page.getByTestId('timeline-empty')).toBeVisible();

  await page.getByTestId('add-button').click();
  await page.getByTestId('picker-button').click();
  await pickFile(page, {
    id: IMAGE.id,
    driveId: IMAGE.driveId,
    '@sharePoint.endpoint': TEST_ENDPOINT,
  });

  await expect(page.getByTestId('preview-image')).toBeVisible();

  await page.getByTestId('title-input').fill('Learned to ride a bike');
  await page.getByTestId('subtitle-input').fill('No training wheels this time');
  await page.getByTestId('save-button').click();

  await expect(page.getByTestId('milestone-title')).toHaveText('Learned to ride a bike');
  await expect(page.getByTestId('milestone-thumb')).toBeVisible();
  await expect(page.getByTestId('milestone-photo')).toHaveCount(0);

  await page.getByTestId('milestone-load-button').first().click();
  await expect(page.getByTestId('milestone-photo')).toBeVisible();
  await expect(page.getByTestId('milestone-thumb')).toHaveCount(0);
});

test('adding a video milestone previews and expands to a video', async ({ page }) => {
  await setupApp(page, { items: [VIDEO] });
  await page.goto('/');
  await expect(page.getByTestId('timeline-empty')).toBeVisible();

  await page.getByTestId('add-button').click();
  await page.getByTestId('picker-button').click();
  await pickFile(page, {
    id: VIDEO.id,
    driveId: VIDEO.driveId,
    '@sharePoint.endpoint': TEST_ENDPOINT,
  });

  await expect(page.getByTestId('preview-video')).toBeVisible();

  await page.getByTestId('title-input').fill('First video milestone');
  await page.getByTestId('subtitle-input').fill('A video of the big day');
  await page.getByTestId('save-button').click();

  await expect(page.getByTestId('milestone-title')).toHaveText('First video milestone');
  await expect(page.getByTestId('milestone-thumb')).toBeVisible();
  await expect(page.getByTestId('milestone-video')).toHaveCount(0);

  await page.getByTestId('milestone-load-button').first().click();
  const video = page.getByTestId('milestone-video');
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute('controls', '');
});

test('clearing the chosen media lets the user pick again', async ({ page }) => {
  await setupApp(page, { items: [IMAGE] });
  await page.goto('/');
  await page.getByTestId('add-button').click();
  await page.getByTestId('picker-button').click();
  await pickFile(page, {
    id: IMAGE.id,
    driveId: IMAGE.driveId,
    '@sharePoint.endpoint': TEST_ENDPOINT,
  });

  await expect(page.getByTestId('preview-image')).toBeVisible();
  await page.getByTestId('clear-media').click();

  await expect(page.getByTestId('preview-image')).toHaveCount(0);
  await expect(page.getByTestId('clear-media')).toHaveCount(0);
  await expect(page.getByTestId('picker-button')).toBeVisible();
  await expect(page.getByTestId('picker-button')).toBeEnabled();
});

test('a portrait photo reserves its intrinsic aspect ratio', async ({ page }) => {
  const PORTRAIT = makeItem({
    id: 'portrait-1',
    mime: 'image/png',
    name: 'portrait.png',
    width: 900,
    height: 1200,
  });

  await setupApp(page, { items: [PORTRAIT] });
  await page.goto('/');
  await page.getByTestId('add-button').click();
  await page.getByTestId('picker-button').click();
  await pickFile(page, {
    id: PORTRAIT.id,
    driveId: PORTRAIT.driveId,
    '@sharePoint.endpoint': TEST_ENDPOINT,
  });

  await expect(page.getByTestId('preview-image')).toBeVisible();
  expect(await page.getByTestId('media-preview').getAttribute('style')).toContain(
    '900 / 1200'
  );

  await page.getByTestId('title-input').fill('Portrait milestone');
  await page.getByTestId('save-button').click();

  await expect(page.getByTestId('milestone-thumb')).toHaveAttribute(
    'style',
    /900 \/ 1200/
  );
});

test('cancelling the picker leaves the Add screen intact', async ({ page }) => {
  await setupApp(page, { items: [IMAGE] });
  await page.goto('/');
  await page.getByTestId('add-button').click();
  await page.getByTestId('picker-button').click();

  await closePicker(page);

  await expect(page.getByTestId('picker-button')).toBeEnabled();
  await expect(page.getByTestId('add-error')).toHaveCount(0);
});
