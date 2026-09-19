/**
 * OneDrive File Picker (v8) integration.
 *
 * Follows Microsoft's `javascript-basic-consumer` sample, but hosts the picker
 * in an inline full-screen iframe overlay instead of a popup: create the
 * overlay + `<iframe name="OneDrivePicker">`, POST a form carrying the picker
 * configuration (querystring) plus a hidden `access_token` into the iframe's
 * about:blank document, then drive the postMessage/MessagePort handshake
 * (initialize -> activate, authenticate -> token, pick -> items, close).
 *
 * The inline overlay avoids popup blockers and works in in-app browsers. The
 * critical protocol conventions (top-level `message.id`, `event.ports[0]`,
 * `event.source === frame.contentWindow`, consumer pivots, ignoring
 * `command.resource`) are unchanged.
 *
 * Consumer (personal Microsoft accounts):
 *   authority: https://login.microsoftonline.com/consumers
 *   baseUrl:   https://onedrive.live.com/picker
 *   scopes:    OneDrive.ReadOnly
 */

import { trySilentPickerToken } from './auth.js';

const PICKER_BASE_URL = 'https://onedrive.live.com/picker';
const PICKER_FRAME_NAME = 'OneDrivePicker';

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
 * @param {string} code
 * @param {unknown} [cause]
 * @returns {Error & { cause?: unknown }}
 */
function pickerError(code, cause) {
  const error = new Error(code);
  if (cause !== undefined) error.cause = cause;
  return error;
}

/**
 * Builds and mounts the full-screen picker overlay. The overlay is appended to
 * `<body>` (sibling of `#app`), which is marked `inert` while it is open so
 * focus cannot escape back into the app. Escape and the Cancel button invoke
 * `onCancel`.
 *
 * @param {() => void} onCancel
 * @returns {{ frame: HTMLIFrameElement, destroy: () => void }}
 */
function createOverlay(onCancel) {
  const previouslyFocused = document.activeElement;
  const previousOverflow = document.body.style.overflow;
  const app = document.getElementById('app');

  const overlay = document.createElement('div');
  overlay.className = 'picker-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Wybierz plik z OneDrive');

  const header = document.createElement('div');
  header.className = 'picker-overlay-header';

  const title = document.createElement('p');
  title.className = 'picker-overlay-title';
  title.textContent = 'Wybierz plik z OneDrive';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'picker-overlay-cancel';
  cancel.setAttribute('data-testid', 'picker-cancel');
  cancel.textContent = 'Anuluj';
  cancel.addEventListener('click', () => onCancel());

  header.append(title, cancel);

  const frame = document.createElement('iframe');
  frame.className = 'picker-overlay-frame';
  frame.name = PICKER_FRAME_NAME;
  frame.title = 'OneDrive';
  frame.setAttribute('allow', 'clipboard-write');

  overlay.append(header, frame);

  // Focus trap: Escape cancels; the only focusable elements are the Cancel
  // button and the iframe, and `#app` is inert, so Tab cannot escape.
  function onKeydown(event) {
    if (event.key === 'Escape' || event.key === 'Esc') {
      event.preventDefault();
      onCancel();
    }
  }

  document.body.style.overflow = 'hidden';
  if (app) app.inert = true;
  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKeydown);
  cancel.focus();

  let destroyed = false;
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    document.removeEventListener('keydown', onKeydown);
    overlay.remove();
    document.body.style.overflow = previousOverflow;
    if (app) app.inert = false;
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus();
    }
  }

  return { frame, destroy };
}

/**
 * Opens the picker in an inline iframe overlay and resolves with the first
 * picked item's identity.
 *
 * @param {string} token - a OneDrive picker token, acquired BEFORE opening the
 *   picker so any interactive consent popup is the first popup (not blocked).
 * @returns {Promise<{ id: string, driveId: string | null, endpoint: string | null }>}
 */
export function pickFile(token) {
  return new Promise((resolve, reject) => {
    const channelId = uuid();

    const options = {
      sdk: '8.0',
      entry: {
        // Open straight into the consumer Photos pivot instead of "My files".
        oneDrive: {
          photos: {},
        },
      },
      authentication: {},
      messaging: {
        origin: window.location.origin,
        channelId,
      },
      // Consumer (personal) accounts only support the OneDrive + Recent pivots.
      // Disable them so the nav shows only the entry-targeted Photos pivot
      // (an entry-targeted pivot renders even when not enabled here); leaving
      // `pivots` out entirely would surface business-only pivots (Shared,
      // Groups) that fail/time out on personal accounts.
      typesAndSources: {
        mode: 'files',
        filters: ['photo', 'video'],
        pivots: {
          oneDrive: false,
          recent: false,
        },
      },
      selection: {
        mode: 'single',
      },
      // The picker is the only content of a modal overlay here, so keep its
      // tab-stops looping inside the component.
      accessibility: {
        enableFocusTrap: true,
      },
    };

    let port = null;
    let settled = false;
    let overlay = null;

    function finish(handler, value) {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      if (overlay) overlay.destroy();
      handler(value);
    }

    function cancel() {
      finish(reject, pickerError('CANCELLED'));
    }

    try {
      overlay = createOverlay(cancel);
    } catch (error) {
      finish(reject, pickerError('PICKER_LOAD_FAILED', error));
      return;
    }

    const win = overlay.frame.contentWindow;

    if (!win) {
      finish(reject, pickerError('PICKER_LOAD_FAILED'));
      return;
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

          const item = Array.isArray(command.items) ? command.items[0] : null;
          if (!item) {
            finish(reject, pickerError('NO_ITEM'));
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
          cancel();
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

        // The form is created in the host document and mounted into the
        // iframe's about:blank document, so submitting it navigates the iframe
        // (not the host page).
        const form = document.createElement('form');
        form.setAttribute('action', url);
        form.setAttribute('method', 'POST');

        const input = document.createElement('input');
        input.setAttribute('type', 'hidden');
        input.setAttribute('name', 'access_token');
        input.setAttribute('value', token);
        form.appendChild(input);

        const target = win.document.body || win.document.documentElement;
        target.appendChild(form);
        form.submit();
      } catch (error) {
        finish(reject, pickerError('PICKER_LOAD_FAILED', error));
      }
    })();
  });
}
