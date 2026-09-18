# OneDrive File Picker PoC — Handoff

Status: **PoC working end to end.** The picker authenticates, lists files, lets
the user select one, and the picked item is resolved through the OneDrive API
using the picker's own token + `@sharePoint.endpoint` (see
[Picked item resolution](#picked-item-resolution-why-not-graph)).

This document replaces the previous E2E-encrypted design. Read it before
touching the server or `public/`.

## What changed (vs. the old app)

The app no longer encrypts anything and no longer uploads media. The server
stores only a title/subtitle plus Microsoft Graph references to files that live
in the user's OneDrive. There is no passphrase, no `crypto.js`, no `UnlockScreen`,
no `config` table, and no `salt`/`verifier` endpoints.

Removed:

- `public/crypto.js`, `public/crypto.test.js`
- `public/components/UnlockScreen.js`
- `server/routes/config.js` (old `/api/salt`, `/api/verifier`)

Added:

- `public/auth.js` — MSAL (CDN) sign-in + tokens
- `public/picker.js` — OneDrive File Picker v8 handshake
- `public/onedrive.js` — OneDrive API item/thumbnail resolution
- `public/components/SignInScreen.js`

Rewritten: `public/app.js`, `AddMilestoneScreen.js`, `TimelineScreen.js`,
`server/db.js`, `server/index.js`, `server/routes/milestones.js`,
`server/server.test.js`, `styles.css`, `index.html`, `prod.sh`.

## Server

### DB schema — `server/db.js`

```sql
CREATE TABLE IF NOT EXISTS milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  drive_item_id TEXT NOT NULL,
  drive_id TEXT,
  drive_endpoint TEXT,
  media_mime TEXT NOT NULL,
  item_name TEXT
);
```

No dates, no `config` table, no migrations. After pulling, delete the old DB
(`rm -f data/milestones.db*`) because the schema is incompatible.

### API — `server/index.js`, `server/routes/milestones.js`

- `GET /api/config` → `{ clientId: process.env.MS_CLIENT_ID ?? null, authority: process.env.MS_AUTHORITY || 'https://login.microsoftonline.com/consumers' }`
- `GET /api/milestones` → list, oldest first (`ORDER BY id ASC`)
- `POST /api/milestones` → `{ title, subtitle?, drive_item_id, drive_id?, drive_endpoint?, media_mime, item_name? }`
- `DELETE /api/milestones/:id`
- `DELETE /api/milestones` → bulk truncate (test/e2e isolation helper)

`express.json()` uses the default limit (no more 150 MB). Static assets keep the
no-store/no-cache headers. No auth, no MIME allowlist, and no Graph calls on the
server (all deferred, see [Debt](#debt-carried)).

### Environment

The sign-in flow is disabled unless the server has a client id:

```bash
MS_CLIENT_ID=f825bf3d-364e-4780-94d5-9651c72a61a8 pnpm start
```

Optional: `MS_AUTHORITY` (defaults to the consumer endpoint). `prod.sh` now
exports both (env-overridable). On boot the server logs
`WARN MS_CLIENT_ID is not set - sign-in is disabled` when it is missing, and the
UI shows `Brak konfiguracji logowania (MS_CLIENT_ID).`

### Azure assumptions (must hold)

- App registration: **Accounts in any org directory + personal Microsoft accounts**.
- SPA redirect URI: `http://localhost:3000`.
- Delegated permission: Microsoft Graph `Files.Read`.
- "Allow public client flows" is **not** required (that is for device code/ROPC;
  MSAL SPA uses auth-code + PKCE).

## Frontend

### `public/auth.js` (MSAL)

- Loads `msal-browser` 2.19.0 from `https://alcdn.msauth.net/browser/2.19.0/js/msal-browser.min.js`
  (added in `index.html`), reads config from `/api/config`.
- `cacheLocation: 'sessionStorage'`, `redirectUri: window.location.origin`,
  `handleRedirectPromise()` on load (failures logged, non-fatal).
- Scopes: `Files.Read` for Graph, `OneDrive.ReadOnly` for the picker.
- `getMsalApp()` clears the cached promise on failure so a config/transient error
  does not poison every later attempt.
- `getPickerToken()` (interactive fallback) is called **before** the picker window
  opens, so the consent popup has a user gesture.
- `trySilentPickerToken()` is silent-only and is the **only** token call used from
  inside the picker message flow.
- Errors carry a `code` (`MS_CLIENT_ID_MISSING`, `CONFIG_FETCH_FAILED`,
  `MSAL_NOT_LOADED`) which `SignInScreen` maps to Polish messages.

### `public/picker.js` (File Picker v8)

Consumer config: base URL `https://onedrive.live.com/picker`, authority
`consumers`, scope `OneDrive.ReadOnly`.

Options:

```js
{
  sdk: '8.0',
  entry: { oneDrive: { files: {} } },
  authentication: {},
  messaging: { origin: window.location.origin, channelId: uuid() },
  typesAndSources: {
    mode: 'files',
    filters: ['photo', 'video'],
    pivots: { oneDrive: true, recent: true }, // consumer only
  },
  selection: { mode: 'single' },
}
```

Handshake: `initialize` → grab `event.ports[0]` → `activate`; on the port handle
`authenticate` → `result/token`, `pick` → resolve `{ id, driveId, endpoint }`,
`close` → reject `CANCELLED`. The form is POSTed to `${baseUrl}?filePicker=…` with
a hidden `access_token`.

**Critical protocol detail:** command responses must use the **top-level** id
(`message.id`), not `message.data.id`. The message shape is
`event.data = { type:'command', id, data:{ command, type, resource } }`. Using
the nested id sends `undefined` and the picker reports `acknowledgeTimeout`
(everything then times out).

### `public/onedrive.js`

`resolveItem(id, driveId, endpoint, token)` →
`GET {endpoint}/drives/{driveId}/items/{id}` and reads `@content.downloadUrl`;
`getThumbnailUrl` uses `/thumbnails` (`value[0].medium.url`). Returns
`{ id, name, mime, downloadUrl, driveId }`. `endpoint` is the pick payload's
`@sharePoint.endpoint`; the request is authorised with the **picker**
(`OneDrive.ReadOnly`) token.

### Screens

- `app.js`: signed-out → `SignInScreen`; signed-in → `#add` route or Timeline.
- `AddMilestoneScreen.js`: "Wybierz z OneDrive" → `getPickerToken()` → `pickFile(token)`
  → `resolveItem(…, token)` → preview (`<img>`/`<video src=downloadUrl controls>`),
  title/subtitle, `POST /api/milestones` with the reference. No file input, no
  thumbnails, no size limit.
- `TimelineScreen.js`: list is plaintext title/subtitle; rows resolve via the
  OneDrive API lazily with `IntersectionObserver`; click expands full
  `downloadUrl`; broken item → placeholder; delete modal retained.

Test ids kept: `title-input`, `subtitle-input`, `save-button`, `add-error`,
`signin-button`, `picker-button`, `media-preview`, `milestone-item`,
`milestone-photo`, `milestone-video`, `milestone-thumb`, `delete-*`.

## Picked item resolution: why not Graph

An earlier revision resolved picked items from `https://graph.microsoft.com`
with a `Files.Read` token. For personal (consumer) accounts that fails with:

```json
{ "error": { "code": "InvalidAuthenticationToken",
  "message": "Protocol 'Bearer' failed to validate because The token could not be read." } }
```

The consumer picker issues a token for the **OneDrive resource**
(`https://api.onedrive.com`), not Graph. When acquired against the `/consumers`
authority it is not a Graph-readable JWT, and Graph also expects a different
download annotation. The picker docs spell out the supported flow:

1. The `pick` payload always carries `id`, `parentReference.driveId` and
   `@sharePoint.endpoint`.
2. Build `{@sharePoint.endpoint}/drives/{parentReference.driveId}/items/{id}`.
3. Send **the same picker token** (`OneDrive.ReadOnly`).
4. Read `@content.downloadUrl` (OneDrive API), not
   `@microsoft.graph.downloadUrl` (Graph).

`public/onedrive.js` implements exactly this; the picked `@sharePoint.endpoint`
is persisted as `milestones.drive_endpoint` so the Timeline can resolve rows
after reload. This retires debt #7.

## Debugging notes / errors already hit

| Symptom | Cause | Fix |
| --- | --- | --- |
| `MS_CLIENT_ID is not configured` | server started without env | `MS_CLIENT_ID=… pnpm start` |
| `AADSTS70000 invalid_grant` | silent request for `OneDrive.ReadOnly` before consent | acquire picker token interactively before opening the picker |
| `empty_window_error` / `popup_window_error` | interactive popup from inside picker flow | only `trySilentPickerToken()` in the handler |
| `AADSTS9002332` "do not use /consumers" | requesting `${resource}/.default` (`https://api.onedrive.com`) | ignore `command.resource`; return `OneDrive.ReadOnly` |
| `InvalidAuthenticationToken` "token could not be read" | Graph called with the consumer picker token | resolve via `@sharePoint.endpoint` + picker token (`public/onedrive.js`) |
| `acknowledgeTimeout` / `ApiError: Timed out` | response ids used `message.data.id` | use `message.id` |
| business pivots (Shared/Groups) fail on personal | `pivots` omitted → business defaults | `pivots: { oneDrive: true, recent: true }` |

Useful console lines: `[picker] authenticate {type, resource}` and
`[signin]` / `[app]` errors.

## Verify / commands

```bash
rm -f data/milestones.db*        # schema change
MS_CLIENT_ID=<app-id> pnpm start # http://localhost:3000
pnpm test                        # 8/8 unit tests
```

Browser: sign in → pick photo/mp4 → preview renders → Timeline renders stored
rows (thumbnail + click-to-expand) → delete works.

## Debt carried

Server-side ID-token + email guard (#1–2), E2E rewrite (#3, specs still import
the removed `public/crypto.js` and use old selectors — `pnpm e2e` is expected to
fail), thumbnail caching (#4), robust expiry/deleted-item states (#5, #11),
server MIME allowlist (#6), migration (#8), redirect fallback + mobile (#9),
sign-out/account switching (#10), prod HTTPS redirect (#11), broader media
types (#12), full test coverage (#13), CSRF (#14).

`playwright.config.js`'s webServer healthcheck was repointed from `/api/salt`
to `/api/config`.

## References

- File Picker overview: https://learn.microsoft.com/en-us/onedrive/developer/controls/file-pickers/?view=odsp-graph-online
- v8 config schema: https://learn.microsoft.com/en-us/onedrive/developer/controls/file-pickers/v8-schema?view=odsp-graph-online
- Samples index: https://github.com/OneDrive/samples/tree/master/samples/file-picking
- Consumer sample used here: https://github.com/OneDrive/samples/tree/master/samples/file-picking/javascript-basic-consumer
- Consumer (ODC) TS sample: https://github.com/OneDrive/samples/tree/master/samples/file-picking/typescript-sdk-odc
- MSAL browser CDN: https://alcdn.msauth.net/browser/2.19.0/js/msal-browser.min.js
- MSAL issue on MSA scope/consent: https://github.com/AzureAD/microsoft-authentication-library-for-js/issues/3109
- AADSTS error codes: https://learn.microsoft.com/en-us/entra/identity-platform/reference-error-codes
