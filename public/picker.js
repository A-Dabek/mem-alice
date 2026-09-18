/**
 * OneDrive File Picker (v8) integration.
 *
 * Follows Microsoft's `javascript-basic-consumer` sample: open a popup, POST
 * a form carrying the picker configuration (querystring) plus a hidden
 * `access_token`, then drive the postMessage/MessagePort handshake
 * (initialize -> activate, authenticate -> token, pick -> items, close).
 *
 * Consumer (personal Microsoft accounts):
 *   authority: https://login.microsoftonline.com/consumers
 *   baseUrl:   https://onedrive.live.com/picker
 *   scopes:    OneDrive.ReadOnly
 */

import { trySilentPickerToken } from './auth.js';

const PICKER_BASE_URL = 'https://onedrive.live.com/picker';
const PICKER_WIDTH = 1080;
const PICKER_HEIGHT = 680;

function uuid() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const r = (Math.random() * 16) | 0;
    const value = char === 'x' ? r : (r & 0x3) | 0x8;
    return value.toString(16);
  });
}

/**
 * Opens the picker and resolves with the first picked item's Graph identity.
 *
 * @param {string} token - a OneDrive picker token, acquired BEFORE opening the
 *   window so any interactive consent popup is the first popup (not blocked).
 * @returns {Promise<{ id: string, driveId: string | null, endpoint: string | null }>}
 */
export function pickFile(token) {
  return new Promise((resolve, reject) => {
    const channelId = uuid();

    const options = {
      sdk: '8.0',
      entry: {
        oneDrive: {
          files: {},
        },
      },
      authentication: {},
      messaging: {
        origin: window.location.origin,
        channelId,
      },
      // Consumer (personal) accounts only support the OneDrive + Recent pivots.
      // Omitting `pivots` makes the picker show business-only pivots (Shared,
      // Groups) that fail/time out on personal accounts.
      typesAndSources: {
        mode: 'files',
        filters: ['photo', 'video'],
        pivots: {
          oneDrive: true,
          recent: true,
        },
      },
      selection: {
        mode: 'single',
      },
    };

    const win = window.open(
      '',
      'Picker',
      `width=${PICKER_WIDTH},height=${PICKER_HEIGHT}`
    );

    if (!win) {
      reject(new Error('POPUP_BLOCKED'));
      return;
    }

    let port = null;
    let settled = false;

    function finish(handler, value) {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      handler(value);
    }

    function onMessage(event) {
      if (!event.source || event.source !== win) return;

      const message = event.data;
      if (message?.type === 'initialize' && message.channelId === channelId) {
        port = event.ports[0];
        port.addEventListener('message', onChannelMessage);
        port.start();
        port.postMessage({ type: 'activate' });
      }
    }

    async function onChannelMessage(event) {
      const message = event.data;
      if (message.type !== 'command') return;

      const command = message.data;

      port.postMessage({ type: 'acknowledge', id: message.id });

      switch (command.command) {
        case 'authenticate': {
          try {
            console.log('[picker] authenticate', {
              type: command.type,
              resource: command.resource,
            });
            // The consumer picker always wants the OneDrive token; its
            // `resource` is informational. Requesting `${resource}/.default`
            // against /consumers fails with AADSTS9002332, so ignore it and
            // return the cached OneDrive picker token (never a popup here).
            const accessToken = await trySilentPickerToken();
            port.postMessage({
              type: 'result',
              id: message.id,
              data: { result: 'token', token: accessToken },
            });
          } catch (error) {
            console.error('[picker] authenticate failed', error);
            port.postMessage({
              type: 'result',
              id: message.id,
              data: {
                result: 'error',
                error: { code: 'unableToObtainToken', message: String(error?.message || error) },
              },
            });
          }
          break;
        }

        case 'pick': {
          port.postMessage({
            type: 'result',
            id: message.id,
            data: { result: 'success' },
          });
          try {
            if (!win.closed) win.close();
          } catch {}

          const item = Array.isArray(command.items) ? command.items[0] : null;
          if (!item) {
            finish(reject, new Error('NO_ITEM'));
            return;
          }
          finish(resolve, {
            id: item.id,
            driveId: item.driveId || item.parentReference?.driveId || null,
            endpoint: item['@sharePoint.endpoint'] || null,
          });
          break;
        }

        case 'close': {
          try {
            if (!win.closed) win.close();
          } catch {}
          finish(reject, new Error('CANCELLED'));
          break;
        }

        default:
          port.postMessage({
            type: 'result',
            id: message.id,
            data: {
              result: 'error',
              error: { code: 'unsupportedCommand', message: command.command },
            },
          });
      }
    }

    window.addEventListener('message', onMessage);

    (async () => {
      try {
        const queryString = new URLSearchParams({
          filePicker: JSON.stringify(options),
          locale: 'pl-PL',
        });
        const url = `${PICKER_BASE_URL}?${queryString}`;

        const form = win.document.createElement('form');
        form.setAttribute('action', url);
        form.setAttribute('method', 'POST');

        const input = win.document.createElement('input');
        input.setAttribute('type', 'hidden');
        input.setAttribute('name', 'access_token');
        input.setAttribute('value', token);
        form.appendChild(input);

        win.document.body.append(form);
        form.submit();
      } catch (error) {
        try {
          if (!win.closed) win.close();
        } catch {}
        finish(reject, error);
      }
    })();
  });
}
