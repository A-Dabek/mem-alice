# OneDrive PoC — Orthogonal Execution Plan

Revised plan. **One concern per task.** The app MUST remain fully working after
each task. `public/picker.js` is **FROZEN** (no edits — fragile, hard-won
handshake). Run `pnpm test` + the manual golden path before moving on.

Companion docs: `docs/onedrive-picker-poc.md` (handoff/protocol),
`docs/onedrive-poc-debt.md` (known gaps). Debt numbers below refer to the latter.

## Status legend
`TODO` · `WIP` · `DONE` · `BLOCKED` · `DROPPED`

## Global rules
- `public/picker.js`: frozen.
- After every task: `pnpm test` green **and** golden path green.
- Stop between tasks for manual verification.
- Every task touching `public/` requires the golden path.

## Manual golden path (regression guard for OneDrive)
1. Sign in
2. "Wybierz z OneDrive"
3. Pick photo
4. Preview renders
5. Save
6. Timeline thumbnail renders
7. Expand full media
8. Delete

---

## A — Resolution layer (highest regression risk; small steps, unit-test each)

### A1 — Drop Graph scope (debt #1) — `DONE`
- `public/auth.js`: remove `GRAPH_SCOPES`/`Files.Read`; sign-in scopes =
  `openid profile email`.
- Verify: sign-in; pick file; add. Expect one re-consent. Guard: golden path.
- Status: `pnpm test` 8/8 green; golden path confirmed (one re-consent).

### A2 — Endpoint validation (debt #6) — `DONE`
- `public/onedrive.js`: `assertEndpoint()` requires https + host allowlist
  (`*.onedrive.com`, `*.sharepoint.com`, `*.live.com`, `*.svc.ms`,
  `*.microsoftpersonalcontent.com`), throws `ENDPOINT_INVALID`; fallback endpoint
  allowed.
- Verify: `public/onedrive.test.js` valid/invalid hosts; golden path.
- Status: `pnpm test` 13/13 green; golden path confirmed. Real consumer endpoint
  observed: `https://my.microsoftpersonalcontent.com/_api/v2.0`.

### A3 — Typed errors (debt #5) — `DONE`
- `public/onedrive.js`: `odFetch` maps 401/403→`AUTH_REQUIRED`, 404→`NOT_FOUND`,
  network→`NETWORK_ERROR`, else `SERVER_ERROR`, with `.status`/`.code`. Happy path
  unchanged.
- Verify: unit tests per status; golden path.
- Status: `pnpm test` 18/18 green; golden path confirmed.

### A4 — One request for item + thumbnails (debt #4) — `DONE`
- `public/onedrive.js`: `GET .../items/{id}?$expand=thumbnails($select=large,medium,small)`;
  `resolveItem` also returns `thumbUrl`; `getThumbnailUrl` delegates.
- Fallback: if the item GET lacks `@content.downloadUrl` or the combined call
  errors, retry the current two-request path.
- Adapter: `TimelineScreen` now uses the single `resolveItem` result instead of
  calling `resolveItem` + `getThumbnailUrl` in parallel.
- Depends: A2/A3. Verify: golden path (thumbnails + download); unit test asserts
  fallback triggers.
- Status: `pnpm test` 21/21 green; golden path confirmed.

### A5 — Resolution cache + TTL (debt #3) — `DONE`
- New `public/onedriveCache.js`: sessionStorage read-through keyed by
  account+`drive_item_id`, download-URL TTL ~50 min; clear-on-signout hook
  (wired later).
- Depends: A4 return shape. Verify: golden path + unit tests (hit/miss/expiry).
- Status: wired into Timeline by A6; `pnpm test` 30/30 green; golden path
  confirmed.

### A6 — Timeline row states + silent-only lazy resolution (debt #2, #5/#11) — `DONE`
- `TimelineScreen`: `loading|ready|needs-auth|gone|error`, silent-only resolve,
  "Zaloguj ponownie" button (gesture-safe retry), retry on network error;
  distinct Polish copy.
