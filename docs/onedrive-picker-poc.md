# OneDrive File Picker PoC — Handoff

Status: **PoC working up to picking.** The picker authenticates, lists files and
lets the user select one. **Known blocker: picking returns HTTP 401** (see
[Known issue](#known-issue-401-when-picking)).

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
- `public/graph.js` — Graph item/thumbnail resolution (unused until 401 fixed)
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
  media_mime TEXT NOT NULL,
  item_name TEXT
);
```

No dates, no `config` table, no migrations. After pulling, delete the old DB
(`rm -f data/milestones.db*`) because the schema is incompatible.

### API — `server/index.js`, `server/routes/milestones.js`

- `GET /api/config` → `{ clientId: process.env.MS_CLIENT_ID ?? null, authority: process.env.MS_AUTHORITY || 'https://login.microsoftonline.com/consumers' }`
- `GET /api/milestones` → list, oldest first (`ORDER BY id ASC`)
- `POST /api/milestones` → `{ title, subtitle?, drive_item_id, drive_id?, media_mime, item_name? }`
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
`authenticate` → `result/token`, `pick` → resolve `{ id, driveId }`, `close` →
reject `CANCELLED`. The form is POSTed to `${baseUrl}?filePicker=…` with a hidden
`access_token`.

**Critical protocol detail:** command responses must use the **top-level** id
(`message.id`), not `message.data.id`. The message shape is
`event.data = { type:'command', id, data:{ command, type, resource } }`. Using
the nested id sends `undefined` and the picker reports `acknowledgeTimeout`
(everything then times out).

### `public/graph.js` (currently blocked)

`resolveItem(id, driveId)` → `GET /me/drive/items/{id}?$select=id,name,file,image,video,parentReference`
and reads `@microsoft.graph.downloadUrl`; `getThumbnailUrl` uses `/thumbnails`
(`thumbnails[0].medium.url`). Returns `{ id, name, mime, downloadUrl, driveId }`.

### Screens

- `app.js`: signed-out → `SignInScreen`; signed-in → `#add` route or Timeline.
- `AddMilestoneScreen.js`: "Wybierz z OneDrive" → `getPickerToken()` → `pickFile(token)`
  → `resolveItem` → preview (`<img>`/`<video src=downloadUrl controls>`), title/subtitle,
  `POST /api/milestones` with the reference. No file input, no thumbnails, no size limit.
- `TimelineScreen.js`: list is plaintext title/subtitle; rows resolve via Graph
  lazily with `IntersectionObserver`; click expands full `downloadUrl`; broken
  item → placeholder; delete modal retained.

Test ids kept: `title-input`, `subtitle-input`, `save-button`, `add-error`,
`signin-button`, `picker-button`, `media-preview`, `milestone-item`,
`milestone-photo`, `milestone-video`, `milestone-thumb`, `delete-*`.

## Known issue: 401 when picking

After selecting a file, the follow-up Graph call returns **401**. The picker
itself lists images fine; the failure is after `pick`, in `resolveItem`
(`GET /me/drive/items/{id}`) or in `getGraphToken()`.

Suspects (in order):

1. Picked item id is an **api.onedrive.com** (consumer) id, not a Graph id, so
   `/me/drive/items/{id}` 401s/404s. Use the pick payload's
   `@sharepoint.endpoint` / `parentReference.driveId`, or the picker's
   `commands.pick.select.urls.download = true` to get a download URL directly.
2. Graph token audience/consent: the sign-in token is `Files.Read`; confirm it
   is actually attached (`Authorization: Bearer …`) and not empty.
3. The picker item may expose its own download URL in `command.items[0]` — inspect
   the raw pick payload (log `command.items`) before adding more Graph calls.

Debt #7 in the plan covers `@sharePoint.endpoint`/`driveId` resolution.

## Debugging notes / errors already hit

| Symptom | Cause | Fix |
| --- | --- | --- |
| `MS_CLIENT_ID is not configured` | server started without env | `MS_CLIENT_ID=… pnpm start` |
| `AADSTS70000 invalid_grant` | silent request for `OneDrive.ReadOnly` before consent | acquire picker token interactively before opening the picker |
| `empty_window_error` / `popup_window_error` | interactive popup from inside picker flow | only `trySilentPickerToken()` in the handler |
| `AADSTS9002332` "do not use /consumers" | requesting `${resource}/.default` (`https://api.onedrive.com`) | ignore `command.resource`; return `OneDrive.ReadOnly` |
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

Browser: sign in → pick photo/mp4 → (401 currently) → Timeline renders stored
rows → delete works.

## Debt carried

Server-side ID-token + email guard (#1–2), E2E rewrite (#3, specs still import
the removed `public/crypto.js` and use old selectors — `pnpm e2e` is expected to
fail), thumbnail caching (#4), robust expiry/deleted-item states (#5, #11),
server MIME allowlist (#6), `@sharePoint.endpoint`/`driveId` resolution (#7),
migration (#8), redirect fallback + mobile (#9), sign-out/account switching
(#10), prod HTTPS redirect (#11), broader media types (#12), full test coverage
(#13), CSRF (#14).

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
