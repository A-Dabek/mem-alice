# OneDrive File Picker PoC — Handoff

Status: **PoC working end to end, now authenticated.** The picker authenticates,
lists files, lets the user select one, and the picked item is resolved through
the OneDrive API using the picker's own token + `@sharePoint.endpoint` (see
[Picked item resolution](#picked-item-resolution-why-not-graph)). The SPA signs
in with MSAL, calls `/api/milestones` with a Bearer ID token, and the server
verifies it against an email allowlist.

This document replaces the previous E2E-encrypted design. Read it before
touching the server or `public/`.

## What changed (vs. the old app)

The app no longer encrypts anything and no longer uploads media. The server
stores only a title/subtitle plus the picker references to files that live in
the user's OneDrive. There is no passphrase, no `crypto.js`, no `UnlockScreen`,
no `config` table, and no `salt`/`verifier` endpoints.

Added/rewritten: `public/auth.js`, `public/picker.js`, `public/onedrive.js`,
`public/onedriveCache.js`, `public/components/*`, `server/db.js`,
`server/index.js`, `server/auth.js`, `server/routes/milestones.js`, `prod.sh`,
`tests/e2e/*`.

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
  media_width INTEGER,
  media_height INTEGER,
  item_name TEXT,
  position INTEGER
);
```

No dates, no `config` table, no migrations (deferred debt #8). The app is
pre-prod, so schema changes may require recreating the dev DB. `server/db.js`
does backfill the additive `media_width`/`media_height`/`position` columns on an
existing dev DB so old rows survive; `position` is seeded from the (date-free)
insertion order (`UPDATE … SET position = id WHERE position IS NULL`).

### API — `server/index.js`, `server/routes/milestones.js`, `server/auth.js`

- `GET /api/config` → `{ clientId: process.env.MS_CLIENT_ID ?? null, authority: process.env.MS_AUTHORITY || 'https://login.microsoftonline.com/consumers' }` (public)
- `GET /api/milestones` → list ordered by mutable `position` ASC, `id` ASC
  (`position` seeded from insertion order, re-orderable)
- `POST /api/milestones` → `{ title, subtitle?, drive_item_id, drive_id?, drive_endpoint?, media_mime, media_width?, media_height?, item_name? }` (appends last: `position = MAX(position) + 1`)
- `POST /api/milestones/:id/move` → `{ direction: 'up' | 'down' }`; swaps
  `position` with the adjacent row in a transaction (edge rows are a no-op,
  400 bad id/direction, 404 unknown) and returns the full re-ordered list
- `DELETE /api/milestones/:id`
- `DELETE /api/milestones` → bulk truncate (test/e2e isolation helper)

All `/api/milestones` routes go through `server/auth.js`:

- Verifies the SPA's ID token: OIDC discovery (`authority`), `jose`
  `jwtVerify` (RS256) against the discovered issuer + JWKS, `aud === MS_CLIENT_ID`,
  `exp`.
- Identity = `email || preferred_username`; must be in `ALLOWED_EMAILS`
  (comma-separated, case-insensitive). Empty allowlist denies everyone.
- Mutations require a same-origin `Origin` (or `Referer`) or an origin in
  `ALLOWED_ORIGINS` (CSRF defense-in-depth).
- `AUTH_DISABLED=1` bypasses auth for local dev, but is ignored (with a WARN)
  when `NODE_ENV=production`.
- `POST` also validates the MIME allowlist (`image/jpeg,png,gif,webp`,
  `video/mp4`), field length caps, positive-integer `media_width`/`media_height`,
  and re-checks the `drive_endpoint` host (`*.onedrive.com`, `*.sharepoint.com`,
  `*.live.com`, `*.svc.ms`, `*.microsoftpersonalcontent.com`). The server never
  fetches the endpoint.

`express.json()` uses the default limit (no media upload). Static assets and API
responses keep no-store/no-cache headers. The server never calls Graph and
never logs request bodies.

### Vendored MSAL

The MSAL CDN is deprecated as of v3.0.0, so MSAL **v4.28.1 is vendored from
npm** (`@azure/msal-browser`) and served from the installed package:

- `server/index.js` resolves the package's `dist` dirs and mounts them at
  `/vendor/msal-browser` and `/vendor/msal-common`.
- `public/index.html` drops the CDN `<script>` and adds an import map mapping
  `@azure/msal-browser` / `@azure/msal-common/browser` to those paths.
- `public/auth.js` dynamically imports `PublicClientApplication`.

MSAL v5 was rejected: it makes the COOP redirect bridge mandatory (new
same-origin bridge page + Entra redirect-URI change), which is out of scope here.

### Environment

The sign-in flow is disabled unless the server has a client id:

```bash
MS_CLIENT_ID=f825bf3d-364e-4780-94d5-9651c72a61a8 \
ALLOWED_EMAILS=you@example.com pnpm start
```

Optional: `MS_AUTHORITY` (defaults to the consumer endpoint), `ALLOWED_ORIGINS`.
For local dev without tokens: `AUTH_DISABLED=1`. `prod.sh` exports
`MS_CLIENT_ID`/`MS_AUTHORITY`/`ALLOWED_EMAILS` and sets `NODE_ENV=production`
(so `AUTH_DISABLED` cannot weaken prod). On boot the server logs a WARN when
`MS_CLIENT_ID` is missing and when `AUTH_DISABLED` is active/ignored.

Easiest setup: copy `.env.example` → `.env` (gitignored) and fill it in.
`pnpm start:env` loads it via `node --env-file-if-exists`; `./prod.sh` sources it
(real env vars win, `NODE_ENV` is forced to production).

### Azure assumptions (must hold)

- App registration: **Accounts in any org directory + personal Microsoft accounts**.
- SPA redirect URI: `http://localhost:3000` (prod: the real origin).
- Delegated permission: `OneDrive.ReadOnly` (consumer). Graph `Files.Read` is
  **not** used.
