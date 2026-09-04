import { h } from 'https://esm.sh/preact@10.19.3';
import { useState } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

import { encryptField } from '../crypto.js';

const html = htm.bind(h);

const NO_PHOTO_ERROR = 'Please choose a photo.';
const NO_TITLE_ERROR = 'Please enter a title.';
const NO_SUBTITLE_ERROR = 'Please enter a subtitle.';
const SAVE_ERROR = 'Could not save this milestone. Please try again.';

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
 * Lets the user pick/take a photo and type a title and subtitle, encrypts
 * all fields client-side with the in-memory AES key (the server never sees plaintext),
 * and POSTs only ciphertext + mime type to /api/milestones. On success,
 * returns to the Timeline route so the new entry is immediately
 * visible.
 *
 * @param {{ cryptoKey: CryptoKey, onSaved: () => void }} props
 */
export function AddMilestoneScreen({ cryptoKey, onSaved }) {
  const [photoFile, setPhotoFile] = useState(null);
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function handlePhotoChange(event) {
    const file = event.target.files && event.target.files[0];
    setPhotoFile(file || null);
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (busy) {
      return;
    }

    if (!photoFile) {
      setError(NO_PHOTO_ERROR);
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
      const photoBytes = await readFileBytes(photoFile);

      const [encryptedTitle, encryptedSubtitle, encryptedPhoto] = await Promise.all([
        encryptField(cryptoKey, trimmedTitle),
        encryptField(cryptoKey, trimmedSubtitle),
        encryptField(cryptoKey, photoBytes),
      ]);

      const response = await fetch('/api/milestones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title_ct: encryptedTitle.ciphertext,
          title_iv: encryptedTitle.iv,
          subtitle_ct: encryptedSubtitle.ciphertext,
          subtitle_iv: encryptedSubtitle.iv,
          photo_ct: encryptedPhoto.ciphertext,
          photo_iv: encryptedPhoto.iv,
          photo_mime: photoFile.type || 'application/octet-stream',
        }),
      });

      if (!response.ok) {
        throw new Error(SAVE_ERROR);
      }

      setPhotoFile(null);
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
      <h1>Add Milestone</h1>
      <form onSubmit=${handleSubmit}>
        <label class="field">
          <span>Photo</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            data-testid="photo-input"
            onChange=${handlePhotoChange}
          />
        </label>
        <label class="field">
          <span>Title</span>
          <input
            type="text"
            data-testid="title-input"
            placeholder="What happened?"
            value=${title}
            onInput=${(event) => setTitle(event.target.value)}
          />
        </label>
        <label class="field">
          <span>Subtitle</span>
          <input
            type="text"
            data-testid="subtitle-input"
            placeholder="A little more detail"
            value=${subtitle}
            onInput=${(event) => setSubtitle(event.target.value)}
          />
        </label>
        <button type="submit" data-testid="save-button" disabled=${busy}>
          ${busy ? 'Saving...' : 'Save'}
        </button>
      </form>
      ${error
        ? html`<p class="error" data-testid="add-error">${error}</p>`
        : null}
    </div>
  `;
}
