import { test, expect } from '@playwright/test';

import { deriveKey, encryptField } from '../../public/crypto.js';

const PASSPHRASE = 'correct horse battery staple';
// Oldest -> newest; the server assigns created_at at insert time, so this
// insertion order becomes the chronological order the Timeline sorts by.
const TITLES = ['First steps', 'Started school', 'Learned to swim', 'Graduated'];

/**
 * Dispatches a real touchstart/touchend pair on the given locator, moving
 * `deltaX` pixels horizontally - well above TimelineScreen's 50px swipe
 * threshold - to simulate a swipe without relying on mouse-drag emulation.
 */
async function swipe(locator, deltaX) {
  await locator.evaluate((el, dx) => {
    const startX = 200;
    const startY = 300;
    const start = new Touch({ identifier: 1, target: el, clientX: startX, clientY: startY });
    const end = new Touch({ identifier: 1, target: el, clientX: startX + dx, clientY: startY });

    el.dispatchEvent(
      new TouchEvent('touchstart', {
        touches: [start],
        targetTouches: [start],
        changedTouches: [start],
        bubbles: true,
      })
    );
    el.dispatchEvent(
      new TouchEvent('touchend', {
        touches: [],
        targetTouches: [],
        changedTouches: [end],
        bubbles: true,
      })
    );
  }, deltaX);
}

test('shows the empty state when there are no milestones yet', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('passphrase-input').fill(PASSPHRASE);
  await page.getByTestId('unlock-button').click();

  await expect(page.getByTestId('timeline-empty')).toBeVisible();
  await expect(page.getByTestId('empty-add-link')).toBeVisible();
});

test('seeds multiple milestones, swipes through them, and shows boundary indicators', async ({
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

  const container = page.getByTestId('timeline-swipe-container');

  // Newest first.
  await expect(page.getByTestId('milestone-title')).toHaveText('Graduated');
  await expect(page.getByTestId('milestone-position')).toHaveText(`1 / ${TITLES.length}`);

  // Swipe left through every older entry.
  await swipe(container, -80);
  await expect(page.getByTestId('milestone-title')).toHaveText('Learned to swim');
  await swipe(container, -80);
  await expect(page.getByTestId('milestone-title')).toHaveText('Started school');
  await swipe(container, -80);
  await expect(page.getByTestId('milestone-title')).toHaveText('First steps');
  await expect(page.getByTestId('milestone-position')).toHaveText(`${TITLES.length} / ${TITLES.length}`);

  // Swiping further left at the oldest entry is a no-op with a boundary cue.
  await swipe(container, -80);
  await expect(page.getByTestId('timeline-boundary-oldest')).toBeVisible();
  await expect(page.getByTestId('milestone-title')).toHaveText('First steps');

  // Swipe right back to the newest entry.
  await swipe(container, 80);
  await swipe(container, 80);
  await swipe(container, 80);
  await expect(page.getByTestId('milestone-title')).toHaveText('Graduated');

  // Swiping further right at the newest entry is a no-op with a boundary cue.
  await swipe(container, 80);
  await expect(page.getByTestId('timeline-boundary-newest')).toBeVisible();
  await expect(page.getByTestId('milestone-title')).toHaveText('Graduated');
});
