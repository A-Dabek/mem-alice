import { h } from 'https://esm.sh/preact@10.19.3';
import { useState } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

import { pickFile } from '../picker.js';
import { resolveItem } from '../onedrive.js';
import { fetchWithAuth, getPickerToken } from '../auth.js';

const html = htm.bind(h);

const NO_MEDIA_ERROR = 'Wybierz zdjęcie lub wideo z OneDrive.';
const NO_TITLE_ERROR = 'Wpisz tytuł.';
const PICK_ERROR = 'Nie można wybrać pliku. Spróbuj ponownie.';
const SAVE_ERROR = 'Nie można zapisać kamienia milowego. Spróbuj ponownie.';
const REAUTH_ERROR = 'Sesja wygasła. Zaloguj się ponownie.';

const VIDEO_EXTENSIONS = /\.(mp4|mov|m4v|webm)$/i;

/**
 * Infers a media MIME type from the Graph file mime or the file name.
 *
 * @param {string} mime
 * @param {string} name
 * @returns {string}
 */
function inferMime(mime, name) {
  if (mime) return mime;
  return VIDEO_EXTENSIONS.test(name || '') ? 'video/mp4' : 'image/jpeg';
}

/**
 * Reserves the preview box's aspect ratio: the intrinsic size when the API
 * returned it, else 16/9 for video and 4/3 for everything else. Keeping the
 * box sized before the media loads prevents layout shift.
 *
 * @param {string} [mime]
 * @param {number | null} [width]
 * @param {number | null} [height]
 * @returns {string}
 */
function aspectFor(mime, width, height) {
  if (width && height) return `${width} / ${height}`;
  return (mime || '').startsWith('video/') ? '16 / 9' : '4 / 3';
}

/**
 * Add Milestone screen (OneDrive picker PoC).
 *
 * Picks a photo/video straight from the user's OneDrive, resolves its
 * download URL + mime via the OneDrive API for the preview, and POSTs only the
 * item reference + title/subtitle to /api/milestones. No media is uploaded.
 *
 * @param {{ onSaved: () => void }} props
 */
export function AddMilestoneScreen({ onSaved }) {
  const [item, setItem] = useState(null); // { id, driveId, endpoint, downloadUrl, name, mime, width, height }
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [error, setError] = useState('');
  const [pickError, setPickError] = useState('');
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  async function handlePick() {
    if (picking) return;
    setPicking(true);
    setError('');
    setPickError('');
    try {
      // Acquire the OneDrive token (and its consent) BEFORE opening the picker
      // so the interactive consent popup is the first popup.
      const token = await getPickerToken();
      const picked = await pickFile(token);
      const resolved = await resolveItem(
        picked.id,
        picked.driveId,
        picked.endpoint,
        token
      );
      setItem({
        id: picked.id,
        driveId: picked.driveId,
        endpoint: picked.endpoint,
        downloadUrl: resolved.downloadUrl,
        name: resolved.name,
        mime: inferMime(resolved.mime, resolved.name),
        width: resolved.width,
        height: resolved.height,
      });
    } catch (err) {
      if (err?.message !== 'CANCELLED') {
        setPickError(PICK_ERROR);
      }
    } finally {
      setPicking(false);
    }
  }

  function handleClearMedia() {
    setItem(null);
    setPickError('');
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (busy) return;

    if (!item) {
      setError(NO_MEDIA_ERROR);
      return;
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError(NO_TITLE_ERROR);
      return;
    }

    setBusy(true);
    setError('');

    try {
      const response = await fetchWithAuth('/api/milestones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmedTitle,
          subtitle: subtitle.trim(),
          drive_item_id: item.id,
          drive_id: item.driveId,
          drive_endpoint: item.endpoint,
          media_mime: item.mime,
          media_width: item.width ?? null,
          media_height: item.height ?? null,
          item_name: item.name,
        }),
      });

      if (response.status === 401) {
        const authError = new Error(REAUTH_ERROR);
        authError.code = 'AUTH_REQUIRED';
        throw authError;
      }
      if (!response.ok) {
        throw new Error(SAVE_ERROR);
      }

      setItem(null);
      setTitle('');
      setSubtitle('');
      setPickError('');
      onSaved();
    } catch (error) {
      setError(error?.code === 'AUTH_REQUIRED' ? REAUTH_ERROR : SAVE_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const isVideo = item ? item.mime.startsWith('video/') : false;
  const ratio = aspectFor(item?.mime, item?.width, item?.height);
  const shownError = error || pickError;

  return html`
    <div class="add-screen">
      <h1>Dodaj kamień milowy</h1>
      <form onSubmit=${handleSubmit}>
        <div
          class=${`media-preview${item ? '' : ' media-preview-idle'}`}
          data-testid="media-preview"
          style=${`aspect-ratio: ${ratio}`}
        >
          ${item
            ? item.downloadUrl
              ? isVideo
                ? html`<video
                    class="preview-media"
                    data-testid="preview-video"
                    src=${item.downloadUrl}
                    controls
                    playsinline
                    preload="metadata"
                  ></video>`
                : html`<img
                    class="preview-media"
                    data-testid="preview-image"
                    src=${item.downloadUrl}
                    alt="Podgląd"
                  />`
              : html`<div class="media-preview-placeholder">
                  Nie można wczytać podglądu.
                </div>`
            : picking
              ? html`<div class="media-preview-placeholder">
                  Wybieranie...
                </div>`
              : html`<button
                  type="button"
                  class="picker-button"
                  data-testid="picker-button"
                  onClick=${handlePick}
                >
                  Wybierz z OneDrive
                </button>`}
        </div>
        ${item
          ? html`<p class="media-preview-name">${item.name}</p>
              <div class="media-preview-actions">
                <button
                  type="button"
                  class="media-clear-button"
                  data-testid="clear-media"
                  onClick=${handleClearMedia}
                >
                  Anuluj
                </button>
              </div>`
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
      ${shownError
        ? html`<p class="error" data-testid="add-error">${shownError}</p>`
        : null}
    </div>
  `;
}
