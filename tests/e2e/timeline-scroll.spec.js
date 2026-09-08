import { test, expect } from '@playwright/test';

import { deriveKey, encryptField } from '../../public/crypto.js';

const PASSPHRASE = 'correct horse battery staple';
// Oldest -> newest, in upload order. There are no dates anywhere - the
// server orders by insertion order (id ASC) - so this insertion order is
// exactly the order the Timeline should render, top to bottom.
const TITLES = ['First steps', 'Started school', 'Learned to swim', 'Graduated'];
const SUBTITLES = [
  'One wobbly step at a time',
  'A brand new backpack',
  'No more floaties',
  'Cap and gown',
];
const MIMES = ['image/png', 'video/mp4', 'image/jpeg', 'video/mp4'];

test('shows the empty state when there are no milestones yet', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('passphrase-input').fill(PASSPHRASE);
  await page.getByTestId('unlock-button').click();

  await expect(page.getByTestId('timeline-empty')).toBeVisible();
  await expect(page.getByTestId('add-button')).toBeVisible();
});

test('seeds multiple milestones and renders them as a vertical wall, oldest first', async ({
  page,
  request,
}) => {
  // Seed via the API using real client-side encryption so the UI can
  // genuinely decrypt them - avoids driving the Add screen four times just
  // to set up fixture data.
  const saltResponse = await request.get('/api/salt');
  expect(saltResponse.ok()).toBeTruthy();
  const { salt } = await saltResponse.json();
  const key = await deriveKey(PASSPHRASE, salt);

  for (let i = 0; i < TITLES.length; i++) {
    const encryptedTitle = await encryptField(key, TITLES[i]);
    const encryptedSubtitle = await encryptField(key, SUBTITLES[i]);
    const encryptedMedia = await encryptField(key, new Uint8Array([1, 2, 3, 4]));
    const encryptedThumb = await encryptField(key, new Uint8Array([1, 2, 3]));
    const response = await request.post('/api/milestones', {
      data: {
        title_ct: encryptedTitle.ciphertext,
        title_iv: encryptedTitle.iv,
        subtitle_ct: encryptedSubtitle.ciphertext,
        subtitle_iv: encryptedSubtitle.iv,
        media_ct: encryptedMedia.ciphertext,
        media_iv: encryptedMedia.iv,
        media_mime: MIMES[i],
        thumb_ct: encryptedThumb.ciphertext,
        thumb_iv: encryptedThumb.iv,
        thumb_mime: 'image/jpeg',
      },
    });
    expect(response.ok()).toBeTruthy();
  }

  await page.goto('/');
  await page.getByTestId('passphrase-input').fill(PASSPHRASE);
  await page.getByTestId('unlock-button').click();

  await expect(page.getByTestId('timeline-wall')).toBeVisible();

  const titles = page.getByTestId('milestone-title');
  await expect(titles).toHaveCount(TITLES.length);
  await expect(titles).toHaveText(TITLES);

  const subtitles = page.getByTestId('milestone-subtitle');
  await expect(subtitles).toHaveCount(SUBTITLES.length);
  await expect(subtitles).toHaveText(SUBTITLES);

  // V1 click-to-load: initially only thumbnails, no full media
  const thumbs = page.getByTestId('milestone-thumb');
  await expect(thumbs).toHaveCount(TITLES.length);
  await expect(page.getByTestId('milestone-photo')).toHaveCount(0);
  await expect(page.getByTestId('milestone-video')).toHaveCount(0);
  await expect(page.getByTestId('milestone-load-button')).toHaveCount(TITLES.length);

  // Click first thumbnail (image) to load full media
  await page.getByTestId('milestone-load-button').first().click();
  // First MIMES[0] is image/png -> should show photo
  await expect(page.getByTestId('milestone-photo')).toHaveCount(1);
  await expect(page.getByTestId('milestone-video')).toHaveCount(0);
  await expect(page.getByTestId('milestone-thumb')).toHaveCount(TITLES.length - 1);

  // Click second (now first remaining thumb is video) — should show video
  // After first load, thumbs: indices 1..3 remain, first of those is video/mp4
  await page.getByTestId('milestone-load-button').first().click();
  await expect(page.getByTestId('milestone-video')).toHaveCount(1);
  await expect(page.getByTestId('milestone-photo')).toHaveCount(1);
  await expect(page.getByTestId('milestone-thumb')).toHaveCount(TITLES.length - 2);

  // No dates are rendered anywhere on the Timeline.
  await expect(page.getByTestId('milestone-date')).toHaveCount(0);
});
