/**
 * Composes the E2E stubs. Call before `page.goto('/')`.
 */

import { stubAuth } from './auth.js';
import { installPicker } from './picker.js';
import { stubOneDrive } from './onedrive.js';

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ items?: object[], signedIn?: boolean, silentIdToken?: string, popupIdToken?: string }} [options]
 */
export async function setupApp(
  page,
  { items = [], signedIn = true, silentIdToken, popupIdToken } = {}
) {
  await stubAuth(page, { signedIn, silentIdToken, popupIdToken });
  await installPicker(page);
  await stubOneDrive(page, items);
}
