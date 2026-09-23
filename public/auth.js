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
 *
 * The ID token we send to our own API is cached twice: MSAL's silent path when
 * it returns one, and a small sessionStorage entry keyed by account so a fresh
 * silent call without an `id_token` can still fall back to the last one. This
 * module never logs token values, only presence/length/expiry metadata.
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

const ID_TOKEN_KEY_PREFIX = 'mem-alice.idtoken.';
const ID_TOKEN_EXPIRY_MARGIN_MS = 60 * 1000;
const ID_TOKEN_FALLBACK_TTL_MS = 50 * 60 * 1000;

let appPromise = null;

/**
 * Last client-side auth failure, forwarded to the server as `X-Auth-Error` /
 * `X-Auth-Stage` headers (logging only; never used for an auth decision).
 *
 * @type {{ stage: string, code: string, subError: string }}
 */
export const lastAuthDiagnostic = { stage: '', code: '', subError: '' };

function authError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

/**
 * Normalizes an unknown thrown value into the fields we log/forward. MSAL
 * errors carry `errorCode`/`subError`; our own errors carry `code`.
 *
 * @param {unknown} error
 * @returns {{ errorCode: string, subError: string, name: string, message: string }}
 */
export function describeError(error) {
  return {
    errorCode: error?.errorCode || error?.code || 'unknown',
    subError: error?.subError || error?.subErrorCode || '',
    name: error?.name || '',
    message: error?.message || '',
  };
}

/**
 * Records `lastAuthDiagnostic` and emits a structured client error log. Never
 * receives or logs a token value.
 *
 * @param {string} stage
 * @param {string} message
 * @param {unknown} [error]
 * @param {string} [code] - used when there is no error object
 */
function logAuth(stage, message, error, code) {
  const details = error ? describeError(error) : null;
  lastAuthDiagnostic.stage = stage;
  lastAuthDiagnostic.code = details ? details.errorCode : code || '';
  lastAuthDiagnostic.subError = details ? details.subError : '';
  console.error(`[auth] ${stage}: ${message}`, details || { code: code || '' });
}

/**
 * Decodes a JWT's `exp` claim (ms). Local check only; never verifies the
 * signature. Returns null for opaque/malformed tokens.
 *
 * @param {string} idToken
 * @returns {number | null}
 */
export function decodeExpiry(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * sessionStorage key for an account's persisted ID token. Returns '' when the
 * account has no stable id.
 *
 * @param {import('msal').AccountInfo | null | undefined} account
 * @returns {string}
 */
export function apiIdTokenStorageKey(account) {
  const id = account?.homeAccountId || account?.username || '';
  return id ? `${ID_TOKEN_KEY_PREFIX}${id}` : '';
}

/**
 * Persists an ID token per account. Expiry is decoded from the JWT, falling
 * back to a conservative TTL for opaque tokens. Best-effort: storage failures
 * are swallowed.
 *
 * @param {import('msal').AccountInfo | null | undefined} account
 * @param {string} idToken
 * @param {number} [now]
 */
export function rememberApiIdToken(account, idToken, now = Date.now()) {
  const key = apiIdTokenStorageKey(account);
  if (!key || !idToken) return;
  const expiresOn = decodeExpiry(idToken) ?? now + ID_TOKEN_FALLBACK_TTL_MS;
  try {
    globalThis.sessionStorage?.setItem(
      key,
      JSON.stringify({ token: idToken, expiresOn })
    );
  } catch {
    // Storage unavailable (private mode) - persistence is best-effort.
  }
}

/**
 * Reads a persisted ID token entry (not expiry-checked).
 *
 * @param {import('msal').AccountInfo | null | undefined} account
 * @returns {{ token: string, expiresOn: number | null } | null}
 */
export function readStoredApiIdToken(account) {
  const key = apiIdTokenStorageKey(account);
  if (!key) return null;
  let raw;
  try {
    raw = globalThis.sessionStorage?.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.token) return null;
    return { token: parsed.token, expiresOn: parsed.expiresOn ?? null };
  } catch {
    return null;
  }
}

/**
 * Chooses the ID token for our API: the silent result wins, else an unexpired
 * persisted token (60s margin). Returns null when neither is usable.
 *
 * @param {{ silentIdToken?: string | null, persistedToken?: { token: string, expiresOn: number | null } | null, now?: number, marginMs?: number }} [input]
 * @returns {string | null}
 */
