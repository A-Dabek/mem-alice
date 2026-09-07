import { h } from 'https://esm.sh/preact@10.19.3';
import { useEffect, useRef, useState } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

import { decryptField, decryptText } from '../crypto.js';

const html = htm.bind(h);

const LOAD_ERROR = 'Could not load milestones. Please try again.';

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

  if (loadError) {
    return html`
      <div class="timeline-screen">
        <p class="error" data-testid="timeline-error">${loadError}</p>
      </div>
    `;
  }

  if (milestones === null) {
    return html`
      <div class="timeline-screen" data-testid="timeline-loading">Loading...</div>
    `;
  }

  return html`
    <div class="timeline-screen">
      <header class="timeline-masthead">
        <p class="publication-name">Milestones</p>
        <button
          type="button"
          class="add-button"
          data-testid="add-button"
          onClick=${onAddMilestone}
        >
          Add
        </button>
      </header>
      ${milestones.length === 0
        ? html`
            <div class="empty-state" data-testid="timeline-empty">
              <p>No milestones yet.</p>
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
                            >${entry && entry.error ? 'Could not decrypt media' : 'Loading media...'}</span
                          >
                        </div>`}
                    <p class="milestone-title" data-testid="milestone-title">
                      ${entry
                        ? entry.error
                          ? 'Could not decrypt title'
                          : entry.title
                        : 'Decrypting...'}
                    </p>
                    <p class="milestone-subtitle" data-testid="milestone-subtitle">
                      ${entry
                        ? entry.error
                          ? 'Could not decrypt subtitle'
                          : entry.subtitle
                        : 'Decrypting...'}
                    </p>
                  </div>
                `;
              })}
            </div>
          `}
    </div>
  `;
}
