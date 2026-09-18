/**
 * Composes the E2E stubs. Call before `page.goto('/')`.
 */

import { stubAuth } from './auth.js';
import { installPicker } from './picker.js';
import { stubOneDrive } from './onedrive.js';

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ items?: object[], signedIn?: boolean }} [options]
 */
export async function setupApp(page, { items = [], signedIn = true } = {}) {
  await stubAuth(page, { signedIn });
  await installPicker(page);
  await stubOneDrive(page, items);
}
