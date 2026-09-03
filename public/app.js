import { h, render } from 'https://esm.sh/preact@10.19.3';
import { useEffect, useState } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

import { UnlockScreen } from './components/UnlockScreen.js';
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
 * Holds the app-wide `locked`/`unlocked` state (implied by whether
 * `cryptoKey` is set) and the in-memory AES key derived by the
 * `UnlockScreen`. The key never touches storage - it lives only in this
 * component's state for the lifetime of the page/session, per the "no
 * persisted passphrase" requirement.
 *
 * There is no tab bar: the Timeline is the only "home" screen, reached with
 * a single "Add" button that navigates to the `#add` route.
 */
function App() {
  const [cryptoKey, setCryptoKey] = useState(null);
  const [route, setRoute] = useState(getRoute());

  useEffect(() => {
    function handleHashChange() {
      setRoute(getRoute());
    }
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  if (!cryptoKey) {
    return html`<${UnlockScreen} onUnlock=${setCryptoKey} />`;
  }

  function goToAdd() {
    window.location.hash = ADD_ROUTE_HASH;
  }

  function goToTimeline() {
    window.location.hash = '';
  }

  return html`
    <div class="app-shell">
      <main class="app-content">
        ${route === 'add'
          ? html`<${AddMilestoneScreen} cryptoKey=${cryptoKey} onSaved=${goToTimeline} />`
          : html`<${TimelineScreen} cryptoKey=${cryptoKey} onAddMilestone=${goToAdd} />`}
      </main>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById('app'));
