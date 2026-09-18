/**
 * E2E OneDrive File Picker stub.
 *
 * `installPicker` replaces `window.open` with a fake popup whose form submit is
 * captured instead of navigating. `pickFile`/`closePicker` then drive the *real*
 * v8 postMessage/MessagePort handshake that `public/picker.js` implements:
 *
 *   initialize -> (opener sends) activate
 *   authenticate -> token
 *   pick -> success   (or close -> CANCELLED)
 *
 * This exercises the fragile id/port conventions (top-level `message.id`,
 * `event.ports[0]`, `event.source === popup`) without touching Microsoft.
 */

/**
 * @param {import('@playwright/test').Page} page
 */
export async function installPicker(page) {
  await page.addInitScript(() => {
    window.__pickerState = { submitted: false, url: '', win: null };

    window.open = function fakeOpen() {
      const form = {
        _action: '',
        setAttribute(name, value) {
          if (name === 'action') this._action = value;
        },
        appendChild() {},
        submit() {
          window.__pickerState.url = this._action;
          window.__pickerState.submitted = true;
        },
      };
      const input = { setAttribute() {} };
      const fakeWin = {
        closed: false,
        document: {
          createElement(tag) {
            return tag === 'form' ? form : input;
          },
          body: { append() {} },
        },
        close() {
          this.closed = true;
        },
      };
      window.__pickerState.win = fakeWin;
      return fakeWin;
    };
  });
}

/**
 * Picks the given item through the real handshake.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ id: string, driveId?: string|null, '@sharePoint.endpoint'?: string|null }} item
 */
export async function pickFile(page, item) {
  return driveHandshake(page, { action: 'pick', item });
}

/**
 * Drives the handshake then asks the picker to close (CANCELLED path).
 *
 * @param {import('@playwright/test').Page} page
 */
export async function closePicker(page) {
  return driveHandshake(page, { action: 'close' });
}

async function driveHandshake(page, command) {
  await page.waitForFunction(() => window.__pickerState?.submitted === true);

  const channelId = await page.evaluate(() => {
    const url = new URL(window.__pickerState.url);
    return JSON.parse(url.searchParams.get('filePicker')).messaging.channelId;
  });

  await page.evaluate(
    ({ channelId, command }) =>
      new Promise((resolve, reject) => {
        const fakeWin = window.__pickerState.win;
        const channel = new MessageChannel();
        const openerPort = channel.port1;
        const pickerPort = channel.port2;
        const timeout = setTimeout(
          () => reject(new Error('picker handshake timed out')),
          5000
        );

        pickerPort.onmessage = (event) => {
          const message = event.data;
          if (message.type === 'activate') {
            pickerPort.postMessage({
              type: 'command',
              id: 1,
              data: {
                command: 'authenticate',
                type: 'oAuth',
                resource: 'https://my.microsoftpersonalcontent.com',
              },
            });
            return;
          }
          if (message.type === 'acknowledge') {
            // `close` produces no result command; the ack for id 2 is enough.
            if (command.action === 'close' && message.id === 2) {
              clearTimeout(timeout);
              resolve(true);
            }
            return;
          }
          if (message.type !== 'result') return;

          if (message.data?.result === 'token') {
            pickerPort.postMessage({
              type: 'command',
              id: 2,
              data:
                command.action === 'pick'
                  ? { command: 'pick', items: [command.item] }
                  : { command: 'close' },
            });
            return;
          }
          if (message.data?.result === 'success') {
            clearTimeout(timeout);
            resolve(true);
            return;
          }
          if (message.data?.error) {
            clearTimeout(timeout);
            reject(new Error(`picker error: ${JSON.stringify(message.data)}`));
          }
        };
        pickerPort.start();

        const initEvent = new MessageEvent('message', {
          data: { type: 'initialize', channelId },
          ports: [openerPort],
        });
        // `picker.js` ignores messages whose source isn't the popup.
        Object.defineProperty(initEvent, 'source', { value: fakeWin });
        window.dispatchEvent(initEvent);
      }),
    { channelId, command }
  );
}
