/**
 * Microsoft identity (MSAL) helpers.
 *
 * The MSAL browser library is loaded globally from the CDN (`window.msal`,
 * see index.html). We read the app registration values from /api/config so
 * no client id is hard-coded in the bundle.
 *
 * Two token audiences are needed:
 *  - Graph (`Files.Read`) only to complete the sign-in consent flow.
 *  - OneDrive (`OneDrive.ReadOnly`) to hand the picker a token and to resolve
 *    picked items through the `@sharePoint.endpoint` the picker returns.
 */

const GRAPH_SCOPES = ['Files.Read'];
const PICKER_SCOPES = ['OneDrive.ReadOnly'];

let appPromise = null;

function authError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

async function loadConfig() {
  let response;
  try {
    response = await fetch('/api/config');
  } catch {
    throw authError('CONFIG_FETCH_FAILED', 'Could not reach /api/config');
  }
  if (!response.ok) {
    throw authError('CONFIG_FETCH_FAILED', `GET /api/config returned ${response.status}`);
  }
  const { clientId, authority } = await response.json();
  if (!clientId) {
    throw authError('MS_CLIENT_ID_MISSING', 'MS_CLIENT_ID is not configured on the server');
  }
  return { clientId, authority };
}

/**
 * Lazily creates and caches the MSAL PublicClientApplication, processing any
 * pending redirect response on first use.
 *
 * The cached promise is cleared on failure so a transient/config error does
 * not permanently poison every subsequent sign-in attempt.
 *
 * @returns {Promise<import('msal').PublicClientApplication>}
 */
export function getMsalApp() {
  if (!appPromise) {
    appPromise = (async () => {
      if (!globalThis.msal?.PublicClientApplication) {
        throw authError('MSAL_NOT_LOADED', 'msal-browser was not loaded');
      }

      const { clientId, authority } = await loadConfig();
      const app = new globalThis.msal.PublicClientApplication({
        auth: {
          clientId,
          authority,
          redirectUri: window.location.origin,
        },
        cache: { cacheLocation: 'sessionStorage' },
      });

      // A stale/failed redirect interaction must not block popup sign-in.
      try {
        await app.handleRedirectPromise();
      } catch (error) {
        console.warn('[auth] handleRedirectPromise failed', error);
      }

      return app;
    })().catch((error) => {
      appPromise = null;
      throw error;
    });
  }
  return appPromise;
}

/**
 * Returns the signed-in account, or null.
 *
 * @returns {Promise<import('msal').AccountInfo | null>}
 */
export async function getAccount() {
  const app = await getMsalApp();
  const account = app.getActiveAccount() || app.getAllAccounts()[0] || null;
  if (account) {
    app.setActiveAccount(account);
  }
  return account;
}

/**
 * Interactive sign-in requesting Graph read + openid/profile.
 *
 * @returns {Promise<import('msal').AccountInfo>}
 */
export async function signIn() {
  const app = await getMsalApp();
  const response = await app.loginPopup({
    scopes: ['openid', 'profile', ...GRAPH_SCOPES],
  });
  app.setActiveAccount(response.account);
  return response.account;
}

/**
 * Acquires a token for the given scopes, silently when possible and via an
 * interactive popup otherwise (consent / expired refresh token).
 *
 * @param {string[]} scopes
 * @returns {Promise<string>}
 */
async function acquireScopes(scopes) {
  const app = await getMsalApp();
  const account = app.getActiveAccount() || (await getAccount());

  try {
    const response = await app.acquireTokenSilent({ scopes, account });
    return response.accessToken;
  } catch (error) {
    const response = account
      ? await app.acquireTokenPopup({ scopes, account })
      : await app.loginPopup({ scopes });
    if (response.account) {
      app.setActiveAccount(response.account);
    }
    return response.accessToken;
  }
}

/**
 * Acquires a token for the OneDrive picker and item resolution.
 *
 * `OneDrive.ReadOnly` targets a different resource than the Graph token used
 * for sign-in, so personal (MSA) accounts may require an interactive consent
 * once. This MUST be called before opening the picker window, otherwise the
 * consent popup would be the second popup and get blocked.
 *
 * @returns {Promise<string>}
 */
export function getPickerToken() {
  return acquireScopes(PICKER_SCOPES);
}

/**
 * Silent-only variant of {@link getPickerToken}, safe to call from inside the
 * picker message flow (no user gesture, popups blocked).
 *
 * @returns {Promise<string>}
 */
export async function trySilentPickerToken() {
  const app = await getMsalApp();
  const account = app.getActiveAccount() || (await getAccount());
  const response = await app.acquireTokenSilent({ scopes: PICKER_SCOPES, account });
  return response.accessToken;
}
