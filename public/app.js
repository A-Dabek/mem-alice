import { h, render } from 'https://esm.sh/preact@10.19.3';
import { useState } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

import { UnlockScreen } from './components/UnlockScreen.js';
import { AddMilestoneScreen } from './components/AddMilestoneScreen.js';
import { TimelineScreen } from './components/TimelineScreen.js';

const html = htm.bind(h);

/**
 * Root component.
 *
 * Holds the app-wide `locked`/`unlocked` state (implied by whether
 * `cryptoKey` is set) and the in-memory AES key derived by the
 * `UnlockScreen`. The key never touches storage - it lives only in this
 * component's state for the lifetime of the page/session, per the "no
 * persisted passphrase" requirement.
 *
 */
function App() {
  const [cryptoKey, setCryptoKey] = useState(null);
  const [activeTab, setActiveTab] = useState('timeline');

  if (!cryptoKey) {
    return html`<${UnlockScreen} onUnlock=${setCryptoKey} />`;
  }

  return html`
    <div class="app-shell">
      <main class="app-content">
        ${activeTab === 'add'
          ? html`<${AddMilestoneScreen}
              cryptoKey=${cryptoKey}
              onSaved=${() => setActiveTab('timeline')}
            />`
          : html`<${TimelineScreen}
              cryptoKey=${cryptoKey}
              onAddMilestone=${() => setActiveTab('add')}
            />`}
      </main>
      <nav class="tab-bar">
        <button
          type="button"
          data-testid="tab-timeline"
          class=${activeTab === 'timeline' ? 'active' : ''}
          onClick=${() => setActiveTab('timeline')}
        >
          Timeline
        </button>
        <button
          type="button"
          data-testid="tab-add"
          class=${activeTab === 'add' ? 'active' : ''}
          onClick=${() => setActiveTab('add')}
        >
          Add
        </button>
      </nav>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById('app'));
