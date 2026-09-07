# Video Milestones — Implementation Status (2026-09-07)

## Plan
`.junie/plans/video-milestones.md` (session-260903-130810-video-milestones) — E2E-encrypted video as milestone, same `public/crypto.js:125` AES-GCM as photos.

## Implemented
- **Backend** `server/db.js:35` `photo_*` → `media_*` (`media_ct,media_iv,media_mime`), `server/routes/milestones.js:3` `REQUIRED_FIELDS media_*` + allowlist `image/* || video/mp4` 400, `server/index.js:23` `express.json({limit:'150mb'})` (100 MB binary ~133 MB b64).
- **Frontend Add** `public/components/AddMilestoneScreen.js` `mediaFile`/`MAX_FILE_SIZE_BYTES`/`FILE_TOO_LARGE_ERROR`, `accept="image/*,video/mp4"`, `data-testid="media-input"` + hidden `photo-input` alias, `media-preview`, `POST {media_ct,media_iv,media_mime}`.
- **Frontend Timeline** `public/components/TimelineScreen.js:43` `mediaUrl/mediaMime/photoUrl` alias, `decryptField(media_ct,media_iv)`, `<video data-testid="milestone-video" controls playsinline preload="metadata">` vs `<img data-testid="milestone-photo">`, placeholder `milestone-photo-loading` outer + `milestone-media-loading` inner.
- **Styles** `public/styles.css:270` `.milestone-video {width:100%;background:#000}`.
- **Fixtures** `tests/e2e/fixtures/sample-small.mp4` 300 KB (`dd bs=1K count=300` from `sample.mp4` 18 MB) for fast E2E; `sample.mp4` kept for manual.

## Testing
- **Unit** `pnpm test` 12/12 pass `server/server.test.js` (image round-trip, `video/mp4` round-trip, `video/webm` 400, `octet-stream` 400, missing `media_*` 400, oldest-first) + `public/crypto.test.js`.
- **E2E** `playwright.config.js:17` `BASE_URL http://[::1]:4173` (was `127.0.0.1:4173` → WSL2 SYN dropped, `curl 127.0.0.1:4173` hangs, `::1` `ECONNREFUSED` fast, `isURLAvailable` `NET_DEFAULT_TIMEOUT 30s` hung) + `fs.mkdtempSync` per `playwright test` invocation, `test:e2e` 4× `playwright test <file>` isolated, `devices['Pixel 5']`.
- **E2E video** `add-milestone.spec.js` image (`milestone-photo`) + video (`milestone-video` `controls`, `last()` for shared DB), `timeline-scroll.spec.js` 4 mixed `MIMES` asserts `milestone-photo`/`milestone-video` counts, `unlock.spec.js`/`routing.spec.js` `media-input.or(photo-input)`.
- **Known** `pnpm e2e` (`playwright test` single invocation) shares DB → `timeline-empty` fails; `test:e2e` per file isolated is canonical. `DELETE /api/milestones` added `server/routes/milestones.js:94` + `tests/e2e/helpers/db.js` for per-test `clearMilestones` if needed (not used by default to keep `test:e2e` simple).
- **Config** `playwright.config.js:12` `fs.mkdtempSync` + `process.env.DB_PATH` override + `reuseExistingServer:false` (was `!process.env.CI` caused stale `*:4173` reuse), `playwright.config.manual.js` no `webServer` for manual `PORT=4173 DB_PATH=/tmp/... node server/index.js &` + `playwright test --config=playwright.config.manual.js`.

## Commands
- `rm -f data/milestones.db* && pnpm test` — 12 pass
- `pnpm test:e2e` — 7 passed `unlock(2)` `add-milestone(2)` `timeline-scroll(2)` `routing(1)` in ~5s (`[::1]` fix)
- `pnpm e2e` — alias to `test:e2e` (per file, not single `playwright test`)

## Follow-ups
- Thumbnail/poster for video, chunked encrypt for 100 MB, additional `video/*` (webm/mov) after `mp4` stable.