- Depends: A3, A5. Verify: golden path; simulate 401/404 via browser.
- Status: `pnpm test` 30/30 green; golden path + state simulation confirmed.

---

## B — Auth / transport (keep client and server decoupled)

### B1 — Client Bearer plumbing (server still ignores it) — `DONE`
- `public/auth.js`: `getIdToken()` + `fetchWithAuth()`; route Timeline
  fetch/delete and Add POST through it.
- Verify: app unaffected; DevTools shows `Authorization: Bearer` on
  `/api/milestones`.
- Status: `pnpm test` 30/30 green; manual verification confirmed (Bearer header
  present). MSA note: `acquireTokenSilent` needs `openid` paired with a consented
  resource scope, so `ID_TOKEN_SCOPES = ['openid','profile','OneDrive.ReadOnly']`.

### B2 — Server ID-token verification (debt #1–2, #14) — `DONE`
- `pnpm add -E jose@6.2.12`. New `server/auth.js`: fetch discovery, use its
  issuer + `jwks_uri`, `jwtVerify` (RS256), check `aud === MS_CLIENT_ID`, `exp`;
  identity = `email || preferred_username`; enforce `ALLOWED_EMAILS`; Origin
  check on mutations. `AUTH_DISABLED=1` honored only when
  `NODE_ENV !== 'production'` (loud warn). Mount on `/api/milestones`;
  `/api/config` public.
- Depends: B1. Verify: `server/auth.test.js`
  (expired/wrong-aud/wrong-iss/allowlist/missing/prod-guard) + real 401/403/200;
  golden path.
- Status: `pnpm test` 43/43 green; staged manual verification confirmed
  (`AUTH_DISABLED=1` then enforced with `ALLOWED_EMAILS`; real 401).

### B3 — Sign-out / account switching (debt #10) — `DONE`
- `public/auth.js` `signOut()`; app shell shows account + "Wyloguj"; clears
  cache, resets to `SignInScreen`.
- Depends: A5/B1. Verify: sign out → sign in as other allowed account; cache not
  leaked.
- Status: `pnpm test` 43/43 green; account-switch golden path confirmed.

### B4 — Server MIME allowlist + length caps (debt #6) — `DONE`
- `server/routes/milestones.js`: explicit MIME allowlist
  (`image/jpeg,png,gif,webp`, `video/mp4`), max lengths for
  title/subtitle/IDs, server-side endpoint host re-check.
- Verify: extend `server/server.test.js`; golden path.
- Status: `pnpm test` 46/46 green; golden path confirmed.

---

## C — Test harness & last steps

### C1 — E2E rewrite (debt #3, #13) — `DONE`
- Remove all `crypto.js`/passphrase/unlock usage; add `helpers/auth.js` (stub
  `window.msal` + `/api/config`), `helpers/picker.js` (stub `window.open`,
  script real v8 handshake), `helpers/onedrive.js` (`page.route` fake
  item/thumb/photos); server runs `AUTH_DISABLED=1`; rewrite
  add/timeline/delete/routing; single playwright test invocation.
- Depends: B2. Verify: `pnpm test:e2e` green + golden path.
- Status: `pnpm test:e2e` 11/11 green (single invocation); golden path confirmed.

### C2 — MSAL v3 upgrade (last, isolated, revertable) — `DONE`
- Outcome: MSAL CDN is deprecated at v3, so v4.28.1 is **vendored from npm**
  instead (decision recorded below). v5 rejected as overkill (mandatory COOP
  redirect bridge + Entra redirect-URI change).
- Changes: `pnpm add -E @azure/msal-browser@4.28.1`; server serves the real
  unbundled `dist` trees at `/vendor/msal-browser` + `/vendor/msal-common`
  (resolved via `import.meta.resolve` + `createRequire`); `index.html` drops the
  CDN script, adds an import map; `public/auth.js` dynamically imports
  `PublicClientApplication` (keeps browser-only code out of Node unit tests) and
  calls `initialize()`; E2E stubs the vendor module instead of `window.msal`.