- "Allow public client flows" is **not** required (MSAL SPA uses auth-code + PKCE).

## Frontend

### `public/auth.js` (MSAL v4)

- Imports `@azure/msal-browser` via the import map; config from `/api/config`.
- `cacheLocation: 'sessionStorage'`, `redirectUri: window.location.origin`,
  `initialize()` + `handleRedirectPromise()` on first use (failures logged,
  non-fatal).
- Scopes: `openid profile email` for sign-in; `OneDrive.ReadOnly` for the picker.
  `getIdToken()` pairs `openid` with `OneDrive.ReadOnly` because OIDC-only
  silent requests fail on MSA with `AADSTS70000 invalid_grant`.
- `getPickerToken()` (interactive fallback) is called **before** the picker
  iframe opens, so the consent popup has a user gesture.
- `trySilentPickerToken()` is silent-only and is the **only** token call used from
  inside the picker message flow.
- `fetchWithAuth()` attaches `Authorization: Bearer <id_token>` best-effort.
- `signOut()` clears the account via `logoutPopup`.
- Errors carry a `code` (`MS_CLIENT_ID_MISSING`, `CONFIG_FETCH_FAILED`,
  `MSAL_NOT_LOADED`, `ID_TOKEN_MISSING`) which screens map to Polish messages.

### `public/picker.js` (File Picker v8) — FROZEN

Consumer config: base URL `https://onedrive.live.com/picker`, authority
`consumers`, scope `OneDrive.ReadOnly`.

Hosting: a self-created full-screen **inline iframe overlay** (no popup). The
overlay is `position: fixed; inset: 0; 100dvh` with `z-index` above the delete
modal; it contains a header + Cancel button and
`<iframe name="OneDrivePicker">`. Opening locks body scroll, marks `#app`
`inert` (focus trap), and focuses Cancel; Escape or Cancel rejects `CANCELLED`.
The form is created in the host document and mounted into the iframe's
about:blank document (required so submitting navigates the iframe), then
submitted with a hidden `access_token`. `finish()` removes the overlay, the
message listener and the scroll lock instead of closing a window. Any setup
failure rejects `PICKER_LOAD_FAILED`. The picker options set
`accessibility.enableFocusTrap: true` and `entry.oneDrive.photos: {}` so the
consumer picker opens directly on the **Photos** pivot instead of "My files"
(entry-targeted pivots render even when absent from `typesAndSources.pivots`).
`typesAndSources.pivots.oneDrive`/`recent` are set `false` so the nav shows only
Photos; `leftNav.enabled: false` is the fallback if the sidebar must be removed
entirely.