export function selectApiIdToken({
  silentIdToken = null,
  persistedToken = null,
  now = Date.now(),
  marginMs = ID_TOKEN_EXPIRY_MARGIN_MS,
} = {}) {
  if (silentIdToken) return silentIdToken;
  if (persistedToken?.token) {
    const { expiresOn } = persistedToken;
    if (typeof expiresOn === 'number' && expiresOn > now + marginMs) {
      return persistedToken.token;
    }
  }
  return null;
}

/**
 * Removes every persisted ID token (all accounts). Called on sign-out.
 */
export function forgetApiIdTokens() {
  const storage = globalThis.sessionStorage;
  if (!storage) return;
  const keys = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key && key.startsWith(ID_TOKEN_KEY_PREFIX)) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
}

/**
 * Captures an `id_token` from an MSAL response whenever one is present.
 *
 * @param {import('msal').AccountInfo | null | undefined} account
 * @param {import('msal').AuthenticationResult | null | undefined} response
 */
function captureIdToken(account, response) {
  if (response?.idToken) {
    rememberApiIdToken(response.account || account, response.idToken);
  }
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
        logAuth('msal-init', 'msal-browser could not be loaded', error);
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
        try {
          await app.initialize();
        } catch (error) {
          logAuth('msal-init', 'initialize() failed', error);
          throw error;
        }
      }

      // A stale/failed redirect interaction must not block popup sign-in.
      try {
        await app.handleRedirectPromise();
      } catch (error) {
        logAuth('handleRedirect', 'handleRedirectPromise failed', error);
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
  let response;
  try {
    response = await app.loginPopup({
      scopes: OIDC_SCOPES,
    });
  } catch (error) {
    logAuth('signIn', 'sign-in failed', error);
    throw error;
  }
  app.setActiveAccount(response.account);
  captureIdToken(response.account, response);
  return response.account;
}

/**
 * Acquires a token for the given scopes, silently when possible and via an
 * interactive popup otherwise (consent / expired refresh token).
 *
 * @param {string[]} scopes
 * @param {string} stage - diagnostic stage label
 * @returns {Promise<string>}
 */
