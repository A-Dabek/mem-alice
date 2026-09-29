import { h } from 'https://esm.sh/preact@10.19.3';
import { useEffect, useRef, useState } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

import { reauthenticate } from '../auth.js';
import {
  aspectFor,
  fetchMilestones,
  LOAD_ERROR,
  LOADING_ITEM,
  REAUTH_ITEM,
  RESOLVE_ERROR,
  resolveMilestone,
} from './milestoneData.js';

const html = htm.bind(h);

/**
 * Home landing screen.
 *
 * The entry view after sign-in: a title, navigation to the read-only timeline /
 * edit / add routes, and a static (non-expandable) card for the latest
 * milestone — the last element of the position-ordered list. The thumbnail is
 * resolved silently on mount; a silent-token failure surfaces the gesture-safe
 * re-auth button, mirroring the timeline's `needs-auth` state. Viewing and
 * expanding live in the timeline route, so the card is never clickable.
 *
 * @param {{ onTimeline: () => void, onEdit: () => void, onAdd: () => void }} props
 */
export function HomeScreen({ onTimeline, onEdit, onAdd }) {
  const [milestones, setMilestones] = useState(null); // null = still loading
  const [loadError, setLoadError] = useState('');
  const [needsReauth, setNeedsReauth] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [latest, setLatest] = useState(null); // null | { status, thumbUrl, mime, width, height }
  const startedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setMilestones(null);
    setLoadError('');
    setNeedsReauth(false);
    setLatest(null);
    startedRef.current = false;
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

  const latestMilestone =
    milestones && milestones.length > 0 ? milestones[milestones.length - 1] : null;
  const latestId = latestMilestone ? latestMilestone.id : null;

  // The latest card resolves silently on mount (and when the list changes).
  useEffect(() => {
    if (latestId === null || startedRef.current) return undefined;
    startedRef.current = true;
    let cancelled = false;
    setLatest({ status: 'loading' });
    resolveMilestone(latestMilestone, false)
      .then((item) => {
        if (cancelled) return;
        setLatest({
          status: 'ready',
          thumbUrl: item.thumbUrl,
          downloadUrl: item.downloadUrl,
          mime: item.mime || latestMilestone.media_mime,
          width: item.width ?? null,
          height: item.height ?? null,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        if (error?.code === 'AUTH_REQUIRED') setNeedsReauth(true);
        else setLatest({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestId, reloadKey]);

  async function handleReauth() {
    try {
      await reauthenticate();
      setReloadKey((value) => value + 1);
    } catch {
      // Keep the re-auth affordance visible; the next click retries.
    }
  }

  function renderLatest() {
    if (needsReauth) {
      return html`
        <p class="error" data-testid="home-reauth-error">${REAUTH_ITEM}</p>
        <button
          type="button"
          class="milestone-load-button"
          data-testid="home-reauth"
          onClick=${handleReauth}
        >
          Zaloguj się ponownie
        </button>
      `;
    }
    if (loadError) {
      return html`<p class="error" data-testid="home-error">${loadError}</p>`;
    }
    if (milestones === null) {
      return html`<p class="home-latest-status" data-testid="home-loading">Ładowanie...</p>`;
    }
    if (milestones.length === 0) {
      return html`<p class="home-latest-status" data-testid="home-empty">Brak wpisów.</p>`;
    }

    const mime = latest?.mime || latestMilestone.media_mime || '';
    const width = latest?.width ?? latestMilestone.media_width ?? null;
    const height = latest?.height ?? latestMilestone.media_height ?? null;
    const ratioStyle = `aspect-ratio: ${aspectFor(mime, width, height)}`;

    return html`
      <div class="home-latest" data-testid="home-latest">
        ${latest?.status === 'ready' && latest.thumbUrl
          ? html`<img
              class="home-latest-thumb"
              data-testid="home-latest-thumb"
              style=${ratioStyle}
              src=${latest.thumbUrl}
              alt=${latestMilestone.title || ''}
              loading="lazy"
            />`
          : latest?.status === 'error'
            ? html`<div class="home-latest-placeholder" data-testid="home-latest-placeholder" style=${ratioStyle}>
                <span>${RESOLVE_ERROR}</span>
                <button
                  type="button"
                  class="milestone-load-button"
                  data-testid="home-retry"
                  onClick=${() => setReloadKey((value) => value + 1)}
                >
                  Spróbuj ponownie
                </button>
              </div>`
            : html`<div class="home-latest-placeholder" data-testid="home-latest-placeholder" style=${ratioStyle}>
                <span>${LOADING_ITEM}</span>
              </div>`}
        <p class="milestone-title" data-testid="home-latest-title">${latestMilestone.title}</p>
        <p class="milestone-subtitle" data-testid="home-latest-subtitle">${latestMilestone.subtitle}</p>
      </div>
    `;
  }

  return html`
    <div class="home-screen">
      <h1>Duże kroki małej Ali</h1>
      <div class="home-actions">
        <button type="button" data-testid="home-timeline" onClick=${onTimeline}>
          Oś czasu
        </button>
        <button type="button" data-testid="home-edit" onClick=${onEdit}>
          Edytuj
        </button>
        <button type="button" data-testid="home-add" onClick=${onAdd}>
          Dodaj nowy
        </button>
      </div>
      <section class="home-latest-section">
        ${milestones && milestones.length > 0
          ? html`<h2 class="home-latest-heading" data-testid="home-latest-heading">
              Ostatni dodany
            </h2>`
          : null}
        ${renderLatest()}
      </section>
    </div>
  `;
}
