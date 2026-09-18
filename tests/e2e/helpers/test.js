/**
 * Per-test DB isolation for the single-invocation E2E run.
 *
 * All specs share one server and one sqlite file, so each spec calls
 * `isolateDb(test)` (from its own module scope) to register a `beforeEach` that
 * truncates the milestones table. Registering from the spec file matters:
 * a `beforeEach` registered at helper-module top level only binds to the first
 * spec that imports the helper.
 */

import { clearMilestones } from './db.js';

/**
 * @param {import('@playwright/test').TestType<{}, {}>} test
 */
export function isolateDb(test) {
  test.beforeEach(async ({ request }) => {
    await clearMilestones(request);
  });
}
