/**
 * Microsoft identity (MSAL) helpers.
 *
 * MSAL v4 is vendored from npm and served from `/vendor/msal-browser`
 * (see `index.html`'s import map); there is no CDN/global. We read the app
 * registration values from /api/config so no client id is hard-coded.
 *
 * Sign-in requests only OIDC scopes (`openid profile email`). Media access uses
 * the OneDrive audience (`OneDrive.ReadOnly`) to hand the picker a token and to
 * resolve picked items through the `@sharePoint.endpoint` the picker returns.
 */

const PICKER_SCOPES = ['OneDrive.ReadOnly'];
const OIDC_SCOPES = ['openid', 'profile', 'email'];

/**
 * Scopes used to silently obtain an ID token for our own API. Requesting only
 * OIDC scopes (`openid profile email`) with `acquireTokenSilent` fails on
 * consumer accounts with `AADSTS70000 invalid_grant`; pairing `openid` with the
 * already-consented resource scope makes the refresh succeed and still returns
 * an `id_token`.
 */
const ID_TOKEN_SCOPES = ['openid', 'profile', ...PICKER_SCOPES];

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
      // Dynamic import keeps browser-only MSAL out of Node (unit tests import
      // this module transitively) until an app is actually needed.
      let PublicClientApplication;
      try {
        ({ PublicClientApplication } = await import('@azure/msal-browser'));
      } catch (error) {
        throw authError('MSAL_NOT_LOADED', 'msal-browser could not be loaded');
      }

      const { clientId, authority } = await loadConfig();
      const app = new PublicClientApplication({
        auth: {
          clientId,
          authority,
          redirectUri: window.location.origin,
        },
        cache: { cacheLocation: 'sessionStorage' },
      });

      if (typeof app.initialize === 'function') {
        await app.initialize();
      }

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
 * Interactive sign-in requesting OIDC scopes only.
 *
 * @returns {Promise<import('msal').AccountInfo>}
 */
export async function signIn() {
  const app = await getMsalApp();
  const response = await app.loginPopup({
    scopes: OIDC_SCOPES,
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
 * `OneDrive.ReadOnly` targets a different resource than the OIDC scopes used
 * for sign-in, so personal (MSA) accounts may require an interactive consent
 * once. This MUST be called before opening the picker, otherwise the
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

/**
 * Signs the current account out: clears the MSAL token cache via a logout
 * popup (called from a click, so the popup has a gesture) and drops the active
 * account. Resolution-cache clearing is coordinated by the caller so this
 * module stays free of the cache dependency.
 *
 * @returns {Promise<void>}
 */
export async function signOut() {
  const app = await getMsalApp();
  const account = app.getActiveAccount() || app.getAllAccounts()[0] || null;
  await app.logoutPopup({ account: account || undefined });
  app.setActiveAccount(null);
}

/**
 * Returns an ID token for the signed-in account to authenticate against our own
 * API. Silent-only: API calls have no guaranteed user gesture, so a missing
 * token surfaces as an error the caller can turn into a re-auth affordance.
 *
 * @returns {Promise<string>}
 */
export async function getIdToken() {
  const app = await getMsalApp();
  const account = app.getActiveAccount() || (await getAccount());
  const response = await app.acquireTokenSilent({
    scopes: ID_TOKEN_SCOPES,
    account,
  });
  if (!response.idToken) {
    throw authError(
      'ID_TOKEN_MISSING',
      'No id_token returned for the signed-in account'
    );
  }
  return response.idToken;
}

/**
 * `fetch` wrapper that attaches `Authorization: Bearer <id_token>`.
 *
 * Token acquisition is best-effort: this helper exists only to authenticate
 * against our own API. If no ID token is available the request still goes out
 * unauthenticated so the API layer (not the transport) decides how to react.
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
export async function fetchWithAuth(url, options = {}) {
  const headers = new Headers(options.headers || {});
  try {
    const token = await getIdToken();
    headers.set('Authorization', `Bearer ${token}`);
  } catch (error) {
    console.warn('[auth] id token unavailable', error);
  }
  return fetch(url, { ...options, headers });
}