- Verify: full golden path + sign-out + all tests. Revert cleanly if the picker
  breaks.
- Status: code done; `pnpm test` 46/46, `pnpm test:e2e` 11/11, vendor routes
  return `text/javascript` (msal-browser v4.28.1 / msal-common v15.14.1).
  Awaiting manual golden path + sign-out (real popup/silent/picker flows).
- Blocker/analysis: MSAL CDN is **deprecated as of v3.0.0**; alcdn serves v2 only
  (2.38.0 last). Package is scoped/ESM; latest v5.22.0, latest v4.28.1. **v5 is
  overkill/incompatible here**: it makes the COOP redirect bridge mandatory for
  all popup/iframe flows (new same-origin bridge page + Entra redirect-URI
  change), else login/consent/silent fail. **v4.28.1 is effectively drop-in**
  (its v2→v4 breaking changes — async `loadExternalTokens`, `allowNativeBroker`
  rename, localStorage encryption — do not affect us; we use sessionStorage and
  no broker/external tokens). Recommended: vendor v4.28.1 (see question).

### C3 — Docs & env finalize — `WIP`
- Update `docs/onedrive-picker-poc.md`, `docs/onedrive-poc-debt.md`, `AGENTS.md`,
  `prod.sh` (export `ALLOWED_EMAILS`; document `AUTH_DISABLED` prod guard);
  remove stale DB-deletion/migration notes.
- Status: docs rewritten to current state (MSAL v4 vendoring, server auth,
  validation, cache, Timeline states, E2E); `prod.sh` exports `ALLOWED_EMAILS` +
  documents the prod `AUTH_DISABLED` guard; stale crypto/migration notes removed;
  also refreshed `STATUS.md` and the `logger.js` comment. `pnpm test` 46/46.
  Awaiting review.

---

## D — CLS: reserved media boxes + inline picker

Goal: stop layout shift when previews/thumbnails/expanded media load, and drop
the picker popup (blocked in in-app browsers).

### D1 — Intrinsic dimensions in resolution — `DONE`
- `public/onedrive.js`: `toResolution` carries `width`/`height` from the item's
  `image || photo || video` facet (null when absent); both resolve paths reuse
  it.
- Verify: `public/onedrive.test.js` deepEquals + new
  facet-extraction/precedence test.
- Status: `pnpm test` 47/47 green.

### D2 — Add screen reserves the preview slot — `DONE`
- `AddMilestoneScreen.js`: always render `.media-preview` with an inline
  `aspect-ratio` (idle/picking/media/error); ratio = `width/height`, else video
  `16/9`, else `4/3`; media `object-fit: contain`. Popup-blocked handling
  removed (`PICK_ERROR` kept).
- Status: `pnpm test:e2e` add-milestone specs green.

### D3 — Timeline reserves media boxes — `DONE`
- `TimelineScreen.js`: ready state carries `width`/`height`; `aspectFor()` drives
  an inline `aspect-ratio` on placeholders, thumb, photo and video
  (`object-fit: cover` for thumbs, `contain` for expanded); dropped the hard
  `1/1` placeholder ratio.
- Status: `pnpm test:e2e` timeline specs green; spec now scrolls the last row
  into view before asserting all thumbnails resolve (reserved boxes no longer
  collapse and eagerly reveal below-the-fold rows).

### D4 — Inline picker iframe — `DONE`
- `public/picker.js`: replaced `window.open` with a self-created full-screen
  overlay (`fixed inset:0`, `100dvh`, above the delete modal) holding a header +
  Cancel + `<iframe name="OneDrivePicker">`; body scroll lock, `#app` inert,
  Escape/Cancel → `CANCELLED`; POSTs the config form into the iframe about:blank
  document; `accessibility.enableFocusTrap: true`; setup failure →
  `PICKER_LOAD_FAILED`; `finish()` tears down overlay/listener/lock.
