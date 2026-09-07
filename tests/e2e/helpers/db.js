/**
 * Clears milestones table via test-only DELETE /api/milestones.
 * Call in test.beforeEach for per-test isolation when running
 * `pnpm e2e` (single worker, shared DB). `pnpm test:e2e` already
 * isolates per file via mkdtempSync, but per-test clearing makes
 * both modes safe.
 * @param {import('@playwright/test').APIRequestContext} request
 */
export async function clearMilestones(request) {
  const res = await request.delete('/api/milestones');
  if (!res.ok() && res.status() !== 404) {
    throw new Error(`clearMilestones failed: ${res.status()}`);
  }
}
