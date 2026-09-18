# OneDrive PoC — Known Gaps / Corners Cut

Companion to `docs/onedrive-picker-poc.md`. Consumer (personal Microsoft
accounts) only — business/SharePoint support is **intentionally out of scope**.
No migrations: the app is pre-prod, so schema changes are applied by deleting
`data/milestones.db*`.

## Resolution-layer gaps (introduced by the OneDrive API fix)

1. **Sign-in scopes.** `signIn()` still requests Graph `Files.Read`
   (`GRAPH_SCOPES` in `public/auth.js`) even though nothing calls Graph anymore.
   Remove it once consent is confirmed unnecessary; the only runtime scope we
   need is `OneDrive.ReadOnly`.
2. **Popup-blocked timeline resolution.** `TimelineScreen` resolves lazily from
   an `IntersectionObserver`, which has no user gesture. `getPickerToken()` can
   fall back to an interactive popup there and may be blocked → row degrades to
   the "broken item" placeholder. Prefer silent-only for lazy paths and surface a
   re-auth affordance on failure.
3. **No URL/token caching or expiry handling.** Every mount re-fetches item +
   thumbnails. `@content.downloadUrl` (~1h) and access tokens expire with no
   refresh/retry; an expired preview is indistinguishable from a deleted file.
4. **Extra round-trips.** Item metadata and `/thumbnails` are two requests per
   row, with no `select` to trim the payload. Could batch or request only what is
   rendered.
5. **Coarse errors.** `getThumbnailUrl` swallows every failure as `null`;
   `resolveItem` throws a generic status error. No distinction between 401
   (re-auth), 404 (gone) and network errors.
6. **Unvalidated endpoint.** `@sharePoint.endpoint` from the pick payload is
   stored and POSTed verbatim. The server never fetches it (client-side only),
   but the client should still sanity-check the host/scheme.
7. **No resolution tests.** `public/onedrive.js` has no unit tests (fetch not
   mocked); E2E is still broken (see handoff debt #3).

## Broader PoC debt (from `docs/onedrive-picker-poc.md`)

Still open: server-side ID-token + email guard (#1–2), E2E rewrite (#3),
thumbnail caching (#4), robust expiry / deleted-item state (#5, #11), server MIME
allowlist (#6), migration strategy (#8), redirect fallback + mobile (#9),
sign-out / account switching (#10), prod HTTPS redirect (#11), broader media
types (#12), full test coverage (#13), CSRF (#14).

Resolved: `@sharePoint.endpoint` / `driveId` resolution (#7).
