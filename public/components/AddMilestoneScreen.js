import { h } from 'https://esm.sh/preact@10.19.3';
import { useState } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

import { encryptField } from '../crypto.js';

const html = htm.bind(h);

const NO_MEDIA_ERROR = 'Wybierz zdjęcie lub wideo.';
const NO_TITLE_ERROR = 'Wpisz tytuł.';
const NO_SUBTITLE_ERROR = 'Wpisz podtytuł.';
const FILE_TOO_LARGE_ERROR = 'Plik musi być mniejszy niż 100 MB.';
const SAVE_ERROR = 'Nie można zapisać kamienia milowego. Spróbuj ponownie.';

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

/**
 * Reads a `File` into raw bytes.
 *
 * @param {File} file
 * @returns {Promise<Uint8Array>}
 */
async function readFileBytes(file) {
  const buffer = await file.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Add Milestone screen.
 *
 * Lets the user pick/take a photo or video and type a title and subtitle,
 * encrypts all fields client-side with the in-memory AES key (the server
 * never sees plaintext), and POSTs only ciphertext + mime type to
 * /api/milestones. On success, returns to the Timeline route so the new
 * entry is immediately visible.
 *
 * @param {{ cryptoKey: CryptoKey, onSaved: () => void }} props
 */
export function AddMilestoneScreen({ cryptoKey, onSaved }) {
  const [mediaFile, setMediaFile] = useState(null);
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function handleMediaChange(event) {
    const file = event.target.files && event.target.files[0];
    if (file && file.size > MAX_FILE_SIZE_BYTES) {
      setError(FILE_TOO_LARGE_ERROR);
      setMediaFile(null);
      // reset input value so same file can be re-selected after error
      event.target.value = '';
      return;
    }
    setError('');
    setMediaFile(file || null);
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (busy) {
      return;
    }

    if (!mediaFile) {
      setError(NO_MEDIA_ERROR);
      return;
    }

    if (mediaFile.size > MAX_FILE_SIZE_BYTES) {
      setError(FILE_TOO_LARGE_ERROR);
      return;
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError(NO_TITLE_ERROR);
      return;
    }

    const trimmedSubtitle = subtitle.trim();
    if (!trimmedSubtitle) {
      setError(NO_SUBTITLE_ERROR);
      return;
    }

    setBusy(true);
    setError('');

    try {
      const mediaBytes = await readFileBytes(mediaFile);

      const [encryptedTitle, encryptedSubtitle, encryptedMedia] = await Promise.all([
        encryptField(cryptoKey, trimmedTitle),
        encryptField(cryptoKey, trimmedSubtitle),
        encryptField(cryptoKey, mediaBytes),
      ]);

      const response = await fetch('/api/milestones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title_ct: encryptedTitle.ciphertext,
          title_iv: encryptedTitle.iv,
          subtitle_ct: encryptedSubtitle.ciphertext,
          subtitle_iv: encryptedSubtitle.iv,
          media_ct: encryptedMedia.ciphertext,
          media_iv: encryptedMedia.iv,
          media_mime: mediaFile.type || 'application/octet-stream',
        }),
      });

      if (!response.ok) {
        throw new Error(SAVE_ERROR);
      }

      setMediaFile(null);
      setTitle('');
      setSubtitle('');
      onSaved();
    } catch {
      setError(SAVE_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return html`
    <div class="add-screen">
      <h1>Dodaj kamień milowy</h1>
      <form onSubmit=${handleSubmit}>
        <label class="field">
          <span>Zdjęcie lub wideo</span>
          <input
            type="file"
            accept="image/*,video/mp4"
            capture="environment"
            data-testid="media-input"
            onChange=${handleMediaChange}
          />
          <!-- Backwards-compat alias for e2e tests still using photo-input -->
          <input
            type="file"
            accept="image/*,video/mp4"
            capture="environment"
            data-testid="photo-input"
            onChange=${handleMediaChange}
            style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;"
            tabindex="-1"
            aria-hidden="true"
          />
        </label>
        ${mediaFile
          ? html`<p class="media-preview" data-testid="media-preview">
              ${mediaFile.name} — ${(mediaFile.size / (1024 * 1024)).toFixed(2)} MB
            </p>`
          : null}
        <label class="field">
          <span>Tytuł</span>
          <input
            type="text"
            data-testid="title-input"
            placeholder="Co się wydarzyło?"
            value=${title}
            onInput=${(event) => setTitle(event.target.value)}
          />
        </label>
        <label class="field">
          <span>Podtytuł</span>
          <input
            type="text"
            data-testid="subtitle-input"
            placeholder="Dodaj trochę szczegółów"
            value=${subtitle}
            onInput=${(event) => setSubtitle(event.target.value)}
          />
        </label>
        <button type="submit" data-testid="save-button" disabled=${busy}>
          ${busy ? 'Zapisywanie...' : 'Zapisz'}
        </button>
      </form>
      ${error
        ? html`<p class="error" data-testid="add-error">${error}</p>`
        : null}
    </div>
  `;
}
