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
 * vertical wall: one photo with its title underneath, scrollable like a
 * feed. No cards, no swiping, no pagination/infinite scroll.
 *
 * @param {{ cryptoKey: CryptoKey, onAddMilestone: () => void }} props
 */
export function TimelineScreen({ cryptoKey, onAddMilestone }) {
  const [milestones, setMilestones] = useState(null); // null = still loading
  const [loadError, setLoadError] = useState('');
  const [decrypted, setDecrypted] = useState({}); // id -> { title, photoUrl } | { error: true }

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
        const [title, photoBytes] = await Promise.all([
          decryptText(cryptoKey, milestone.title_ct, milestone.title_iv),
          decryptField(cryptoKey, milestone.photo_ct, milestone.photo_iv),
        ]);

        if (cancelled) {
          return;
        }

        const blob = new Blob([photoBytes], { type: milestone.photo_mime });
        const photoUrl = URL.createObjectURL(blob);
        objectUrlsRef.current.add(photoUrl);

        setDecrypted((prev) => ({
          ...prev,
          [milestone.id]: { title, photoUrl },
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
                return html`
                  <div class="milestone-item" data-testid="milestone-item" key=${milestone.id}>
                    ${entry && entry.photoUrl
                      ? html`
                          <img
                            class="milestone-photo"
                            data-testid="milestone-photo"
                            src=${entry.photoUrl}
                            alt=${entry.title || ''}
                          />
                        `
                      : html`<div class="milestone-photo-placeholder" data-testid="milestone-photo-loading">
                          ${entry && entry.error ? 'Could not decrypt photo' : 'Loading photo...'}
                        </div>`}
                    <p class="milestone-title" data-testid="milestone-title">
                      ${entry
                        ? entry.error
                          ? 'Could not decrypt title'
                          : entry.title
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
