import { h } from 'https://esm.sh/preact@10.19.3';
import { useEffect, useLayoutEffect, useRef, useState } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

import { fetchWithAuth, reauthenticate } from '../auth.js';
import {
  aspectFor,
  authRequiredError,
  fetchMilestones,
  GONE_ITEM,
  LOAD_ERROR,
  LOADING_ITEM,
  REAUTH_ITEM,
  RESOLVE_ERROR,
  resolveMilestone,
  statusForError,
} from './milestoneData.js';
import { ArrowDownIcon, ArrowUpIcon, PencilIcon, TrashIcon } from './icons.js';

const html = htm.bind(h);

const NO_TITLE_ERROR = 'Wpisz tytuł.';
const EDIT_SAVE_ERROR = 'Nie można zapisać kamienia milowego. Spróbuj ponownie.';

/**
 * Timeline screen.
 *
 * Renders the stored Graph references as a plain vertical wall (oldest first,
 * no dates). Each row is resolved lazily against the OneDrive API when it
 * scrolls into view to fetch its thumbnail + default download URL; clicking
 * expands the full photo/video inline. A deleted/moved source file degrades to
 * a placeholder. Media boxes reserve their aspect ratio to avoid layout shift.
 *
 * @param {{ onAddMilestone?: () => void, editMode?: boolean, readOnly?: boolean }} props
 */