Handshake: `initialize` → grab `event.ports[0]` → `activate`; on the port handle
`authenticate` → `result/token`, `pick` → resolve `{ id, driveId, endpoint }`,
`close` → reject `CANCELLED`.

**Critical protocol detail:** command responses must use the **top-level** id
(`message.id`), not `message.data.id`. The picker reports `acknowledgeTimeout`
otherwise. Ignore `command.resource` for consumer.

### `public/onedrive.js`

- `assertEndpoint(endpoint)` — https + Microsoft host allowlist; missing →
  `https://api.onedrive.com/v1.0`; invalid → `ENDPOINT_INVALID`.
- `odFetch(url, token)` — Bearer request; typed errors `AUTH_REQUIRED`
  (401/403), `NOT_FOUND` (404), `NETWORK_ERROR` (fetch reject), `SERVER_ERROR`
  (other non-2xx), each carrying `.status` where HTTP-backed.
- `resolveItem(id, driveId, endpoint, token)` — one request
  `GET …/items/{id}?$expand=thumbnails($select=large,medium,small)`, returns
  `{ id, name, mime, downloadUrl, thumbUrl, driveId, width, height }` where
  `width`/`height` come from the item's `image || photo || video` facet (null
  when absent). Falls back to the item GET + `/thumbnails` two-request path if
  the combined call errors or lacks `@content.downloadUrl`.
- `getThumbnailUrl` delegates to `resolveItem` (best-effort, null on failure).
- Reads `@content.downloadUrl` (OneDrive API), not `@microsoft.graph.downloadUrl`.
  Do NOT call `graph.microsoft.com` for consumer items.

### `public/onedriveCache.js`

sessionStorage read-through keyed by account + `drive_item_id`; 50-min TTL
(`@content.downloadUrl` lives ~1h); failures are never cached;
`clearResolutionCache()` is the sign-out hook.

### Screens

- `app.js`: signed-out → `SignInScreen`; signed-in → app shell with the account
  name + "Wyloguj" and (on the Timeline route) the `edit-mode-toggle` in the
  header top-left; owns `editMode` and passes it down. Then `#add` route or
  Timeline.
- `AddMilestoneScreen.js`: "Wybierz z OneDrive" → `getPickerToken()` →
  `pickFile(token)` → `resolveItem(…, token)` → preview, then
  `POST /api/milestones` via `fetchWithAuth` with the reference plus the resolved
  `media_width`/`media_height`. No file input, no size limit. `.media-preview` is
  always rendered with an inline `aspect-ratio` (`width/height`, else video
  `16/9`, else `4/3`) and hosts the "Wybierz z OneDrive" button as its idle
  content (the button reserves the media slot); it shows "Wybieranie..." while
  picking and the `<img>`/`<video src=downloadUrl controls>` once chosen
  (`PICK_ERROR` under the slot on failure). A "Anuluj" button (`clear-media`)
  drops the chosen item so it can be re-picked.
- `TimelineScreen.js`: plaintext title/subtitle; rows resolve lazily
  (IntersectionObserver, **silent-only**) through the cache. States:
  `loading | ready | needs-auth | gone | error`, with gesture-safe
  "Zaloguj ponownie" (re-auth) and "Spróbuj ponownie" (retry) buttons. Click
  expands full media; delete modal retained. Placeholders, thumbnails and
  expanded media all reserve the same inline `aspect-ratio` (resolved intrinsic
  size, else stored `media_width`/`media_height`, else MIME fallback; thumbnails
  `object-fit: cover`, expanded media `contain`). Expanded photos keep the
  thumbnail as `src` and swap to the preloaded full-resolution URL only once it
  is decoded (videos use `poster`), so expanding never flashes a blank box.
  An edit-mode toggle (`edit-mode-toggle`, pencil/check) sits in the app header
  top-left (next to the account/logout, timeline route only, owned by `app.js`)
  and overlays circular emoji controls on each media frame: delete (top-left),
  move up (top-right), move down (bottom-right). Move up/down are disabled at
  the first/last row and ask for confirmation via a modal reusing the
  delete-modal markup (`move-confirm`/`move-cancel`), then `POST …/:id/move` and
  replace the list with the returned ordering. In edit mode expansion is
  disabled (no load button, `isExpanded` forced false, expanded/full-media state
  cleared) and Escape dismisses whichever confirmation modal is open.

