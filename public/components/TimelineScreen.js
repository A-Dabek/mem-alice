import { h } from 'https://esm.sh/preact@10.19.3';
import { useState, useEffect, useRef } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

import { decryptField, decryptText } from '../crypto.js';

const html = htm.bind(h);

const SWIPE_THRESHOLD_PX = 50;
const BOUNDARY_FLASH_MS = 400;
const LOAD_ERROR = 'Could not load milestones. Please try again.';

/**
 * Fetches the (still-encrypted) milestone list, newest first.
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
 * Fetches the (encrypted) milestone list once, newest first, and shows one
 * milestone at a time starting at the most recent. The current entry and
 * its immediate neighbors are decrypted lazily (and cached) using the
 * in-memory AES key - the server never sees plaintext, and we avoid
 * decrypting the whole list up front. Left/right touch swipes move to the
 * older/newer milestone; swiping past either end shows a subtle boundary
 * indicator instead of wrapping.
 *
 * @param {{ cryptoKey: CryptoKey, onAddMilestone: () => void }} props
 */
export function TimelineScreen({ cryptoKey, onAddMilestone }) {
  const [milestones, setMilestones] = useState(null); // null = still loading
  const [loadError, setLoadError] = useState('');
  const [index, setIndex] = useState(0);
  const [decrypted, setDecrypted] = useState({}); // id -> { title, photoUrl } | { error: true }
  const [boundary, setBoundary] = useState(null); // 'newest' | 'oldest' | null

  const touchStartXRef = useRef(null);
  const objectUrlsRef = useRef(new Set());
  const boundaryTimeoutRef = useRef(null);
  const decryptedRef = useRef(decrypted);
  decryptedRef.current = decrypted;

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

  // Lazily decrypt the current entry and its immediate neighbors.
  useEffect(() => {
    if (!milestones || milestones.length === 0) {
      return undefined;
    }

    let cancelled = false;
    const indicesToLoad = [index - 1, index, index + 1].filter(
      (i) => i >= 0 && i < milestones.length
    );

    async function loadOne(milestone) {
      if (decryptedRef.current[milestone.id]) {
        return;
      }
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

    indicesToLoad.forEach((i) => loadOne(milestones[i]));

    return () => {
      cancelled = true;
    };
  }, [milestones, index, cryptoKey]);

  // Revoke object URLs on unmount to avoid leaking memory.
  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current.clear();
      if (boundaryTimeoutRef.current) {
        clearTimeout(boundaryTimeoutRef.current);
      }
    };
  }, []);

  function flashBoundary(which) {
    setBoundary(which);
    if (boundaryTimeoutRef.current) {
      clearTimeout(boundaryTimeoutRef.current);
    }
    boundaryTimeoutRef.current = setTimeout(() => setBoundary(null), BOUNDARY_FLASH_MS);
  }

  function goOlder() {
    if (!milestones) {
      return;
    }
    if (index >= milestones.length - 1) {
      flashBoundary('oldest');
      return;
    }
    setIndex((i) => i + 1);
  }

  function goNewer() {
    if (!milestones) {
      return;
    }
    if (index <= 0) {
      flashBoundary('newest');
      return;
    }
    setIndex((i) => i - 1);
  }

  function handleTouchStart(event) {
    touchStartXRef.current = event.touches[0].clientX;
  }

  function handleTouchEnd(event) {
    if (touchStartXRef.current === null) {
      return;
    }
    const deltaX = event.changedTouches[0].clientX - touchStartXRef.current;
    touchStartXRef.current = null;

    if (Math.abs(deltaX) < SWIPE_THRESHOLD_PX) {
      return;
    }

    if (deltaX < 0) {
      // Swiped left -> move to the next (older) milestone.
      goOlder();
    } else {
      // Swiped right -> move to the previous (newer) milestone.
      goNewer();
    }
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
      <div class="timeline-screen" data-testid="timeline-loading">Loading...</div>
    `;
  }

  if (milestones.length === 0) {
    return html`
      <div class="timeline-screen empty-state" data-testid="timeline-empty">
        <p>No milestones yet.</p>
        <button type="button" data-testid="empty-add-link" onClick=${onAddMilestone}>
          Add your first milestone
        </button>
      </div>
    `;
  }

  const current = milestones[index];
  const currentDecrypted = decrypted[current.id];
  const formattedDate = new Date(current.created_at).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return html`
    <div
      class="timeline-screen"
      data-testid="timeline-swipe-container"
      onTouchStart=${handleTouchStart}
      onTouchEnd=${handleTouchEnd}
    >
      ${boundary
        ? html`
            <div class="boundary-indicator" data-testid="timeline-boundary-${boundary}">
              ${boundary === 'newest'
                ? 'You are at the newest milestone'
                : 'You are at the oldest milestone'}
            </div>
          `
        : null}
      <div class="milestone-card" key=${current.id}>
        ${currentDecrypted && currentDecrypted.photoUrl
          ? html`
              <img
                class="milestone-photo"
                data-testid="milestone-photo"
                src=${currentDecrypted.photoUrl}
                alt=${currentDecrypted.title || ''}
              />
            `
          : html`<div class="milestone-photo-placeholder" data-testid="milestone-photo-loading">
              ${currentDecrypted && currentDecrypted.error ? 'Could not decrypt photo' : 'Loading photo...'}
            </div>`}
        <h2 class="milestone-title" data-testid="milestone-title">
          ${currentDecrypted
            ? currentDecrypted.error
              ? 'Could not decrypt title'
              : currentDecrypted.title
            : 'Decrypting...'}
        </h2>
        <p class="milestone-date" data-testid="milestone-date">${formattedDate}</p>
      </div>
      <p class="milestone-position" data-testid="milestone-position">
        ${index + 1} / ${milestones.length}
      </p>
    </div>
  `;
}
