/**
 * E2E auth stub.
 *
 * The app imports MSAL v4 from `/vendor/msal-browser/index.mjs` (see the import
 * map in `index.html`). E2E replaces that module with an in-page fake so tests
 * never touch Microsoft or need a real account. `/api/config` is stubbed too so
 * no MS_CLIENT_ID is needed on the server (which runs with AUTH_DISABLED=1).
 */

export const DEFAULT_ACCOUNT = {
  name: 'E2E User',
  username: 'e2e@example.com',
  homeAccountId: 'e2e-home',
  localAccountId: 'e2e-local',
  environment: 'login.microsoftonline.com',
  tenantId: 'consumers',
};

/**
 * Builds a syntactically valid (unsigned) JWT so the client can decode `exp`.
 * The E2E server runs with AUTH_DISABLED=1, so it is never verified.
 *
 * @param {number} [expiresInSeconds]
 * @returns {string}
 */
export function fakeIdToken(expiresInSeconds = 3600) {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expiresInSeconds })
  ).toString('base64url');
  return `e2e.${payload}.sig`;
}

function stubModuleSource(signedIn, account, { silentIdToken, popupIdToken }) {
  return `
const account = ${JSON.stringify(account)};
let accounts = ${signedIn} ? [account] : [];
const silentIdToken = ${JSON.stringify(silentIdToken)};
const popupIdToken = ${JSON.stringify(popupIdToken)};

const result = (idToken) => ({
  account: accounts[0] || account,
  idToken,
  accessToken: 'e2e-access-token',
});

export class PublicClientApplication {
  async initialize() {}
  handleRedirectPromise() {
    return Promise.resolve(null);
  }
  getActiveAccount() {
    return accounts[0] || null;
  }
  getAllAccounts() {
    return [...accounts];
  }
  setActiveAccount(next) {
    accounts = next ? [next] : [];
  }
  loginPopup() {
    accounts = [account];
    return Promise.resolve(result(popupIdToken));
  }
  acquireTokenSilent() {
    if (accounts.length === 0) {
      const error = new Error('interaction_required');
      error.name = 'InteractionRequiredAuthError';
      return Promise.reject(error);
    }
    return Promise.resolve(result(silentIdToken));
  }
  acquireTokenPopup() {
    return Promise.resolve(result(popupIdToken));
  }
  logoutPopup() {
    accounts = [];
    return Promise.resolve();
  }
}
`;
}

/**
 * Installs the MSAL + config stubs before any page script runs.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ signedIn?: boolean, account?: object, silentIdToken?: string, popupIdToken?: string }} [options]
 */
export async function stubAuth(
  page,
  {
    signedIn = true,
    account = DEFAULT_ACCOUNT,
    silentIdToken = fakeIdToken(),
    popupIdToken = fakeIdToken(),
  } = {}
) {
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: {
        clientId: 'e2e-client-id',
        authority: 'https://login.microsoftonline.com/consumers',
      },
    })
  );

  await page.route('**/vendor/msal-browser/index.mjs', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: stubModuleSource(signedIn, account, { silentIdToken, popupIdToken }),
    })
  );
}
