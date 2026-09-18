# OneDrive PoC — Known Gaps / Corners Cut

Companion to `docs/onedrive-picker-poc.md`. Consumer (personal Microsoft
accounts) only — business/SharePoint support is **intentionally out of scope**.
No migrations: the app is pre-prod, so schema changes are applied by recreating
the DB (see deferred #8).

## Open

- **Migrations (#8).** No migrations; non-additive schema changes require
  recreating the dev DB (`server/db.js` backfills additive columns such as
  `media_width`/`media_height`). Fine for pre-prod, must be solved before real
  data exists.
- **Redirect fallback + mobile (#9).** Popup-only sign-in (`loginPopup`); no
  `loginRedirect`/`acquireTokenRedirect` fallback, so strict popup blockers or
  some in-app browsers fail. The file picker is no longer a popup — it is hosted
  in a self-created inline iframe overlay — but sign-in/consent still is.
- **Prod transport hardening (#11).** No HTTPS redirect / HSTS / CSP. (CSRF
  Origin checking on mutations is done; access tokens are not bound to the
  server.)
- **Broader media types (#12).** The MIME allowlist is
  `image/jpeg,png,gif,webp` and `video/mp4`. HEIC photos or non-mp4 video (e.g.
  QuickTime) are rejected; the Add screen does not normalize them to an allowed
  type.
- **MSAL v5 / COOP redirect bridge.** We are pinned to vendored MSAL v4.28.1.
  v5 requires a same-origin COOP redirect-bridge page and an Entra redirect-URI
  change; revisit when those are acceptable.
- **Allowlist management.** `ALLOWED_EMAILS` is a static env var; adding a user
  requires a restart. No per-user/role model.
- **Discovery/JWKS caching.** `server/auth.js` caches discovery per process
  only; a cold start or authority change refetches. Acceptable at this scale.
- **No rate limiting / audit trail** on `/api/milestones` beyond logger reasons.

## Resolved

- **Sign-in scopes (#1):** sign-in requests only `openid profile email`;
  `Files.Read`/`GRAPH_SCOPES` removed.
- **Popup-blocked timeline resolution (#2):** lazy rows are silent-only
  (`trySilentPickerToken`); failures surface a gesture-safe "Zaloguj ponownie".
- **URL/token caching + expiry (#3/#4):** `public/onedriveCache.js`
  (sessionStorage, account+item key, 50-min TTL, never caches failures);
  resolution uses one combined item+thumbnails request with a two-request
  fallback.
- **Coarse errors (#5):** `odFetch` throws typed errors (`AUTH_REQUIRED`,
  `NOT_FOUND`, `NETWORK_ERROR`, `SERVER_ERROR`); Timeline maps them to distinct
  states.
- **Unvalidated endpoint (#6):** `assertEndpoint` (client) plus the server
  endpoint host re-check.
- **No resolution tests (#7):** `public/onedrive.test.js`,
  `public/onedriveCache.test.js`, and the rewritten E2E suite.
- **Sign-out / account switching (#10):** `signOut()` + app-shell "Wyloguj";
  cache cleared on sign-out.
- **Full test coverage / E2E (#13):** `pnpm test` 48 unit tests; `pnpm test:e2e`
  14 tests with stubbed auth/picker/OneDrive.
- **CSRF (#14):** same-origin/allowlisted `Origin` required on mutations.
- **Server-side ID-token + email guard (#1–2 broader):** `server/auth.js`
  verifies the ID token via OIDC discovery + `jose`, enforces `ALLOWED_EMAILS`,
  and guards `AUTH_DISABLED` in production.
- **Server MIME allowlist (#6 broader):** allowlist + length caps + endpoint
  re-check in `server/routes/milestones.js`.