- Handshake unchanged (top-level `message.id`, `event.ports[0]`,
  `event.source === frame.contentWindow`, consumer pivots).
- Status: `pnpm test:e2e` 11/11 green (helper locates the app-created iframe).

### D5 — E2E helper + docs — `DONE`
- `tests/e2e/helpers/picker.js`: `installPicker` patches
  `HTMLFormElement.prototype.submit` (records the action URL, skips
  navigation); `driveHandshake` uses the app-created iframe's `contentWindow` as
  `event.source`; `pickFile`/`closePicker` signatures unchanged.
- Docs/AGENTS refreshed for the iframe hosting and reserved media boxes.
- Status: `pnpm test` 47/47, `pnpm test:e2e` 11/11. Awaiting manual mobile
  golden path + DevTools CLS check.

---

## E — Persist media dimensions + Add-screen polish

Feedback follow-up to D: preview sizing was off (black letterbox / wrong ratio
for portrait photos) and Timeline thumbnails were reserved at 16:9 / 4:3 then
snapped to the real 3:4.

### E1 — Store intrinsic size in the DB — `DONE`
- `server/db.js`: `media_width`/`media_height` INTEGER columns (+ additive
  backfill for existing dev DBs).
- `server/routes/milestones.js`: accept/validate positive-integer dimensions,
  include in `GET`/`INSERT`.
- `AddMilestoneScreen` POSTs the resolved dimensions; `TimelineScreen` reserves
  the ratio from resolved dimensions, else the stored
  `media_width`/`media_height`, else the MIME fallback.
- Verify: `server/server.test.js` round-trip + dimension validation.
- Status: `pnpm test` 48/48 green.

### E2 — Add screen polish — `DONE`
- `picker-button` gets padding; media preview uses a neutral background instead
  of black so `object-fit: contain` letterboxing is not a black screen.
- Added a "Anuluj" button (`clear-media`) under the chosen media that drops the
  item so it can be re-picked.
- Verify: `tests/e2e/add-milestone.spec.js` clear-media + portrait-ratio tests.
- Status: `pnpm test:e2e` 13/13 green.

### E3 — Reserved-slot button + seamless media swap — `DONE`
- `AddMilestoneScreen`: the "Wybierz z OneDrive" button is now the idle content
  of the reserved `.media-preview` slot, so it reserves the image space and
  disappears while picking; removed the "Nie wybrano pliku." placeholder.
- `TimelineScreen`: expanded photos keep the thumbnail as `src` until the full
  download URL is preloaded, then swap in place (no blank flash); videos use
  `poster`.
- Verify: updated clear-media spec; new `timeline-scroll.spec.js` swap test.
- Status: `pnpm test:e2e` 14/14 green.

---

