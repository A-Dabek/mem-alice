# mem-alice — Implementation Status

Current as of the OneDrive PoC + auth hardening pass. See:
- Handoff/protocol: `docs/onedrive-picker-poc.md`
- Known gaps: `docs/onedrive-poc-debt.md`
- Execution plan/progress: `docs/onedrive-execution-plan.md`

## Implemented
- **OneDrive-backed milestones**: server stores title/subtitle + picker
  references only; no encryption, no media upload.
- **Picker**: File Picker v8 (`public/picker.js`, frozen) hosted in a
  self-created inline iframe overlay, resolving consumer items via the OneDrive
  API + `@sharePoint.endpoint`.
- **Resolution layer**: endpoint allowlist, typed errors, single
  item+thumbnails request with fallback, intrinsic `width`/`height` persisted to
  the DB (`media_width`/`media_height`), sessionStorage cache (50-min TTL),
  silent-only lazy Timeline rows with re-auth/retry states.
- **Layout stability**: Add preview slot and Timeline media boxes reserve an
  `aspect-ratio` (stored/resolved intrinsic, else video `16/9`, else `4/3`) to
  avoid CLS; "Anuluj" drops a chosen item on the Add screen.
- **Auth**: vendored MSAL v4.28.1 (import map; no CDN), client Bearer ID token,
  server ID-token verification (`server/auth.js`) + `ALLOWED_EMAILS` + Origin
  checks; sign-out/account switching.
- **Server validation**: MIME allowlist, length caps, endpoint host re-check.

## Testing
- `pnpm test` — 48 unit tests.
- `pnpm test:e2e` — 14 Playwright tests (stubbed auth/picker/OneDrive), single
  invocation.

## Commands
- `pnpm test`
- `MS_CLIENT_ID=… ALLOWED_EMAILS=… pnpm start`
- `pnpm test:e2e`

## Deferred
See `docs/onedrive-poc-debt.md`: migrations (#8), redirect/mobile (#9), prod
transport hardening (#11), broader media types (#12), MSAL v5/COOP bridge.
