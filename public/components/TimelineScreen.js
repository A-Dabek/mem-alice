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
 * every entry with the in-memory AES key, and renders them as a plain
 * vertical wall: one media (image or video) with its title underneath,
 * scrollable like a feed. No cards, no swiping, no pagination/infinite scroll.
 *
 * @param {{ cryptoKey: CryptoKey, onAddMilestone: () => void }} props
 */
export function TimelineScreen({ cryptoKey, onAddMilestone }) {
  const [milestones, setMilestones] = useState(null); // null = still loading
  const [loadError, setLoadError] = useState('');
  const [decrypted, setDecrypted] = useState({}); // id -> { title, subtitle, mediaUrl, mediaMime, photoUrl } | { error: true }
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

  // Decrypt every entry once the list is known.
  useEffect(() => {
    if (!milestones || milestones.length === 0) {
      return undefined;
    }

    let cancelled = false;

    async function loadOne(milestone) {
      try {
        const [title, subtitle, mediaBytes] = await Promise.all([
          decryptText(cryptoKey, milestone.title_ct, milestone.title_iv),
          decryptText(cryptoKey, milestone.subtitle_ct, milestone.subtitle_iv),
          decryptField(cryptoKey, milestone.media_ct, milestone.media_iv),
        ]);

        if (cancelled) {
          return;
        }

        const mediaMime = milestone.media_mime;
        const blob = new Blob([mediaBytes], { type: mediaMime });
        const mediaUrl = URL.createObjectURL(blob);
        objectUrlsRef.current.add(mediaUrl);

        setDecrypted((prev) => ({
          ...prev,
          [milestone.id]: { title, subtitle, mediaUrl, mediaMime, photoUrl: mediaUrl },
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
                const entry = decrypted[milestone.id];
                const mediaUrl = entry && (entry.mediaUrl || entry.photoUrl);
                const mediaMime = entry && entry.mediaMime;
                const isVideo = mediaMime === 'video/mp4';
                return html`
                  <div class="milestone-item" data-testid="milestone-item" key=${milestone.id}>
                    ${entry && mediaUrl
                      ? isVideo
                        ? html`<video
                            class="milestone-video"
                            data-testid="milestone-video"
                            src=${mediaUrl}
                            controls
                            playsinline
                            preload="metadata"
                          ></video>`
                        : html`<img
                            class="milestone-photo"
                            data-testid="milestone-photo"
                            src=${mediaUrl}
                            alt=${entry.title || ''}
                          />`
                      : html`<div class="milestone-photo-placeholder" data-testid="milestone-photo-loading">
                          <span data-testid="milestone-media-loading"
                            >${entry && entry.error ? 'Nie można odszyfrować multimediów' : 'Ładowanie multimediów...'}</span
                          >
                        </div>`}
                    <p class="milestone-title" data-testid="milestone-title">
                      ${entry
                        ? entry.error
                          ? 'Nie można odszyfrować tytułu'
                          : entry.title
                        : 'Odszyfrowywanie...'}
                    </p>
                    <p class="milestone-subtitle" data-testid="milestone-subtitle">
                      ${entry
                        ? entry.error
                          ? 'Nie można odszyfrować podtytułu'
                          : entry.subtitle
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
                  if (entry && entry.mediaUrl) {
                    try { URL.revokeObjectURL(entry.mediaUrl); } catch {}
                    objectUrlsRef.current.delete(entry.mediaUrl);
                  }
                  if (entry && entry.photoUrl && entry.photoUrl !== (entry.mediaUrl || '')) {
                    try { URL.revokeObjectURL(entry.photoUrl); } catch {}
                    objectUrlsRef.current.delete(entry.photoUrl);
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
