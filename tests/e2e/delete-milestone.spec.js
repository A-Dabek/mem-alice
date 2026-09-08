import { test, expect } from '@playwright/test';

import { deriveKey, encryptField } from '../../public/crypto.js';
import { clearMilestones } from './helpers/db.js';

const PASSPHRASE = 'correct horse battery staple';

async function seedMilestones(request, titles, subtitles, mimes) {
  const saltResponse = await request.get('/api/salt');
  expect(saltResponse.ok()).toBeTruthy();
  const { salt } = await saltResponse.json();
  const key = await deriveKey(PASSPHRASE, salt);

  for (let i = 0; i < titles.length; i++) {
    const encTitle = await encryptField(key, titles[i]);
    const encSubtitle = await encryptField(key, subtitles[i]);
    const encMedia = await encryptField(key, new Uint8Array([1, 2, 3, 4]));
    const res = await request.post('/api/milestones', {
      data: {
        title_ct: encTitle.ciphertext,
        title_iv: encTitle.iv,
        subtitle_ct: encSubtitle.ciphertext,
        subtitle_iv: encSubtitle.iv,
        media_ct: encMedia.ciphertext,
        media_iv: encMedia.iv,
        media_mime: mimes[i],
      },
    });
    expect(res.ok()).toBeTruthy();
  }
}

test('deleting a milestone with confirmation removes it from the wall', async ({ page, request }) => {
  await clearMilestones(request);
  const titles = ['First', 'Second', 'Third'];
  const subtitles = ['sub one', 'sub two', 'sub three'];
  const mimes = ['image/png', 'video/mp4', 'image/jpeg'];

  await seedMilestones(request, titles, subtitles, mimes);

  await page.goto('/');
  await page.getByTestId('passphrase-input').fill(PASSPHRASE);
  await page.getByTestId('unlock-button').click();

  await expect(page.getByTestId('timeline-wall')).toBeVisible();
  await expect(page.getByTestId('delete-button')).toHaveCount(3);
  await expect(page.getByTestId('milestone-title')).toHaveText(titles);

  // First click -> modal appears; cancel keeps items
  await page.getByTestId('delete-button').first().click();
  await expect(page.getByTestId('delete-confirm-dialog')).toBeVisible();
  await expect(page.getByTestId('delete-confirm-dialog')).toContainText('Czy na pewno usunąć ten kamień milowy?');
  await expect(page.getByTestId('delete-confirm-dialog')).toContainText('Tej operacji nie można cofnąć.');
  await page.getByTestId('delete-cancel').click();
  await expect(page.getByTestId('delete-confirm-dialog')).toBeHidden();
  await expect(page.getByTestId('delete-button')).toHaveCount(3);

  // Second click -> confirm actually deletes
  await page.getByTestId('delete-button').first().click();
  await expect(page.getByTestId('delete-confirm-dialog')).toBeVisible();
  await page.getByTestId('delete-confirm').click();

  await expect(page.getByTestId('delete-confirm-dialog')).toBeHidden();
  await expect(page.getByTestId('delete-button')).toHaveCount(2);
  await expect(page.getByTestId('milestone-title')).toHaveText(['Second', 'Third']);
});

test('cancel via overlay and Escape', async ({ page, request }) => {
  await clearMilestones(request);
  await seedMilestones(request, ['Only one'], ['subtitle'], ['image/png']);

  await page.goto('/');
  await page.getByTestId('passphrase-input').fill(PASSPHRASE);
  await page.getByTestId('unlock-button').click();

  await expect(page.getByTestId('delete-button')).toHaveCount(1);

  // Overlay click dismisses
  await page.getByTestId('delete-button').first().click();
  await expect(page.getByTestId('delete-confirm-dialog')).toBeVisible();
  // Click near edge of overlay (outside modal) - dispatch click on overlay
  // Playwright click on overlay routes to modal if not careful; click at 10,10
  await page.getByTestId('delete-confirm-dialog').click({ position: { x: 10, y: 10 } });
  await expect(page.getByTestId('delete-confirm-dialog')).toBeHidden();

  // Reopen, Escape dismisses
  await page.getByTestId('delete-button').first().click();
  await expect(page.getByTestId('delete-confirm-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('delete-confirm-dialog')).toBeHidden();
  await expect(page.getByTestId('delete-button')).toHaveCount(1);
});

test('deleting video milestone revokes video element', async ({ page, request }) => {
  await clearMilestones(request);
  await seedMilestones(request, ['Video title'], ['Video sub'], ['video/mp4']);

  await page.goto('/');
  await page.getByTestId('passphrase-input').fill(PASSPHRASE);
  await page.getByTestId('unlock-button').click();

  await expect(page.getByTestId('milestone-video')).toHaveCount(1);
  await expect(page.getByTestId('delete-button')).toHaveCount(1);

  await page.getByTestId('delete-button').first().click();
  await expect(page.getByTestId('delete-confirm-dialog')).toBeVisible();
  await page.getByTestId('delete-confirm').click();

  await expect(page.getByTestId('delete-confirm-dialog')).toBeHidden();
  await expect(page.getByTestId('milestone-video')).toHaveCount(0);
  await expect(page.getByTestId('delete-button')).toHaveCount(0);
  await expect(page.getByTestId('timeline-empty')).toBeVisible();
});