export function TimelineScreen({ onAddMilestone, editMode = false, readOnly = false }) {
  const canEdit = editMode && !readOnly;
  const [milestones, setMilestones] = useState(null); // null = still loading
  const [loadError, setLoadError] = useState('');
  const [needsReauth, setNeedsReauth] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [resolved, setResolved] = useState({}); // id -> { status, thumbUrl, downloadUrl, mime, width, height }
  const [expanded, setExpanded] = useState({}); // id -> boolean
  const [fullMedia, setFullMedia] = useState({}); // id -> true once full media is ready
  const [pendingDeleteId, setPendingDeleteId] = useState(null); // null | number
  const [deletingId, setDeletingId] = useState(null); // busy
  const [deleteError, setDeleteError] = useState('');
  const [pendingMove, setPendingMove] = useState(null); // null | { id, direction, title }
  const [movingId, setMovingId] = useState(null); // busy
  const [moveError, setMoveError] = useState('');
  const [editingId, setEditingId] = useState(null); // null | number
  const [editTitle, setEditTitle] = useState('');
  const [editSubtitle, setEditSubtitle] = useState('');
  const [editError, setEditError] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const wallRef = useRef(null);
  const startedRef = useRef(new Set());
  const titleInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setMilestones(null);
    setLoadError('');
    setNeedsReauth(false);
    fetchMilestones()
      .then((rows) => {
        if (!cancelled) setMilestones(rows);
      })
      .catch((error) => {
        if (cancelled) return;
        if (error?.code === 'AUTH_REQUIRED') setNeedsReauth(true);
        else setLoadError(LOAD_ERROR);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function handleReauth() {
    try {
      await reauthenticate();
      setReloadKey((value) => value + 1);
    } catch {
      // Keep the re-auth affordance visible; the next click retries.
    }
  }

  function startEditing(milestone) {
    setEditingId(milestone.id);
    setEditTitle(milestone.title);
    setEditSubtitle(milestone.subtitle || '');
    setEditError('');
  }

  function cancelEditing() {
    setEditingId(null);
    setEditError('');
  }

  async function handleSaveEdit(event) {
    event.preventDefault();
    if (savingEdit) return;

    const title = editTitle.trim();
    if (!title) {
      setEditError(NO_TITLE_ERROR);
      return;
    }

    setSavingEdit(true);
    setEditError('');
    try {
      const response = await fetchWithAuth('/api/milestones/' + editingId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, subtitle: editSubtitle.trim() }),
      });
      if (response.status === 401) throw authRequiredError();
      if (!response.ok) throw new Error('update failed');

      const updated = await response.json();
      setMilestones((prev) => prev.map((item) => (item.id === editingId ? updated : item)));
      setEditingId(null);
    } catch (error) {
      setEditError(error?.code === 'AUTH_REQUIRED' ? REAUTH_ITEM : EDIT_SAVE_ERROR);
    } finally {
      setSavingEdit(false);
    }
  }

  useEffect(() => {
    if (editingId !== null && titleInputRef.current) titleInputRef.current.focus();
  }, [editingId]);

  function loadOne(id, { interactive = false, force = false } = {}) {
    if (!force && !interactive && startedRef.current.has(id)) return;
    startedRef.current.add(id);

    const milestone = (milestones || []).find((item) => item.id === id);
    if (!milestone) return;

    setResolved((prev) => ({ ...prev, [id]: { status: 'loading' } }));

    resolveMilestone(milestone, interactive)
      .then((item) => {
        setResolved((prev) => ({
          ...prev,
          [id]: {
            status: 'ready',
            thumbUrl: item.thumbUrl,
            downloadUrl: item.downloadUrl,
            mime: item.mime || milestone.media_mime,
            width: item.width ?? null,
            height: item.height ?? null,
          },
        }));
      })
      .catch((error) => {
        setResolved((prev) => ({
          ...prev,
          [id]: { status: statusForError(error) },
        }));
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

  // Progressive image swap: preload the full-resolution download URL and only
  // swap the expanded <img> off the thumbnail once it is decoded, so "Zobacz
  // zdjęcie" never flashes an empty white box. Videos use `poster` instead,
  // handled natively by the element.
  useEffect(() => {
    for (const milestone of milestones || []) {
      const id = milestone.id;
      if (!expanded[id] || fullMedia[id]) continue;
      const e = resolved[id];
      if (!e?.downloadUrl) continue;
      const mime = e.mime || milestone.media_mime || '';
      if (mime.startsWith('video/')) continue;

      const image = new Image();
      const markLoaded = () =>
        setFullMedia((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
      image.onload = markLoaded;
      image.onerror = markLoaded;
      image.src = e.downloadUrl;
    }
  }, [expanded, resolved, milestones, fullMedia]);

  // Escape dismisses whichever confirmation modal is open, or an in-progress
  // inline edit.
  const escapeEffect = typeof useLayoutEffect === 'function' ? useLayoutEffect : useEffect;
  escapeEffect(() => {
    if (pendingDeleteId === null && pendingMove === null && editingId === null) {
      return undefined;
    }
    function onKey(e) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        setPendingDeleteId(null);
        setPendingMove(null);
        setEditingId(null);
        setEditError('');
      }
    }
    window.addEventListener('keydown', onKey);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('keydown', onKey);
    };
  }, [pendingDeleteId, pendingMove, editingId]);

  if (needsReauth) {
    return html`
      <div class="timeline-screen">
        <p class="error" data-testid="timeline-error">${REAUTH_ITEM}</p>
        <button
          type="button"
          class="milestone-load-button"
          data-testid="timeline-reauth"
          onClick=${handleReauth}
        >
          Zaloguj się ponownie
        </button>
      </div>
    `;
  }

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
        <p class="publication-name">Duże kroki małej Ali</p>
        ${readOnly
          ? null
          : html`<button
              type="button"
              class="add-button"
              data-testid="add-button"
              onClick=${onAddMilestone}
            >
              Dodaj
            </button>`}
      </header>
      ${milestones.length === 0
        ? html`
            <div class="empty-state" data-testid="timeline-empty">
              <p>Brak wpisów.</p>
            </div>
          `
        : html`
            <div class="milestone-wall" data-testid="timeline-wall" ref=${wallRef}>
              ${milestones.map((milestone, index) => {
                const e = resolved[milestone.id];
                const mime = e?.mime || milestone.media_mime || '';
                const isVideo = mime.startsWith('video/');
                const isExpanded = !canEdit && expanded[milestone.id] && e?.downloadUrl;
                const width = e?.width ?? milestone.media_width ?? null;
                const height = e?.height ?? milestone.media_height ?? null;
                const ratioStyle = `aspect-ratio: ${aspectFor(mime, width, height)}`;
                const photoSrc = fullMedia[milestone.id]
                  ? e?.downloadUrl
                  : e?.thumbUrl || e?.downloadUrl;
                return html`
                  <div class="milestone-item" data-testid="milestone-item" data-mid=${milestone.id} key=${milestone.id}>
                    <div class="milestone-media-frame">
                      ${isExpanded
                      ? isVideo
                        ? html`<video
                            class="milestone-video"
                            data-testid="milestone-video"
                            style=${ratioStyle}
                            src=${e.downloadUrl}
                            poster=${e.thumbUrl || undefined}
                            controls
                            playsinline
                            preload="metadata"
                          ></video>`
                        : html`<img
                            class="milestone-photo"
                            data-testid="milestone-photo"
                            style=${ratioStyle}
                            src=${photoSrc}
                            alt=${milestone.title || ''}
                          />`
                      : e && e.status === 'ready' && e.thumbUrl
                        ? html`
                            <img
                              class="milestone-thumb"
                              data-testid="milestone-thumb"
                              style=${ratioStyle}
                              src=${e.thumbUrl}
                              alt=${milestone.title || ''}
                              loading="lazy"
                              onClick=${canEdit ? undefined : () => setExpanded((prev) => ({ ...prev, [milestone.id]: true }))}
                            />
                            ${canEdit
                              ? null
                              : html`<button
                                  type="button"
                                  class="milestone-load-button"
                                  data-testid="milestone-load-button"
                                  onClick=${() => setExpanded((prev) => ({ ...prev, [milestone.id]: true }))}
                                >
                                  ${isVideo ? 'Odtwórz wideo' : 'Zobacz zdjęcie'}
                                </button>`}
                          `
                        : e && e.status === 'needs-auth'
                          ? html`<div class="milestone-photo-placeholder" data-testid="milestone-thumb-placeholder" style=${ratioStyle}>
                              <span data-testid="milestone-media-loading">${REAUTH_ITEM}</span>
                              <button
                                type="button"
                                class="milestone-load-button"
                                data-testid="milestone-reauth"
                                onClick=${() => loadOne(milestone.id, { interactive: true, force: true })}
                              >
                                Zaloguj ponownie
                              </button>
                            </div>`
                          : e && e.status === 'gone'
                            ? html`<div class="milestone-photo-placeholder" data-testid="milestone-thumb-placeholder" style=${ratioStyle}>
                                <span data-testid="milestone-media-loading">${GONE_ITEM}</span>
                              </div>`
                            : e && e.status === 'error'
                              ? html`<div class="milestone-photo-placeholder" data-testid="milestone-thumb-placeholder" style=${ratioStyle}>
                                  <span data-testid="milestone-media-loading">${RESOLVE_ERROR}</span>
                                  <button
                                    type="button"
                                    class="milestone-load-button"
                                    data-testid="milestone-retry"
                                    onClick=${() => loadOne(milestone.id, { force: true })}
                                  >
                                    Spróbuj ponownie
                                  </button>
                                </div>`
                              : html`<div class="milestone-photo-placeholder" data-testid="milestone-thumb-placeholder" style=${ratioStyle}>
                                  <span data-testid="milestone-media-loading">${LOADING_ITEM}</span>
                                </div>`}
                      ${canEdit
                        ? html`
                            <button
                              type="button"
                              class="milestone-control delete-button"
                              data-testid="delete-button"
                              data-id=${milestone.id}
                              aria-label="Usuń kamień milowy"
                              onClick=${() => { setPendingDeleteId(milestone.id); setDeleteError(''); }}
                            ><${TrashIcon} /></button>
                            <button
                              type="button"
                              class="milestone-control edit-button"
                              data-testid="edit-button"
                              data-id=${milestone.id}
                              aria-label="Edytuj kamień milowy"
                              onClick=${() => startEditing(milestone)}
                            ><${PencilIcon} /></button>
                            <button
                              type="button"
                              class="milestone-control move-up-button"
                              data-testid="move-up-button"
                              data-id=${milestone.id}
                              aria-label="Przenieś wyżej"
                              disabled=${index === 0}
                              onClick=${() => { setPendingMove({ id: milestone.id, direction: 'up', title: milestone.title }); setMoveError(''); }}
                            ><${ArrowUpIcon} /></button>
                            <button
                              type="button"
                              class="milestone-control move-down-button"
                              data-testid="move-down-button"
                              data-id=${milestone.id}
                              aria-label="Przenieś niżej"
                              disabled=${index === milestones.length - 1}
                              onClick=${() => { setPendingMove({ id: milestone.id, direction: 'down', title: milestone.title }); setMoveError(''); }}
                            ><${ArrowDownIcon} /></button>
                          `
                        : null}
                    </div>
                    ${editingId === milestone.id
                      ? html`
                          <form class="milestone-edit-form" onSubmit=${handleSaveEdit}>
                            <input
                              type="text"
                              class="edit-title-input"
                              data-testid="edit-title-input"
                              maxlength="200"
                              aria-label="Tytuł"
                              value=${editTitle}
                              ref=${titleInputRef}
                              onInput=${(event) => setEditTitle(event.target.value)}
                            />
                            <input
                              type="text"
                              class="edit-subtitle-input"
                              data-testid="edit-subtitle-input"
                              maxlength="500"
                              aria-label="Podtytuł"
                              value=${editSubtitle}
                              onInput=${(event) => setEditSubtitle(event.target.value)}
                            />
                            ${editError
                              ? html`<p class="error" data-testid="edit-error">${editError}</p>`
                              : null}
                            <div class="milestone-edit-actions">
                              <button
                                type="button"
                                class="edit-cancel-button"
                                data-testid="edit-cancel-button"
                                disabled=${savingEdit}
                                onClick=${cancelEditing}
                              >
                                Anuluj
                              </button>
                              <button
                                type="submit"
                                class="edit-save-button"
                                data-testid="edit-save-button"
                                disabled=${savingEdit}
                              >
                                ${savingEdit ? 'Zapisywanie...' : 'Zapisz'}
                              </button>
                            </div>
                          </form>
                        `
                      : html`
                          <p class="milestone-title" data-testid="milestone-title">${milestone.title}</p>
                          <p class="milestone-subtitle" data-testid="milestone-subtitle">${milestone.subtitle}</p>
                        `}
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
                  const res = await fetchWithAuth('/api/milestones/' + pendingDeleteId, { method: 'DELETE' });
                  if (res.status === 401) throw authRequiredError();
                  if (!res.ok) throw new Error('delete failed');
                  startedRef.current.delete(pendingDeleteId);
                  setMilestones(prev => prev.filter(m => m.id !== pendingDeleteId));
                  setResolved(prev => { const n = { ...prev }; delete n[pendingDeleteId]; return n; });
                  setExpanded(prev => { const n = { ...prev }; delete n[pendingDeleteId]; return n; });
                  setPendingDeleteId(null);
                } catch (error) {
                  setDeleteError(
                    error?.code === 'AUTH_REQUIRED'
                      ? REAUTH_ITEM
                      : 'Nie można usunąć kamienia milowego. Spróbuj ponownie.'
                  );
                } finally {
                  setDeletingId(null);
                }
              }}>${deletingId !== null ? 'Usuwanie...' : 'Usuń'}</button>
            </div>
          </div>
        </div>` : null}
      ${pendingMove !== null ? html`
        <div class="delete-modal-overlay" data-testid="move-confirm-dialog" onClick=${() => setPendingMove(null)}>
          <div class="delete-modal" role="dialog" aria-modal="true" aria-labelledby="move-modal-title" onClick=${e => e.stopPropagation()}>
            <p id="move-modal-title" class="delete-modal-title">Przenieść ten kamień milowy ${pendingMove.direction === 'up' ? 'wyżej' : 'niżej'}?</p>
            <p class="delete-modal-hint">Zmieni to kolejność na osi czasu.</p>
            ${moveError ? html`<p class="error" data-testid="move-error">${moveError}</p>` : null}
            <div class="delete-modal-actions">
              <button type="button" class="delete-cancel move-cancel" data-testid="move-cancel" disabled=${movingId !== null} onClick=${() => setPendingMove(null)}>Anuluj</button>
              <button type="button" class="delete-confirm move-confirm" data-testid="move-confirm" disabled=${movingId !== null} onClick=${async () => {
                setMovingId(pendingMove.id);
                setMoveError('');
                try {
                  const res = await fetchWithAuth('/api/milestones/' + pendingMove.id + '/move', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ direction: pendingMove.direction }),
                  });
                  if (res.status === 401) throw authRequiredError();
                  if (!res.ok) throw new Error('move failed');
                  setMilestones(await res.json());
                  setPendingMove(null);
                } catch (error) {
                  setMoveError(
                    error?.code === 'AUTH_REQUIRED'
                      ? REAUTH_ITEM
                      : 'Nie można przenieść kamienia milowego. Spróbuj ponownie.'
                  );
                } finally {
                  setMovingId(null);
                }
              }}>${movingId !== null ? 'Przenoszenie...' : 'Przenieś'}</button>
            </div>
          </div>
        </div>` : null}
    </div>
  `;
}
