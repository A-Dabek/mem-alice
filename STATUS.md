# mem-alice — Implementation Status

Current as of the OneDrive PoC + auth hardening pass. See:
- Handoff/protocol: `docs/onedrive-picker-poc.md`
- Known gaps: `docs/onedrive-poc-debt.md`
- Execution plan/progress: `docs/onedrive-execution-plan.md`

## Implemented
- **OneDrive-backed milestones**: server stores title/subtitle + picker
  references only; no encryption, no media upload.
- **Picker**: File Picker v8 (`public/picker.js`, frozen) resolving consumer
  items via the OneDrive API + `@sharePoint.endpoint`.
- **Resolution layer**: endpoint allowlist, typed errors, single
  item+thumbnails request with fallback, sessionStorage cache (50-min TTL),
  silent-only lazy Timeline rows with re-auth/retry states.
- **Auth**: vendored MSAL v4.28.1 (import map; no CDN), client Bearer ID token,
  server ID-token verification (`server/auth.js`) + `ALLOWED_EMAILS` + Origin
  checks; sign-out/account switching.
- **Server validation**: MIME allowlist, length caps, endpoint host re-check.

## Testing
- `pnpm test` — 46 unit tests.
- `pnpm test:e2e` — 11 Playwright tests (stubbed auth/picker/OneDrive), single
  invocation.

## Commands
- `pnpm test`
- `MS_CLIENT_ID=… ALLOWED_EMAILS=… pnpm start`
- `pnpm test:e2e`

## Deferred
See `docs/onedrive-poc-debt.md`: migrations (#8), redirect/mobile (#9), prod
transport hardening (#11), broader media types (#12), MSAL v5/COOP bridge.
