# Screen Recording — Design

## Goal

From the live-preview page, let the user record an auto-scrolling
walkthrough of the target site — all 4 device viewports scrolling in sync,
exactly as they already appear in the live preview — as a downloadable
Instagram-ready MP4. One click, no manual screen-recording software, no
editing.

## Non-goals

- Not tied to the crawl+screenshot+composite pipeline or `manifest.json` —
  this is an ad hoc capture from the live-preview page, same scope as the
  live preview feature itself.
- Not a general-purpose screen recorder — it only records the app's own
  synced 4-device preview view, not the user's desktop or arbitrary
  interaction.
- No editing/trimming/audio — a single fixed-duration auto-scroll pass.
- No retention/cleanup policy for saved recordings — YAGNI for a
  single-user local tool; same reasoning already applied to the live
  preview's parked cache-growth item.

## Architecture

### Backend: `src/screenRecorder.js`

`async function recordSitePreview({ url, previewBaseUrl, outputDir })`:

1. Launches a Playwright Chromium context with `recordVideo: { dir: <temp dir> }`.
2. Navigates to `${previewBaseUrl}/preview.html?url=${encodeURIComponent(url)}`
   — the same standalone page built for live preview. Reuses its existing
   4-iframe layout and sync bridge with zero changes to that code.
3. Waits for all 4 iframes to finish loading (poll each iframe's
   `contentDocument.readyState === 'complete'`, or wait on each iframe's
   `load` event — whichever is simpler given Playwright's frame API).
4. Measures scroll distance: evaluates
   `document.documentElement.scrollHeight - window.innerHeight` inside the
   desktop iframe's frame (`page.frames().find(f => ...)` by name/URL match).
5. Computes duration: `durationMs = clamp(distance / SCROLL_SPEED_PX_PER_MS, 4000, 15000)`.
   A near-zero-height page (e.g. the test fixture) floors at 4000ms.
6. Drives the scroll with real input: repeatedly calls
   `page.mouse.wheel(0, deltaY)` at short intervals, with the mouse
   positioned over the desktop iframe's bounding box on screen, for the
   computed duration. This fires genuine `scroll` events inside that
   iframe, which the existing sync-bridge script (`src/previewProxy.js`)
   already relays to the other 3 iframes via `postMessage` — no new sync
   code needed.
7. Closes the page/context, which finalizes the WebM recording Playwright
   wrote to the temp dir.
8. Shells out to the `ffmpeg-static` binary
   (`ffmpeg -i input.webm -c:v libx264 -pix_fmt yuv420p output.mp4`) to
   transcode to H.264 MP4 — WebM/VP8 is not reliably accepted by Instagram,
   H.264 MP4 is.
9. Returns `{ mp4Path, durationMs }`. Caller is responsible for moving
   `mp4Path` into `outputDir` and cleaning up the temp WebM.

### Backend: route wiring

`src/routes/preview.js` gains one more route, in the same file as the
existing `/preview/page`/`/preview/asset` routes (they share the "drive
the live preview" theme):

- `POST /api/preview/record` — body `{ url }`. Validates `url` the same way
  `parseTargetUrl` already does for the other two routes. Calls
  `recordSitePreview({ url, previewBaseUrl: <this server's own origin>,
  outputDir: path.join(outputRoot, 'recordings') })`, writes the MP4 as
  `output/recordings/<crypto.randomUUID()>.mp4`, responds
  `{ downloadUrl: '/output/recordings/<uuid>.mp4', durationMs }`. Blocking
  request/response — no SSE/polling for v1, since worst case is ~15-25s
  (record + transcode). Revisit only if this proves too slow in practice.
- `createPreviewRouter({ outputRoot })` — note this changes the router
  factory's signature from today's zero-arg `createPreviewRouter()`, since
  it now needs to know where to write recordings. Update the mount site in
  `src/server.js` accordingly: `app.use('/api', createPreviewRouter({ outputRoot }))`.
- `app.use('/output', express.static(outputRoot))` in `src/server.js`
  already serves `output/recordings/*.mp4` with no further wiring — same
  static mount used for screenshots/composites today.

### New dependency: `ffmpeg-static`

Bundles a prebuilt `ffmpeg` binary for the current platform — same
"no manual install" philosophy as Playwright's bundled Chromium. Exposes
its resolved binary path as its default export (`import ffmpegPath from
'ffmpeg-static'`).

### Frontend: `public/preview.html` / `public/preview.js`

- A "Record video" button next to the existing "Load preview" button.
  Disabled until a preview has successfully loaded (mirrors the existing
  `previewLiveBtn` disabled-state pattern from the run form).
- On click: `POST /api/preview/record` with the currently-loaded URL.
  Button shows a spinner + "Recording… ~15s" label, disabled for the
  duration of the request (matches the existing `.shutter-ring`/
  `.shutter-label` busy-state pattern already used on the run form's
  submit button and caption-modal post button).
- On success: reveal a `<video controls src="<downloadUrl>">` element below
  the device-bezel stage, plus a plain `<a href="<downloadUrl>" download>`
  link. No custom download handling needed — `/output/recordings/*` is
  already statically served.
- On failure: inline error text using the same `#preview-url-error`-style
  pattern already established for preview-load failures.

## Data flow summary

```
User clicks "Record video" on preview.html (URL already loaded)
  → POST /api/preview/record { url }
  → server launches Playwright, navigates to preview.html?url=X (its own page)
  → waits for 4 iframes to load, measures scroll height
  → drives real wheel-scroll over the desktop iframe for computed duration
    (existing sync bridge relays scroll to the other 3 iframes automatically)
  → closes page, finalizes WebM
  → ffmpeg-static transcodes WebM → MP4
  → server saves MP4 under output/recordings/<uuid>.mp4
  → responds { downloadUrl, durationMs }
  → frontend shows <video> preview + download link
```

## Testing

- `test/screenRecorder.test.js`: real Playwright + the existing local
  fixture site (small — so the 4000ms duration floor keeps the test fast).
  Assert: the returned MP4 file exists, has nonzero size, and its first
  bytes match a valid MP4 box signature (`ftyp` atom) — skip ffprobe-based
  duration/codec verification, no new dependency needed for that level of
  detail.
- `test/previewRecordRoute.test.js`: real Express app + `app.listen(0)` +
  native `fetch`, `POST /api/preview/record` against the fixture site,
  assert 200 + `downloadUrl` pointing at a file that's actually retrievable
  via `GET` on that same app instance (through the existing `/output`
  static mount).
