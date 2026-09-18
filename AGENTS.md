# mem-alice — Agent Guidelines

## Project Overview
- OneDrive-backed milestones (PoC): the server stores only a title/subtitle plus
  the picker references to files living in the user's OneDrive. No encryption, no
  media upload.
- Full handoff + protocol/debug notes: `docs/onedrive-picker-poc.md` — read it
  before touching `public/` or the schema.
- Known gaps / corners cut: `docs/onedrive-poc-debt.md` — read before expanding
  scope.
- Execution plan / progress: `docs/onedrive-execution-plan.md`.
- Consumer (personal Microsoft accounts) only; business/SharePoint is out of
  scope by design.
- DB `server/db.js` `milestones` ordered by `id ASC` (no dates anywhere).

## Schema & API
- `milestones(id, title, subtitle DEFAULT '', drive_item_id NOT NULL, drive_id,
  drive_endpoint, media_mime NOT NULL, item_name)`. No migrations; the app is
  pre-prod (DB migration strategy is deferred debt #8).
- `server/index.js` serves the vendored MSAL v4 ESM from
  `/vendor/msal-browser` + `/vendor/msal-common` (resolved from `node_modules`);
  `GET /api/config` → `{clientId, authority}` is public.
- `server/routes/milestones.js`: `GET /` (oldest first), `POST /`
  `{title,subtitle?,drive_item_id,drive_id?,drive_endpoint?,media_mime,item_name?}`,
  `DELETE /:id`, bulk `DELETE /` (test helper). Validates a MIME allowlist
  (`image/jpeg,png,gif,webp`, `video/mp4`), length caps, and re-checks the
  `drive_endpoint` host.
- `server/auth.js` verifies the SPA's ID token (OIDC discovery + `jose`
  RS256/JWKS, `aud === MS_CLIENT_ID`, `exp`, issuer), enforces `ALLOWED_EMAILS`,
  and checks `Origin` on mutations. Mounted on `/api/milestones`;
  `AUTH_DISABLED=1` bypasses it ONLY when `NODE_ENV !== 'production'`.
- Server never calls Graph and never logs request bodies.

## Frontend
- `public/auth.js` — MSAL **v4.28.1 vendored from npm** (import map in
  `index.html`, no CDN/global). Scopes: OIDC (`openid profile email`) for
  sign-in, `OneDrive.ReadOnly` for the picker. `getPickerToken()` (interactive)
  must run before the picker window opens; `trySilentPickerToken()` is the only
  token call allowed inside the picker message flow. `getIdToken()` silently
  gets an ID token for our API (needs `openid` paired with `OneDrive.ReadOnly`
  on MSA); `fetchWithAuth()` attaches the Bearer header best-effort; `signOut()`
  logs out via popup.
- `public/picker.js` — File Picker v8. **FROZEN** (fragile handshake). Consumer
  base `https://onedrive.live.com/picker`, pivots `oneDrive`/`recent`. Command
  responses must use the top-level id `message.id` (not `message.data.id`) or
  the picker throws `acknowledgeTimeout`. Ignore `command.resource` for consumer
  (`${resource}/.default` fails `AADSTS9002332`).
- `public/onedrive.js` — `resolveItem`/`getThumbnailUrl` against the picked
  item's `@sharePoint.endpoint` (persisted as `drive_endpoint`) using the
  `OneDrive.ReadOnly` token. `assertEndpoint()` enforces https + a Microsoft
  host allowlist; `odFetch` throws typed errors (`AUTH_REQUIRED`, `NOT_FOUND`,
  `NETWORK_ERROR`, `SERVER_ERROR`). `resolveItem` uses one combined
  `?$expand=thumbnails(...)` request and falls back to the item GET +
  `/thumbnails` two-request path. Do NOT call `graph.microsoft.com` for consumer
  items.
- `public/onedriveCache.js` — sessionStorage read-through keyed by
  account+`drive_item_id`, 50-min TTL; `clearResolutionCache()` on sign-out.
- `TimelineScreen` rows: `loading|ready|needs-auth|gone|error`, lazy resolution
  is silent-only, with gesture-safe "Zaloguj ponownie" and "Spróbuj ponownie"
  retries.
- `app.js` → `SignInScreen` when signed out, else app shell (account +
  "Wyloguj") with `AddMilestoneScreen` (`#add`) / `TimelineScreen`.

## Environment
- Copy `.env.example` → `.env` (gitignored) and fill it in. `pnpm start:env`
  loads it (`node --env-file-if-exists`), and `prod.sh` sources it (real env vars
  win; `NODE_ENV` is forced to `production`).
- Sign-in is disabled without a client id:
  `MS_CLIENT_ID=<app-id> pnpm start` (optional `MS_AUTHORITY`, default consumer).
- API auth: set `ALLOWED_EMAILS=a@x.com,b@y.com`. Empty allowlist denies all.
  For local dev without tokens, `AUTH_DISABLED=1` (ignored in production).
- Boot logs a WARN when `MS_CLIENT_ID` is missing and when `AUTH_DISABLED` is
  active/ignored.

## Testing
- **Unit**: `pnpm test` → `node --test server/ public/` (46 tests:
  `server/server.test.js`, `server/auth.test.js`, `public/onedrive.test.js`,
  `public/onedriveCache.test.js`).
- **E2E**: `pnpm test:e2e` (single `playwright test`). Specs use stubs in
  `tests/e2e/helpers/` (`auth.js` fakes the vendored MSAL module, `picker.js`
  drives the real v8 handshake, `onedrive.js` routes the OneDrive API/media,
  `db.js` seeds references); the webServer runs `AUTH_DISABLED=1` with a dummy
  `MS_CLIENT_ID`; per-spec `isolateDb` clears the shared DB.
- **Known Playwright webServer hang**: on WSL2 `127.0.0.1:<port>` with no
  listener hangs. Workaround: start the server externally and use
  `playwright.config.manual.js`
  (`AUTH_DISABLED=1 MS_CLIENT_ID=x PORT=4173 DB_PATH=/tmp/e2e-manual.db node server/index.js &`).
  Do not use `testDir:/tmp`.

## Commands
- `pnpm test` — unit
- `pnpm start` — server (`MS_CLIENT_ID=… ALLOWED_EMAILS=… pnpm start`)
- `pnpm start:env` — same, loading `.env` if present
- `pnpm test:e2e` / `pnpm e2e` — E2E

## Constraints
- No dates anywhere, no `created_at`.
- Server never logs request bodies.
- `public/picker.js` is frozen except for log-only edits.
- Keep the picker message-flow id convention and consumer pivots as documented;
  regressions here are hard to debug.
