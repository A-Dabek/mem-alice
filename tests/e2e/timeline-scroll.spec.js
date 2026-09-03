import { test, expect } from '@playwright/test';

import { deriveKey, encryptField } from '../../public/crypto.js';

const PASSPHRASE = 'correct horse battery staple';
// Oldest -> newest, in upload order. There are no dates anywhere - the
// server orders by insertion order (id ASC) - so this insertion order is
// exactly the order the Timeline should render, top to bottom.
const TITLES = ['First steps', 'Started school', 'Learned to swim', 'Graduated'];

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

  for (const title of TITLES) {
    const encryptedTitle = await encryptField(key, title);
    const encryptedPhoto = await encryptField(key, new Uint8Array([1, 2, 3, 4]));
    const response = await request.post('/api/milestones', {
      data: {
        title_ct: encryptedTitle.ciphertext,
        title_iv: encryptedTitle.iv,
        photo_ct: encryptedPhoto.ciphertext,
        photo_iv: encryptedPhoto.iv,
        photo_mime: 'image/png',
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

  const photos = page.getByTestId('milestone-photo');
  await expect(photos).toHaveCount(TITLES.length);

  // No dates are rendered anywhere on the Timeline.
  await expect(page.getByTestId('milestone-date')).toHaveCount(0);
});
