import { h } from 'https://esm.sh/preact@10.19.3';
import { useEffect, useLayoutEffect, useRef, useState } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

import { resolveItem, getThumbnailUrl } from '../graph.js';

const html = htm.bind(h);

const LOAD_ERROR = 'Nie można wczytać kamieni milowych. Spróbuj ponownie.';
const BROKEN_ITEM = 'Nie można wczytać tego elementu';

/**
 * Fetches the stored milestone list, oldest first.
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
 * Renders the stored Graph references as a plain vertical wall (oldest first,
 * no dates). Each row is resolved lazily with Graph when it scrolls into view
 * to fetch its thumbnail + default download URL; clicking expands the full
 * photo/video inline. A deleted/moved source file degrades to a placeholder.
 *
 * @param {{ onAddMilestone: () => void }} props
 */
export function TimelineScreen({ onAddMilestone }) {
  const [milestones, setMilestones] = useState(null); // null = still loading
  const [loadError, setLoadError] = useState('');
  const [resolved, setResolved] = useState({}); // id -> { status, thumbUrl, downloadUrl, mime }
  const [expanded, setExpanded] = useState({}); // id -> boolean
  const [pendingDeleteId, setPendingDeleteId] = useState(null); // null | number
  const [deletingId, setDeletingId] = useState(null); // busy
  const [deleteError, setDeleteError] = useState('');

  const wallRef = useRef(null);
  const startedRef = useRef(new Set());

  useEffect(() => {
    let cancelled = false;
    fetchMilestones()
      .then((rows) => {
        if (!cancelled) setMilestones(rows);
      })
      .catch(() => {
        if (!cancelled) setLoadError(LOAD_ERROR);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function loadOne(id) {
    if (startedRef.current.has(id)) return;
    startedRef.current.add(id);

    const milestone = (milestones || []).find((item) => item.id === id);
    if (!milestone) return;

    setResolved((prev) => ({ ...prev, [id]: { status: 'loading' } }));

    Promise.all([
      resolveItem(milestone.drive_item_id, milestone.drive_id),
      getThumbnailUrl(milestone.drive_item_id, milestone.drive_id),
    ])
      .then(([item, thumbUrl]) => {
        setResolved((prev) => ({
          ...prev,
          [id]: {
            status: 'ready',
            thumbUrl,
            downloadUrl: item.downloadUrl,
            mime: item.mime || milestone.media_mime,
          },
        }));
      })
      .catch(() => {
        setResolved((prev) => ({ ...prev, [id]: { status: 'error' } }));
      });
  }

  // Resolve thumbnails lazily: only when a row scrolls into view.
  useEffect(() => {
    if (!milestones || milestones.length === 0 || !wallRef.current) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            observer.unobserve(entry.target);
            loadOne(Number(entry.target.dataset.mid));
          }
        });
      },
      { rootMargin: '200px' }
    );

    wallRef.current.querySelectorAll('[data-mid]').forEach((node) => observer.observe(node));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [milestones]);

  // Escape closes the delete confirmation modal.
  const escapeEffect = typeof useLayoutEffect === 'function' ? useLayoutEffect : useEffect;
  escapeEffect(() => {
    if (pendingDeleteId === null) return undefined;
    function onKey(e) {
      if (e.key === 'Escape' || e.key === 'Esc') setPendingDeleteId(null);
    }
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
            <div class="milestone-wall" data-testid="timeline-wall" ref=${wallRef}>
              ${milestones.map((milestone) => {
                const e = resolved[milestone.id];
                const mime = e?.mime || milestone.media_mime || '';
                const isVideo = mime.startsWith('video/');
                const isExpanded = expanded[milestone.id] && e?.downloadUrl;
                return html`
                  <div class="milestone-item" data-testid="milestone-item" data-mid=${milestone.id} key=${milestone.id}>
                    ${isExpanded
                      ? isVideo
                        ? html`<video
                            class="milestone-video"
                            data-testid="milestone-video"
                            src=${e.downloadUrl}
                            controls
                            playsinline
                            preload="metadata"
                          ></video>`
                        : html`<img
                            class="milestone-photo"
                            data-testid="milestone-photo"
                            src=${e.downloadUrl}
                            alt=${milestone.title || ''}
                          />`
                      : e && e.status === 'ready' && e.thumbUrl
                        ? html`
                            <img
                              class="milestone-thumb"
                              data-testid="milestone-thumb"
                              src=${e.thumbUrl}
                              alt=${milestone.title || ''}
                              loading="lazy"
                              onClick=${() => setExpanded((prev) => ({ ...prev, [milestone.id]: true }))}
                            />
                            <button
                              type="button"
                              class="milestone-load-button"
                              data-testid="milestone-load-button"
                              onClick=${() => setExpanded((prev) => ({ ...prev, [milestone.id]: true }))}
                            >
                              ${isVideo ? 'Odtwórz wideo' : 'Zobacz zdjęcie'}
                            </button>
                          `
                        : e && e.status === 'error'
                          ? html`<div class="milestone-photo-placeholder" data-testid="milestone-thumb-placeholder">
                              <span data-testid="milestone-media-loading">${BROKEN_ITEM}</span>
                            </div>`
                          : html`<div class="milestone-photo-placeholder" data-testid="milestone-thumb-placeholder">
                              <span data-testid="milestone-media-loading">Ładowanie podglądu...</span>
                            </div>`}
                    <p class="milestone-title" data-testid="milestone-title">${milestone.title}</p>
                    <p class="milestone-subtitle" data-testid="milestone-subtitle">${milestone.subtitle}</p>
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
                  startedRef.current.delete(pendingDeleteId);
                  setMilestones(prev => prev.filter(m => m.id !== pendingDeleteId));
                  setResolved(prev => { const n = { ...prev }; delete n[pendingDeleteId]; return n; });
                  setExpanded(prev => { const n = { ...prev }; delete n[pendingDeleteId]; return n; });
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
