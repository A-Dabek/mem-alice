# mem-alice — Agent Guidelines

## Project Overview
- E2E-encrypted milestones: client-side `public/crypto.js:125` `encryptField`/`decryptField` (AES-GCM), server never sees plaintext.
- DB `server/db.js:35` `milestones` ordered by `id ASC` (no dates).

## Video Milestones (2026-09-07)
- **Schema**: clean rename `photo_*` → `media_*` (`media_ct`, `media_iv`, `media_mime` TEXT NOT NULL) `server/db.js:35`, `server/routes/milestones.js:3`. No migration, devs MUST `rm data/milestones.db*` after pull.
- **Limits**: binary 100 MB → base64 ~133 MB + overhead → `express.json({limit:'150mb'})` `server/index.js:23`. Client `AddMilestoneScreen.js:15` `MAX_FILE_SIZE_BYTES=100*1024*1024` rejected before `arrayBuffer()` with `FILE_TOO_LARGE_ERROR`.
- **MIME allowlist**: `media_mime.startsWith('image/') || media_mime==='video/mp4'` `server/routes/milestones.js:21`, else 400. `application/octet-stream` rejected.
- **Frontend Add**: `public/components/AddMilestoneScreen.js` `mediaFile` state, `accept="image/*,video/mp4"`, `data-testid="media-input"` + alias `photo-input` (hidden offscreen) for compat, preview `media-preview`, POST `{media_ct,media_iv,media_mime}`.
- **Frontend Timeline**: `public/components/TimelineScreen.js:43` `decrypted: {title,subtitle,mediaUrl,mediaMime,photoUrl}` alias, `decryptField(media_ct,media_iv)` + `media_mime`, conditional `<video data-testid="milestone-video" controls playsinline preload="metadata">` vs `<img data-testid="milestone-photo">`, placeholder `milestone-photo-loading` outer + `milestone-media-loading` inner span, `Could not decrypt media`/`Loading media...`.
- **Styles**: `.milestone-video {width:100%;background:#000}` `public/styles.css:270`.
- **Fixtures**: `tests/e2e/fixtures/sample.mp4` 18 MB present, added `sample-small.mp4` 300 KB (`dd bs=1K count=300`) for fast E2E.

## Testing
- **Unit**: `pnpm test` → `node --test server/ public/` (`server/server.test.js`, `public/crypto.test.js`). Must cover: image round-trip, video/mp4 round-trip, `video/webm` 400, `application/octet-stream` 400, missing `media_*` 400, ordered oldest-first.
- **E2E**: `playwright.config.js:11` `fs.mkdtempSync(os.tmpdir()/milestones-e2e-)` per `playwright test` invocation → throwaway DB. `test:e2e` runs 4 separate invocations (`unlock`, `add-milestone`, `timeline-scroll`, `routing`) to keep isolation. `devices['Pixel 5']`, `BASE_URL http://127.0.0.1:4173`, `webServer.url http://127.0.0.1:4173/api/salt`.
- **Known Playwright webServer hang**: On WSL2 `127.0.0.1:<port>` with no listener hangs (SYN dropped, `curl 127.0.0.1:4173` hangs, `::1:4173` `ECONNREFUSED` fast, `ping 127.0.0.1` ok). `isURLAvailable`/`isPortUsed` (`playwright-core/lib/coreBundle.js:8514` `httpHappyEyeballsAgent`, `NET_DEFAULT_TIMEOUT 30s`) then hangs >30 s, `raceAgainstDeadline` 20 s never fires → `DEBUG=pw:webserver` only `HTTP GET: http://127.0.0.1:4173/` then `exit 124`. Workaround: start server externally + `reuseExistingServer:true` or manual config `playwright.config.manual.js` (no `webServer`) → `PORT=4173 DB_PATH=/tmp/e2e-manual.db node server/index.js &` then `playwright test --config=playwright.config.manual.js` passes in ~400 ms (verified `dummy` 453 ms, `isAlreadyAvailable` fast when server listening). Fix candidates: `BASE_URL http://[::1]:4173` (IPv6 only), `webServer.port` vs `url`, or `globalSetup` spawner. Do not use `testDir:/tmp` (snap `EACCES: scandir '/tmp/snap-private-tmp'`).
- **E2E video coverage**: `add-milestone.spec.js` image + video (expects `milestone-video` `controls`, no `milestone-photo`), `timeline-scroll.spec.js` seeds 4 mixed `MIMES` `[image/png,video/mp4,image/jpeg,video/mp4]` asserts `milestone-photo`/`milestone-video` counts, `unlock.spec.js`/`routing.spec.js` use `media-input.or(photo-input)`.

## Commands
- `pnpm test` — unit
- `pnpm test:e2e` — 4× `playwright test` (isolated DB)
- `pnpm e2e` — alias `playwright test` (single invocation, shared DB, use for manual server)
- `rm -f data/milestones.db* && pnpm test && pnpm test:e2e` for full verify after schema change

## Constraints
- No dates anywhere, no `created_at`.
- Server never logs bodies, only ciphertext.
- Keep `photo-input` alias until all e2e migrated to `media-input`.