Test ids kept: `title-input`, `subtitle-input`, `save-button`, `add-error`,
`signin-button`, `picker-button`, `picker-cancel`, `media-preview`,
`milestone-item`, `milestone-photo`, `milestone-video`, `milestone-thumb`,
`delete-*`, plus `app-account`, `signout-button`, `milestone-reauth`,
`milestone-retry`. Edit/move adds `edit-mode-toggle`, `move-up-button`,
`move-down-button`, `move-confirm-dialog`, `move-confirm`, `move-cancel`,
`move-error`.

## Picked item resolution: why not Graph

An earlier revision resolved picked items from `https://graph.microsoft.com`
with a `Files.Read` token. For personal (consumer) accounts that fails with
`InvalidAuthenticationToken: The token could not be read.` The consumer picker
issues a token for the **OneDrive resource** (`https://api.onedrive.com`), not
Graph, and the OneDrive API uses `@content.downloadUrl` (not Graph's
`@microsoft.graph.downloadUrl`). `public/onedrive.js` implements the supported
flow and persists `@sharePoint.endpoint` as `milestones.drive_endpoint`.

## Debugging notes / errors already hit

| Symptom | Cause | Fix |
| --- | --- | --- |
| `MS_CLIENT_ID is not configured` | server started without env | `MS_CLIENT_ID=… pnpm start` |
| `AADSTS70000 invalid_grant` (silent `openid profile email`) | MSA rejects OIDC-only silent refresh | pair `openid` with a consented resource scope (`OneDrive.ReadOnly`) |
| `AADSTS70000 invalid_grant` (picker) | silent request for `OneDrive.ReadOnly` before consent | acquire picker token interactively before opening the picker |
| `empty_window_error` / `popup_window_error` | interactive popup from inside picker flow | only `trySilentPickerToken()` in the handler |
| `AADSTS9002332` "do not use /consumers" | requesting `${resource}/.default` | ignore `command.resource`; return `OneDrive.ReadOnly` |
| `InvalidAuthenticationToken` "token could not be read" | Graph called with the consumer picker token | resolve via `@sharePoint.endpoint` + picker token |
| `acknowledgeTimeout` / `ApiError: Timed out` | response ids used `message.data.id` | use `message.id` |
| business pivots (Shared/Groups) fail on personal | `pivots` omitted | `pivots: { oneDrive: true, recent: true }` |
| `403 Origin not allowed` on Add/Delete | mutation Origin not same-host/allowlisted | use same-origin, or set `ALLOWED_ORIGINS` |
| `403 Account not allowed` | token identity not in `ALLOWED_EMAILS` | add the account email |

## Verify / commands

```bash
pnpm test                         # 48 unit tests
pnpm test:e2e                     # 14 E2E tests (stubbed auth/picker/OneDrive)
MS_CLIENT_ID=<app-id> ALLOWED_EMAILS=<email> pnpm start
```

Browser: sign in → pick photo/mp4 → preview renders → Timeline renders stored
rows (thumbnail + click-to-expand) → delete works → "Wyloguj" returns to the
gate.

## Debt carried

See `docs/onedrive-poc-debt.md`. Remaining highlights: migration strategy (#8),
redirect fallback + mobile (#9), broader media types (#12), prod
HTTPS/HSTS/CSP (#11).

## References

- File Picker overview: https://learn.microsoft.com/en-us/onedrive/developer/controls/file-pickers/
- v8 config schema: https://learn.microsoft.com/en-us/onedrive/developer/controls/file-pickers/v8-schema
- Samples index: https://github.com/OneDrive/samples/tree/master/samples/file-picking
- MSAL v2→v3 migration: https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-browser/docs/v2-migration.md
- MSAL v3→v4 migration: https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-browser/docs/v3-migration.md
- MSAL v4→v5 migration: https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-browser/docs/v4-migration.md
