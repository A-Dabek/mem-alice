# mem-alice — Agent Guidelines

## Project Overview
- OneDrive-backed milestones (PoC): the server stores only a title/subtitle plus
  Graph references to files living in the user's OneDrive. No encryption, no
  media upload.
- Full handoff + protocol/debug notes: `docs/onedrive-picker-poc.md` — read it
  before touching `public/` or the schema.
- DB `server/db.js` `milestones` ordered by `id ASC` (no dates anywhere).

## Schema & API
- `milestones(id, title, subtitle DEFAULT '', drive_item_id NOT NULL, drive_id,
  drive_endpoint, media_mime NOT NULL, item_name)`. No `config` table, no
  migrations. After a schema change devs MUST `rm -f data/milestones.db*`.
- `server/routes/milestones.js`: `GET /` (oldest first), `POST /`
  `{title,subtitle?,drive_item_id,drive_id?,drive_endpoint?,media_mime,item_name?}`,
  `DELETE /:id`, bulk `DELETE /`. No auth/MIME allowlist yet.
- `server/index.js`: `GET /api/config` → `{clientId: MS_CLIENT_ID, authority}`,
  default `express.json()`, no-cache static. Server never calls Graph and never
  logs request bodies.

## Frontend
- `public/auth.js` — MSAL browser 2.19.0 (CDN in `index.html`), config from
  `/api/config`. Scopes: `Files.Read` (Graph), `OneDrive.ReadOnly` (picker).
  `getMsalApp()` clears its cached promise on failure; `getPickerToken()`
  (interactive) must run before the picker window opens;
  `trySilentPickerToken()` is the only token call allowed inside the picker
  message flow (popups are blocked there).
- `public/picker.js` — File Picker v8. Consumer base
  `https://onedrive.live.com/picker`, pivots restricted to `oneDrive`/`recent`.
  **Command responses must use the top-level id `message.id`** (not
  `message.data.id`) or the picker throws `acknowledgeTimeout`. Ignore
  `command.resource` for consumer (requesting `${resource}/.default` fails with
  `AADSTS9002332`).
- `public/onedrive.js` — `resolveItem`/`getThumbnailUrl` against the picked
  item's `@sharePoint.endpoint` (persisted as `drive_endpoint`) using the
  `OneDrive.ReadOnly` picker token; reads `@content.downloadUrl`. Do NOT call
  `graph.microsoft.com` for consumer items: Graph returns
  `InvalidAuthenticationToken: The token could not be read`.
- `app.js` → `SignInScreen` when signed out, else `AddMilestoneScreen`/`TimelineScreen`.
- Add uses the picker + OneDrive API preview and POSTs the reference. Timeline
  resolves thumbnails lazily; broken item → placeholder; delete modal retained.

## Environment
- Sign-in is disabled without a client id:
  `MS_CLIENT_ID=<app-id> pnpm start` (optional `MS_AUTHORITY`, default consumer).
  Boot logs a WARN when missing.

## Testing
- **Unit**: `pnpm test` → `node --test server/ public/` (`server/server.test.js`,
  8 tests: config, round-trip, defaults, ordering, validation, deletes).
- **E2E**: currently BROKEN (debt #3). Specs still import the removed
  `public/crypto.js` and use pre-picker selectors. `playwright.config.js` per-run
  `fs.mkdtempSync` throwaway DB is retained; webServer healthcheck now
  `/api/config`.
- **Known Playwright webServer hang**: On WSL2 `127.0.0.1:<port>` with no listener
  hangs. Workaround: start the server externally and use
  `playwright.config.manual.js` (`PORT=4173 DB_PATH=/tmp/e2e-manual.db node server/index.js &`).
  Do not use `testDir:/tmp`.

## Commands
- `pnpm test` — unit
- `pnpm start` — server (`MS_CLIENT_ID=… pnpm start`)
- `pnpm test:e2e` / `pnpm e2e` — E2E (broken until rewritten)

## Constraints
- No dates anywhere, no `created_at`.
- Server never logs request bodies.
- Keep the picker message-flow id convention and consumer pivots as documented;
  regressions here are hard to debug.
