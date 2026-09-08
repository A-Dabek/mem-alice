import { h } from 'https://esm.sh/preact@10.19.3';
import { useEffect, useLayoutEffect, useRef, useState } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

import { decryptField, decryptText } from '../crypto.js';

const html = htm.bind(h);

const LOAD_ERROR = 'Nie można wczytać kamieni milowych. Spróbuj ponownie.';

/**
 * Fetches the (still-encrypted) milestone list, oldest first.
 *
 * @returns {Promise<Array<object>>}
 */
async function fetchMilestones() {
  let response;
  try {
    response = await fetch('/api/milestones');
  } catch {
    throw new Error(LOAD_ERROR);
  }
  if (!response.ok) {
    throw new Error(LOAD_ERROR);
  }
  return response.json();
}

/**
 * Timeline screen.
 *
 * Fetches the (encrypted) milestone list - oldest first, since there are no
 * dates anywhere and entries are simply ordered by upload order - decrypts
 * titles/subtitles and thumbnails eagerly, and renders them as a plain
 * vertical wall: one thumbnail with its title underneath, scrollable like a feed.
 * Full media is fetched on click (click-to-load) via GET /:id/media, decrypted
 * and inline-replaced. No cards, no swiping, no pagination/infinite scroll.
 *
 * @param {{ cryptoKey: CryptoKey, onAddMilestone: () => void }} props
 */
