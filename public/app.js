import { h, render } from 'https://esm.sh/preact@10.19.3';
import { useEffect, useState } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

import { getAccount, signOut } from './auth.js';
import { clearResolutionCache } from './onedriveCache.js';
import { SignInScreen } from './components/SignInScreen.js';
import { AddMilestoneScreen } from './components/AddMilestoneScreen.js';
import { TimelineScreen } from './components/TimelineScreen.js';
import { HomeScreen } from './components/HomeScreen.js';
import { HomeIcon } from './components/icons.js';

const html = htm.bind(h);

export const HOME_HASH = '#home';
export const TIMELINE_HASH = '#timeline';
export const EDIT_HASH = '#edit';
export const ADD_HASH = '#add';

export function goHome() {
  window.location.hash = '';
}

export function goToTimeline() {
  window.location.hash = TIMELINE_HASH;
}

export function goToEdit() {
  window.location.hash = EDIT_HASH;
}

export function goToAdd() {
  window.location.hash = ADD_HASH;
}

/**
 * Reads the current route from the URL hash. All four views are genuine routes
 * (`#timeline`, `#edit`, `#add`, or empty/`#home`), so the browser's native back
 * button navigates between them. Unknown hashes fall back to home.
 *
 * @returns {'home' | 'timeline' | 'edit' | 'add'}
 */
export function getRoute() {
  const hash = window.location.hash;
  if (hash === TIMELINE_HASH) return 'timeline';
  if (hash === EDIT_HASH) return 'edit';
  if (hash === ADD_HASH) return 'add';
  return 'home';
}

/**
 * Root component.
 *
 * Holds the signed-in account (from MSAL, cached in sessionStorage by the
 * library - nothing sensitive is kept here) and the current route. Signed
 * out -> SignInScreen; signed in -> Home / Timeline / Edit / Add. The header
 * (account + logout) is shown everywhere except the read-only timeline, whose
 * only chrome is the wall itself.
 */
function App() {
  const [account, setAccount] = useState(null);
  const [ready, setReady] = useState(false);
  const [route, setRoute] = useState(getRoute());
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAccount()
      .then((current) => {
        if (!cancelled) setAccount(current);
      })
      .catch((error) => {
        console.error('[app] could not restore account', error);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handleHashChange() {
      setRoute(getRoute());
    }
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  if (!ready) {
    return html`<div class="app-loading" data-testid="app-loading">Ładowanie...</div>`;
  }

  if (!account) {
    return html`<${SignInScreen} onSignedIn=${setAccount} />`;
  }

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } catch (error) {
      console.error('[app] sign out failed', error);
    } finally {
      clearResolutionCache();
      setAccount(null);
      goHome();
      setRoute('home');
      setSigningOut(false);
    }
  }

  function renderRoute() {
    if (route === 'timeline') {
      return html`<${TimelineScreen} readOnly />`;
    }
    if (route === 'edit') {
      return html`<${TimelineScreen} editMode onAddMilestone=${goToAdd} />`;
    }
    if (route === 'add') {
      return html`<${AddMilestoneScreen} onSaved=${goHome} />`;
    }
    return html`
      <${HomeScreen} onTimeline=${goToTimeline} onEdit=${goToEdit} onAdd=${goToAdd} />
    `;
  }

  return html`
    <div class="app-shell">
      ${route === 'timeline'
        ? null
        : html`
            <header class="app-header">
              ${route === 'edit' || route === 'add'
                ? html`<button
                    type="button"
                    class="app-home-button"
                    data-testid="header-home"
                    aria-label="Start"
                    onClick=${goHome}
                  >
                    <${HomeIcon} />
                  </button>`
                : null}
              <span class="app-account" data-testid="app-account"
                >${account.name || account.username || ''}</span
              >
              <button
                type="button"
                class="signout-button"
                data-testid="signout-button"
                disabled=${signingOut}
                onClick=${handleSignOut}
              >
                ${signingOut ? 'Wylogowywanie...' : 'Wyloguj'}
              </button>
            </header>
          `}
      <main class="app-content">${renderRoute()}</main>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById('app'));
