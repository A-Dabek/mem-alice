import { h } from 'https://esm.sh/preact@10.19.3';
import { useState } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

import { deriveKey, decryptText } from '../crypto.js';

const html = htm.bind(h);

const INCORRECT_PASSPHRASE_ERROR = 'Incorrect passphrase. Please try again.';
const SERVER_ERROR = 'Could not reach the server. Please check your connection and try again.';
const UNEXPECTED_ERROR = 'Unable to unlock right now. Please try again.';

class ServerRequestError extends Error {}

/**
 * Fetches and parses a JSON API response, keeping transport/server failures
 * separate from AES-GCM authentication failures.
 *
 * @param {string} url
 * @returns {Promise<any>}
 */
async function fetchJson(url) {
  let response;

  try {
    response = await fetch(url);
  } catch {
    throw new ServerRequestError(SERVER_ERROR);
  }

  if (!response.ok) {
    throw new ServerRequestError(SERVER_ERROR);
  }

  try {
    return await response.json();
  } catch {
    throw new ServerRequestError(SERVER_ERROR);
  }
}

/**
 * Passphrase gate.
 *
 * Fetches the (non-secret) salt, derives the AES key from the passphrase in
 * the browser, and validates it by attempting to decrypt one existing
 * milestone's title (if any milestone exists yet) - any entry works, since
 * there's no notion of "newest" beyond upload order. The passphrase itself
 * is never sent to the server - only the derived key lives in memory once
 * unlocked.
 *
 * @param {{ onUnlock: (key: CryptoKey) => void }} props
 */
export function UnlockScreen({ onUnlock }) {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!passphrase || busy) {
      return;
    }

    setBusy(true);
    setError('');

    try {
      const saltResponse = await fetchJson('/api/salt');
      if (!saltResponse || typeof saltResponse.salt !== 'string' || !saltResponse.salt) {
        throw new ServerRequestError(SERVER_ERROR);
      }

      const key = await deriveKey(passphrase, saltResponse.salt);

      const milestones = await fetchJson('/api/milestones');
      if (!Array.isArray(milestones)) {
        throw new ServerRequestError(SERVER_ERROR);
      }

      if (milestones.length > 0) {
        // Decrypting any existing milestone's title is the only way to
        // validate the passphrase - a wrong passphrase makes AES-GCM
        // authentication fail here.
        const sample = milestones[0];
        try {
          await decryptText(key, sample.title_ct, sample.title_iv);
        } catch {
          setError(INCORRECT_PASSPHRASE_ERROR);
          return;
        }
      }

      onUnlock(key);
    } catch (err) {
      setError(err instanceof ServerRequestError ? err.message : UNEXPECTED_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return html`
    <div class="unlock-screen">
      <h1>Duże kroki małej Ali</h1>
      <form onSubmit=${handleSubmit} class="unlock-form">
        <input
          type="password"
          data-testid="passphrase-input"
          placeholder="Enter passphrase"
          value=${passphrase}
          onInput=${(event) => setPassphrase(event.target.value)}
          autofocus
        />
        <button type="submit" data-testid="unlock-button" disabled=${busy}>
          ${busy ? 'Unlocking...' : 'Unlock'}
        </button>
      </form>
      ${error
        ? html`<p class="error" data-testid="unlock-error">${error}</p>`
        : null}
    </div>
  `;
}
