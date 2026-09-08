import { h } from 'https://esm.sh/preact@10.19.3';
import { useState } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

import { deriveKey, decryptText, encryptField } from '../crypto.js';

const html = htm.bind(h);

const ACCESS_DENIED_ERROR = 'Nieprawidłowe hasło';
const SERVER_ERROR = 'Nie można połączyć się z serwerem. Sprawdź połączenie i spróbuj ponownie.';
const UNEXPECTED_ERROR = 'Nie można teraz odblokować. Spróbuj ponownie.';

const VERIFIER_TEXT = 'mem-alice-verifier-v1';

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
 * Fetches verifier ciphertext if set, otherwise returns null (404 = not set).
 * @returns {Promise<{verifier_ct:string,verifier_iv:string}|null>}
 */
async function fetchVerifier() {
  let response;
  try {
    response = await fetch('/api/verifier');
  } catch {
    throw new ServerRequestError(SERVER_ERROR);
  }

  if (response.status === 404) {
    return null;
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
 * Creates the verifier ciphertext for the given key. 409 (already set) is
 * not treated as an error - concurrent first unlocks may race.
 * @param {CryptoKey} key
 */
async function createVerifier(key) {
  const { ciphertext, iv } = await encryptField(key, VERIFIER_TEXT);
  let response;
  try {
    response = await fetch('/api/verifier', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verifier_ct: ciphertext, verifier_iv: iv }),
    });
  } catch {
    throw new ServerRequestError(SERVER_ERROR);
  }

  if (response.ok || response.status === 409) {
    return;
  }

  throw new ServerRequestError(SERVER_ERROR);
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

      // If verifier exists, it is the sole guard - validate via sentinel decrypt.
      // This blocks wrong passwords even when DB has no milestones, and avoids
      // leaking Timeline's "Could not decrypt" fallback.
      const verifier = await fetchVerifier();
      if (verifier && typeof verifier.verifier_ct === 'string' && typeof verifier.verifier_iv === 'string') {
        try {
          const text = await decryptText(key, verifier.verifier_ct, verifier.verifier_iv);
          if (text !== VERIFIER_TEXT) {
            throw new Error('verifier mismatch');
          }
        } catch {
          setError(ACCESS_DENIED_ERROR);
          setPassphrase('');
          return;
        }

        onUnlock(key);
        return;
      }

      const milestones = await fetchJson('/api/milestones');
      if (!Array.isArray(milestones)) {
        throw new ServerRequestError(SERVER_ERROR);
      }

      if (milestones.length > 0) {
        // Legacy path: no verifier yet but milestones exist. Validate via
        // any milestone's title - wrong passphrase makes AES-GCM auth fail.
        const sample = milestones[0];
        try {
          await decryptText(key, sample.title_ct, sample.title_iv);
        } catch {
          setError(ACCESS_DENIED_ERROR);
          setPassphrase('');
          return;
        }

        // Upgrade: create verifier for future empty-DB checks.
        try {
          await createVerifier(key);
        } catch {
          // ignore - fetchVerifier will guard next login; 409 is ok
        }

        onUnlock(key);
        return;
      }

      // Empty DB, no verifier: first password sets guard in stone.
      try {
        await createVerifier(key);
      } catch {
        // ignore - if verifier creation fails due to race, next login will still guard
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
      <h1>Małe kroki<br />małej Ali</h1>
      <form onSubmit=${handleSubmit} class="unlock-form">
        <input
          type="password"
          data-testid="passphrase-input"
          placeholder="Wpisz hasło"
          value=${passphrase}
          onInput=${(event) => setPassphrase(event.target.value)}
          autofocus
        />
        <button type="submit" data-testid="unlock-button" disabled=${busy}>
          ${busy ? 'Odblokowywanie...' : 'Odblokuj'}
        </button>
        ${error
          ? html`<p class="error" data-testid="unlock-error">${error}</p>`
          : null}
      </form>
    </div>
  `;
}