async function acquireScopes(scopes, stage) {
  const app = await getMsalApp();
  const account = app.getActiveAccount() || (await getAccount());

  try {
    const response = await app.acquireTokenSilent({ scopes, account });
    captureIdToken(response.account || account, response);
    return response.accessToken;
  } catch {
    let response;
    try {
      response = account
        ? await app.acquireTokenPopup({ scopes, account })
        : await app.loginPopup({ scopes });
    } catch (error) {
      logAuth(stage, 'interactive token acquisition failed', error);
      throw error;
    }
    if (response.account) {
      app.setActiveAccount(response.account);
    }
    captureIdToken(response.account || account, response);
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
  return acquireScopes(PICKER_SCOPES, 'getPickerToken');
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
  try {
    const response = await app.acquireTokenSilent({ scopes: PICKER_SCOPES, account });
    captureIdToken(response.account || account, response);
    return response.accessToken;
  } catch (error) {
    logAuth('trySilentPickerToken', 'silent picker token failed', error);
    throw error;
  }
}

/**
 * Signs the current account out: drops persisted ID tokens and clears the MSAL
 * token cache via a logout popup (called from a click, so the popup has a
 * gesture), then drops the active account. Resolution-cache clearing is
 * coordinated by the caller so this module stays free of that dependency.
 *
 * @returns {Promise<void>}
 */
export async function signOut() {
  const app = await getMsalApp();
  const account = app.getActiveAccount() || app.getAllAccounts()[0] || null;
  forgetApiIdTokens();
  await app.logoutPopup({ account: account || undefined });
  app.setActiveAccount(null);
}

/**
 * Returns an ID token for the signed-in account to authenticate against our own
 * API.
 *
 * Order: a silent `id_token` when MSAL returns one, else an unexpired persisted
 * token from a previous interactive result, else a typed `AUTH_REQUIRED`. No
 * interactive popup happens here: API calls have no guaranteed user gesture, so
 * a missing token surfaces as an error the caller turns into a re-auth
 * affordance ({@link reauthenticate}).
 *
 * @param {{ getApp?: () => Promise<import('msal').PublicClientApplication> }} [deps] - app provider seam for tests
 * @returns {Promise<string>}
 */
export async function getIdToken(deps = {}) {
  const app = await (deps.getApp || getMsalApp)();
  const account = app.getActiveAccount() || app.getAllAccounts()[0] || null;

  if (!account) {
    logAuth('getIdToken', 'no signed-in account', null, 'AUTH_REQUIRED');
    throw authError('AUTH_REQUIRED', 'No signed-in account');
  }

  let response = null;
  try {
    response = await app.acquireTokenSilent({
      scopes: ID_TOKEN_SCOPES,
      account,
    });
  } catch (error) {
    logAuth('getIdToken', 'silent id token request failed', error);
  }

  const silentIdToken = response?.idToken || null;
  if (silentIdToken) {
    rememberApiIdToken(account, silentIdToken);
    lastAuthDiagnostic.stage = 'getIdToken';
    lastAuthDiagnostic.code = 'silent';
    lastAuthDiagnostic.subError = '';
    return silentIdToken;
  }

  const persisted = readStoredApiIdToken(account);
  const token = selectApiIdToken({ silentIdToken: null, persistedToken: persisted });
  if (token) {
    lastAuthDiagnostic.stage = 'getIdToken';
    lastAuthDiagnostic.code = 'persisted';
    lastAuthDiagnostic.subError = '';
    return token;
  }

  logAuth('getIdToken', 'no id token available (silent and persisted missing)', null, 'AUTH_REQUIRED');
  throw authError('AUTH_REQUIRED', 'No ID token available for the signed-in account');
}

/**
 * Gesture-safe interactive re-authentication requesting the ID-token scopes.
 * Captures and persists the resulting `id_token`. Call from a button click.
 *
 * @returns {Promise<string | null>}
 */
export async function reauthenticate() {
  const app = await getMsalApp();
  const account = app.getActiveAccount() || (await getAccount());

  let response;
  try {
    response = account
      ? await app.acquireTokenPopup({ scopes: ID_TOKEN_SCOPES, account })
      : await app.loginPopup({ scopes: ID_TOKEN_SCOPES });
  } catch (error) {
    logAuth('reauthenticate', 'interactive re-auth failed', error);
    throw error;
  }

  if (response.account) {
    app.setActiveAccount(response.account);
  }
  captureIdToken(response.account || account, response);
  return response.idToken || null;
}

/**
 * `fetch` wrapper that attaches `Authorization: Bearer <id_token>`.
 *
 * A missing ID token is never degraded silently: the request is forwarded
 * without `Authorization` but with the client diagnostic in `X-Auth-Error` /
 * `X-Auth-Stage` headers (so the server's "missing token" warn carries the
 * client reason), then a typed `AUTH_REQUIRED` is thrown so the UI can show a
 * re-auth affordance.
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {{ getIdToken?: () => Promise<string> }} [deps] - token provider seam for tests
 * @returns {Promise<Response>}
 */
export async function fetchWithAuth(url, options = {}, deps = {}) {
  const getToken = deps.getIdToken || getIdToken;
  const headers = new Headers(options.headers || {});
  let token;
  try {
    // Reset so a stale diagnostic cannot leak onto this request; getIdToken
    // repopulates it on failure.
    lastAuthDiagnostic.stage = '';
    lastAuthDiagnostic.code = '';
    lastAuthDiagnostic.subError = '';
    token = await getToken();
  } catch (error) {
    const code = lastAuthDiagnostic.code || error?.code || 'AUTH_REQUIRED';
    const stage = lastAuthDiagnostic.stage || 'getIdToken';
    headers.set('X-Auth-Error', code);
    headers.set('X-Auth-Stage', stage);
    console.error('[auth] fetchWithAuth: forwarding unauthenticated request', { code, stage });
    try {
      // Best-effort: the forwarded request exists only so the server can log
      // the client reason. Its own failure must not mask AUTH_REQUIRED.
      await fetch(url, { ...options, headers });
    } catch {
      // ignore - the typed error below is what the caller needs
    }
    throw authError('AUTH_REQUIRED', 'Re-authentication required');
  }
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...options, headers });
}
