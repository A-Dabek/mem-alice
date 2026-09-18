import { h } from 'https://esm.sh/preact@10.19.3';
import { useState } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

import { signIn } from '../auth.js';

const html = htm.bind(h);

const SIGN_IN_ERROR = 'Nie można zalogować się. Spróbuj ponownie.';
const ERROR_MESSAGES = {
  MS_CLIENT_ID_MISSING: 'Brak konfiguracji logowania (MS_CLIENT_ID).',
  MSAL_NOT_LOADED: 'Nie można wczytać biblioteki logowania.',
  CONFIG_FETCH_FAILED: 'Nie można wczytać konfiguracji logowania.',
};

/**
 * Sign-in gate. The app is backed entirely by the user's OneDrive, so the
 * only entry point is a Microsoft sign-in.
 *
 * @param {{ onSignedIn: (account: object) => void }} props
 */
export function SignInScreen({ onSignedIn }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSignIn() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const account = await signIn();
      onSignedIn(account);
    } catch (err) {
      console.error('[signin]', err);
      setError(ERROR_MESSAGES[err?.code] || SIGN_IN_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return html`
    <div class="signin-screen">
      <h1>Małe kroki<br />małej Ali</h1>
      <button
        type="button"
        class="signin-button"
        data-testid="signin-button"
        disabled=${busy}
        onClick=${handleSignIn}
      >
        ${busy ? 'Logowanie...' : 'Zaloguj się przez Microsoft'}
      </button>
      ${error
        ? html`<p class="error" data-testid="signin-error">${error}</p>`
        : null}
    </div>
  `;
}
