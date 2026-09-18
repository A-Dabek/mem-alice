import { h, render } from 'https://esm.sh/preact@10.19.3';
import { useEffect, useState } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

import { getAccount, signOut } from './auth.js';
import { clearResolutionCache } from './onedriveCache.js';
import { SignInScreen } from './components/SignInScreen.js';
import { AddMilestoneScreen } from './components/AddMilestoneScreen.js';
import { TimelineScreen } from './components/TimelineScreen.js';

const html = htm.bind(h);

const ADD_ROUTE_HASH = '#add';

/**
 * Reads the current route from the URL hash. The Add screen is a genuine
 * route (`#add`) rather than in-memory tab state, so the browser's native
 * back button takes the user back to the Timeline.
 *
 * @returns {'add' | 'timeline'}
 */
function getRoute() {
  return window.location.hash === ADD_ROUTE_HASH ? 'add' : 'timeline';
}

/**
 * Root component.
 *
 * Holds the signed-in account (from MSAL, cached in sessionStorage by the
 * library - nothing sensitive is kept here) and the current route. Signed
 * out -> SignInScreen; signed in -> Timeline / Add.
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

  function goToAdd() {
    window.location.hash = ADD_ROUTE_HASH;
  }

  function goToTimeline() {
    window.location.hash = '';
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
      window.location.hash = '';
      setRoute('timeline');
      setSigningOut(false);
    }
  }

  return html`
    <div class="app-shell">
      <header class="app-header">
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
      <main class="app-content">
        ${route === 'add'
          ? html`<${AddMilestoneScreen} onSaved=${goToTimeline} />`
          : html`<${TimelineScreen} onAddMilestone=${goToAdd} />`}
      </main>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById('app'));