export function TimelineScreen({ cryptoKey, onAddMilestone }) {
  const [milestones, setMilestones] = useState(null); // null = still loading
  const [loadError, setLoadError] = useState('');
  const [decrypted, setDecrypted] = useState({}); // id -> { title, subtitle, thumbUrl, thumbMime, mediaUrl?, mediaMime, mediaState:'idle'|'loading'|'ready', error? }
  const [pendingDeleteId, setPendingDeleteId] = useState(null); // null | number
  const [deletingId, setDeletingId] = useState(null); // busy
  const [deleteError, setDeleteError] = useState('');

  const objectUrlsRef = useRef(new Set());

  // Fetch the list once on mount.
  useEffect(() => {
    let cancelled = false;
    fetchMilestones()
      .then((rows) => {
        if (!cancelled) {
          setMilestones(rows);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(LOAD_ERROR);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Decrypt every entry once the list is known — eagerly decrypt titles, subtitles and thumbnails only.
  useEffect(() => {
    if (!milestones || milestones.length === 0) {
      return undefined;
    }

    let cancelled = false;

    async function loadOne(milestone) {
      try {
        const [title, subtitle] = await Promise.all([
          decryptText(cryptoKey, milestone.title_ct, milestone.title_iv),
          decryptText(cryptoKey, milestone.subtitle_ct, milestone.subtitle_iv),
        ]);

        let thumbUrl = null;
        if (milestone.thumb_ct && milestone.thumb_iv) {
          try {
            const thumbBytes = await decryptField(cryptoKey, milestone.thumb_ct, milestone.thumb_iv);
            if (cancelled) return;
            const blob = new Blob([thumbBytes], { type: milestone.thumb_mime || 'image/jpeg' });
            thumbUrl = URL.createObjectURL(blob);
            objectUrlsRef.current.add(thumbUrl);
          } catch {
            thumbUrl = null;
          }
        }

        if (cancelled) {
          if (thumbUrl) {
            try { URL.revokeObjectURL(thumbUrl); } catch {}
            objectUrlsRef.current.delete(thumbUrl);
          }
          return;
        }

        setDecrypted((prev) => ({
          ...prev,
          [milestone.id]: {
            title,
            subtitle,
            thumbUrl,
            thumbMime: milestone.thumb_mime,
            mediaMime: milestone.media_mime,
            mediaState: 'idle',
          },
        }));
      } catch {
        if (!cancelled) {
          setDecrypted((prev) => ({
            ...prev,
            [milestone.id]: { error: true },
          }));
        }
      }
    }

    milestones.forEach((milestone) => loadOne(milestone));

    return () => {
      cancelled = true;
    };
  }, [milestones, cryptoKey]);

  async function loadMedia(id) {
    const cur = decrypted[id];
    if (!cur || cur.mediaState !== 'idle') return;
    setDecrypted((prev) => ({ ...prev, [id]: { ...prev[id], mediaState: 'loading' } }));
    try {
      const res = await fetch('/api/milestones/' + id + '/media');
      if (!res.ok) throw new Error('fetch media failed');
      const { media_ct, media_iv, media_mime } = await res.json();
      const bytes = await decryptField(cryptoKey, media_ct, media_iv);
      const url = URL.createObjectURL(new Blob([bytes], { type: media_mime }));
      objectUrlsRef.current.add(url);
      setDecrypted((prev) => ({ ...prev, [id]: { ...prev[id], mediaUrl: url, mediaMime: media_mime, mediaState: 'ready' } }));
    } catch {
      setDecrypted((prev) => ({ ...prev, [id]: { ...prev[id], mediaState: 'error', error: true } }));
    }
  }

  // Revoke object URLs on unmount to avoid leaking memory.
  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current.clear();
    };
  }, []);

  // Escape closes delete confirmation modal
  const escapeEffect = typeof useLayoutEffect === 'function' ? useLayoutEffect : useEffect;
  escapeEffect(() => {
    if (pendingDeleteId === null) return undefined;
    function onKey(e) { if (e.key === 'Escape' || e.key === 'Esc') setPendingDeleteId(null); }
    window.addEventListener('keydown', onKey);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('keydown', onKey);
    };
  }, [pendingDeleteId]);

  if (loadError) {
    return html`
      <div class="timeline-screen">
        <p class="error" data-testid="timeline-error">${loadError}</p>
      </div>
    `;
  }

  if (milestones === null) {
    return html`
      <div class="timeline-screen" data-testid="timeline-loading">Ładowanie...</div>
    `;
  }

  return html`
    <div class="timeline-screen">
      <header class="timeline-masthead">
        <p class="publication-name">Kamienie milowe</p>
        <button
          type="button"
          class="add-button"
          data-testid="add-button"
          onClick=${onAddMilestone}
        >
          Dodaj
        </button>
      </header>
      ${milestones.length === 0
        ? html`
            <div class="empty-state" data-testid="timeline-empty">
              <p>Brak wpisów.</p>
            </div>
          `
        : html`
            <div class="milestone-wall" data-testid="timeline-wall">
              ${milestones.map((milestone) => {
                const e = decrypted[milestone.id];
                const isVideo = (e?.mediaMime || milestone.media_mime) === 'video/mp4';
                const thumbReady = e && e.thumbUrl;
                const mediaReady = e && e.mediaState === 'ready' && e.mediaUrl;
                return html`
                  <div class="milestone-item" data-testid="milestone-item" key=${milestone.id}>
                    ${mediaReady
                      ? isVideo
                        ? html`<video
                            class="milestone-video"
                            data-testid="milestone-video"
                            src=${e.mediaUrl}
                            controls
                            playsinline
                            preload="metadata"
                          ></video>`
                        : html`<img
                            class="milestone-photo"
                            data-testid="milestone-photo"
                            src=${e.mediaUrl}
                            alt=${e.title || ''}
                          />`
                      : thumbReady
                        ? html`
                            <img
                              class="milestone-thumb"
                              data-testid="milestone-thumb"
                              src=${e.thumbUrl}
                              alt=${e.title || ''}
                              loading="lazy"
                              onClick=${() => loadMedia(milestone.id)}
                              style="cursor:pointer"
                            />
                            <button
                              type="button"
                              class="milestone-load-button"
                              data-testid="milestone-load-button"
                              disabled=${e.mediaState === 'loading'}
                              onClick=${() => loadMedia(milestone.id)}
                            >
                              ${e.mediaState === 'loading' ? 'Ładowanie...' : isVideo ? 'Odtwórz wideo' : 'Zobacz zdjęcie'}
                            </button>
                          `
                        : html`<div class="milestone-photo-placeholder" data-testid="milestone-thumb-placeholder">
                            <span data-testid="milestone-media-loading"
                              >${e && e.error ? 'Nie można odszyfrować podglądu' : 'Ładowanie podglądu...'}</span
                            >
                          </div>
                          ${e && !e.error
                            ? html`<button
                                type="button"
                                class="milestone-load-button"
                                data-testid="milestone-load-button"
                                disabled=${e.mediaState === 'loading'}
                                onClick=${() => loadMedia(milestone.id)}
                              >
                                ${e.mediaState === 'loading' ? 'Ładowanie...' : isVideo ? 'Odtwórz wideo' : 'Zobacz zdjęcie'}
                              </button>`
                            : null}`}
                    ${!mediaReady && e && e.mediaState === 'error'
                      ? html`<p class="error" data-testid="milestone-media-error">Nie można odszyfrować multimediów</p>`
                      : null}
                    <p class="milestone-title" data-testid="milestone-title">
                      ${e
                        ? e.error
                          ? 'Nie można odszyfrować tytułu'
                          : e.title
                        : 'Odszyfrowywanie...'}
                    </p>
                    <p class="milestone-subtitle" data-testid="milestone-subtitle">
                      ${e
                        ? e.error
                          ? 'Nie można odszyfrować podtytułu'
                          : e.subtitle
                        : 'Odszyfrowywanie...'}
                    </p>
                    <button type="button" class="delete-button" data-testid="delete-button" data-id=${milestone.id} onClick=${() => { setPendingDeleteId(milestone.id); setDeleteError(''); }}>Usuń</button>
                  </div>
                `;
              })}
            </div>
          `}
      ${pendingDeleteId !== null ? html`
        <div class="delete-modal-overlay" data-testid="delete-confirm-dialog" onClick=${() => setPendingDeleteId(null)}>
          <div class="delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title" onClick=${e => e.stopPropagation()}>
            <p id="delete-modal-title" class="delete-modal-title">Czy na pewno usunąć ten kamień milowy?</p>
            <p class="delete-modal-hint">Tej operacji nie można cofnąć.</p>
            ${deleteError ? html`<p class="error" data-testid="delete-error">${deleteError}</p>` : null}
            <div class="delete-modal-actions">
              <button type="button" class="delete-cancel" data-testid="delete-cancel" disabled=${deletingId !== null} onClick=${() => setPendingDeleteId(null)}>Anuluj</button>
              <button type="button" class="delete-confirm" data-testid="delete-confirm" disabled=${deletingId !== null} onClick=${async () => {
                setDeletingId(pendingDeleteId);
                setDeleteError('');
                try {
                  const res = await fetch('/api/milestones/' + pendingDeleteId, { method: 'DELETE' });
                  if (!res.ok) throw new Error('delete failed');
                  const entry = decrypted[pendingDeleteId];
                  if (entry) {
                    if (entry.mediaUrl) {
                      try { URL.revokeObjectURL(entry.mediaUrl); } catch {}
                      objectUrlsRef.current.delete(entry.mediaUrl);
                    }
                    if (entry.thumbUrl) {
                      try { URL.revokeObjectURL(entry.thumbUrl); } catch {}
                      objectUrlsRef.current.delete(entry.thumbUrl);
                    }
                    if (entry.photoUrl && entry.photoUrl !== (entry.mediaUrl || '') && entry.photoUrl !== (entry.thumbUrl || '')) {
                      try { URL.revokeObjectURL(entry.photoUrl); } catch {}
                      objectUrlsRef.current.delete(entry.photoUrl);
                    }
                  }
                  setMilestones(prev => prev.filter(m => m.id !== pendingDeleteId));
                  setDecrypted(prev => { const n = { ...prev }; delete n[pendingDeleteId]; return n; });
                  setPendingDeleteId(null);
                } catch {
                  setDeleteError('Nie można usunąć kamienia milowego. Spróbuj ponownie.');
                } finally {
                  setDeletingId(null);
                }
              }}>${deletingId !== null ? 'Usuwanie...' : 'Usuń'}</button>
            </div>
          </div>
        </div>` : null}
    </div>
  `;
}