## Deferred (unchanged)
- DB migrations (#8)
- Mobile/redirect sign-in (#9)
- Prod HTTPS/HSTS/CSP (#11 broader)
- Broader media types (#12)

## Progress log
- 2026-09-18 — Plan written; no tasks started.
- 2026-09-18 — A1 DONE: `public/auth.js` sign-in scopes `openid profile email`;
  `pnpm test` 8/8; golden path confirmed.
- 2026-09-18 — A2 DONE: added `microsoftpersonalcontent.com` after real picker
  endpoint rejected; `pnpm test` 13/13; golden path confirmed.
- 2026-09-18 — A3 DONE: typed `odFetch` errors; `pnpm test` 18/18; golden path
  confirmed. Also removed `[picker] authenticate` console.log (log-only picker.js
  edit).
- 2026-09-18 — A4 DONE: single item+thumbnails request + fallback; Timeline
  adapter; `pnpm test` 21/21; golden path confirmed.
- 2026-09-18 — A5 DONE: `public/onedriveCache.js` + tests; `pnpm test` 30/30;
  golden path confirmed.
- 2026-09-18 — A6 DONE: Timeline states + silent-only + re-auth/retry; `pnpm
  test` 30/30; golden path + simulated 401/404 confirmed.
- 2026-09-18 — B1 DONE: `getIdToken`/`fetchWithAuth` routed; `pnpm test` 30/30;
  Bearer header confirmed. ID-token silent scope fix for MSA recorded.
- 2026-09-18 — B2 BLOCKED on dependency-install policy question (`jose` resolved:
  user authorized install).
- 2026-09-18 — B2 DONE: jose@6.2.12, `server/auth.js` + tests, mount on
  `/api/milestones`; `pnpm test` 43/43; staged (AUTH_DISABLED then enforced)
  golden path + real 401 confirmed.
- 2026-09-18 — B3 DONE: sign-out header + `signOut()` + cache clear; `pnpm test`
  43/43; account-switch golden path confirmed.
- 2026-09-18 — B4 DONE: MIME allowlist, length caps, endpoint re-check;
  `pnpm test` 46/46; golden path confirmed.
- 2026-09-18 — C1 DONE: E2E rewritten, single invocation; `pnpm test:e2e` 11/11;
  golden path confirmed.
- 2026-09-18 — C2 DONE: vendored MSAL v4.28.1; `pnpm test` 46/46,
  `pnpm test:e2e` 11/11; golden path + sign-out confirmed.
- 2026-09-18 — C3 docs/env finalized (AGENTS, poc, debt, STATUS, prod.sh,
  logger comment). Awaiting review.
- 2026-09-18 — Added `.env.example` + `.gitignore` entry; `prod.sh` sources
  `.env`; `pnpm start:env` loads it.
- 2026-09-18 — D1 DONE: `resolveItem` carries intrinsic `width`/`height` from the
  media facet; `pnpm test` 47/47.
- 2026-09-18 — D2 DONE: Add screen always renders `.media-preview` with an inline
  aspect ratio; popup-blocked path removed.
- 2026-09-18 — D3 DONE: Timeline reserves media boxes via `aspectFor()`; spec
  scrolls the last row into view.
- 2026-09-18 — D4 DONE: picker moved from popup to inline iframe overlay;
  `PICKER_LOAD_FAILED` replaces `POPUP_BLOCKED`.
- 2026-09-18 — D5 DONE: E2E picker helper drives the app-created iframe; docs +
  AGENTS updated. `pnpm test` 47/47, `pnpm test:e2e` 11/11. Awaiting manual
  mobile golden path + DevTools CLS check.
- 2026-09-18 — E1 DONE: `media_width`/`media_height` persisted (schema, API
  validation, POST from Add, Timeline uses stored dims); `pnpm test` 48/48.
- 2026-09-18 — E2 DONE: picker-button padding, neutral preview background,
  "Anuluj" (`clear-media`) to drop the chosen media; `pnpm test:e2e` 13/13.
- 2026-09-18 — E3 DONE: "Wybierz z OneDrive" is the reserved-slot idle content
  (no "Nie wybrano pliku."); expanded photos keep the thumbnail until the full
  image is preloaded, videos use `poster`; `pnpm test:e2e` 14/14.
- 2026-09-24 — Reverted 5713253 picker config to open on "My files": entry is
  a bare `oneDrive: {}` (NOT `oneDrive.files`, which is business-only and throws
  `notSupported` on consumer — OneDrive/samples#45), pivots `oneDrive`/`recent`
  enabled. Dropped `typesAndSources.filters` (photo/video): on consumer it
  builds a SharePoint `FSObjType` query the OneDrive API rejects. The media
  allowlist stays enforced server-side; OAuth scope unchanged. Set
  `list.layout.type: 'tiles'` for thumbnails and added a client-side MIME guard
  (`NO_MEDIA_ERROR`) in `AddMilestoneScreen`.
