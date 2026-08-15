# Screen Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the live-preview page, record an auto-scrolling walkthrough of the target site across all 4 synced device viewports as a downloadable Instagram-ready MP4.

**Architecture:** `src/screenRecorder.js` drives a headless Playwright browser that navigates to the app's own `preview.html?url=...` (the existing live-preview page), waits for it to settle, measures scroll distance from the desktop iframe, and scrolls it with real mouse-wheel input — the already-built sync bridge relays that to the other 3 iframes with no new sync code. Playwright records the whole browser viewport as WebM; `ffmpeg-static`'s bundled binary transcodes it to H.264 MP4. `POST /api/preview/record` wires this into the app and serves the result from the existing `/output` static mount. The frontend gets a "Record video" button next to "Load preview" that shows the result in a `<video>` element with a download link.

## Global Constraints

- Node.js >= 20.9.0, `"type": "module"` ESM throughout.
- Router pattern: `createXRouter({...})` factory in `src/routes/*.js`, mounted via `app.use('/api', createXRouter(...))` in `src/server.js` — matches `src/routes/run.js`, `src/routes/postQueue.js`, `src/routes/preview.js`.
- `createPreviewRouter` currently takes no arguments (`createPreviewRouter()`); this plan changes its signature to `createPreviewRouter({ outputRoot })` since it now needs to know where to write recordings — update both the export and its mount site in `src/server.js` together in the same task.
- Tests use real `node:test` + a live `app.listen(0)` + native `fetch`/real Playwright — no mocking, matching every other test in this project (`test/postQueueRoute.test.js`, `test/previewRoute.test.js`, `test/screenshot.test.js` for the real-browser pattern).
- No new frontend framework/build step — plain `<script src>`, matching `public/preview.js`.
- `ffmpeg-static` is a new dependency: bundles a prebuilt `ffmpeg` binary per-platform, exposed as its default export (the resolved binary path). Do not add any other video/ffmpeg package.
- Recordings are ad hoc, not tied to a capture run or `manifest.json` — stored at `output/recordings/<uuid>.mp4`, no retention/cleanup logic (YAGNI for a single-user local tool, same reasoning already applied to the live-preview feature's parked cache-growth item).
- `public/preview.html`'s `<main>` is currently capped at `max-width: 760px` (`public/style.css:80`, a project-wide rule for every page), which silently shrinks `.preview-stage`'s intended `max-width: 1400px` (`public/style.css:747`) down to ~760px in practice — a pre-existing layout bug that affects both the live preview and (now) the recording's visual quality. Task 3 fixes this with a page-scoped override, since a cramped 760px recording undermines the whole point of this feature.

---

### Task 1: Screen recorder core module

**Files:**
- Create: `src/screenRecorder.js`
- Test: `test/screenRecorder.test.js`
- Modify: `package.json` (add `ffmpeg-static` dependency)

**Interfaces:**
- Produces: `async function recordSitePreview({ url, previewBaseUrl, outputDir })` — returns `{ mp4Path, durationMs }`. `outputDir` is where the final MP4 is written (the caller does not need to move it further); `previewBaseUrl` is the origin to navigate to (e.g. `http://127.0.0.1:3000`), so this module has no knowledge of Express/routing.

- [ ] **Step 1: Write the failing test**

```js
// test/screenRecorder.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { startLocalServer } from '../src/localServer.js';
import { createPreviewRouter } from '../src/routes/preview.js';
import { recordSitePreview } from '../src/screenRecorder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'site');

test('recordSitePreview produces a nonzero-size MP4 with a valid ftyp header', async (t) => {
  const fixtureServer = await startLocalServer(fixtureDir);
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'screenshot-taker-test-'));

  // A minimal app serving preview.html/preview.js/style.css plus the
  // preview proxy routes, so recordSitePreview has a real page to visit.
  const app = express();
  app.use('/api', createPreviewRouter({ outputRoot }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const previewBaseUrl = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await fixtureServer.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const recordDir = await fs.mkdtemp(path.join(os.tmpdir(), 'screenshot-taker-record-'));
  t.after(() => fs.rm(recordDir, { recursive: true, force: true }));

  const { mp4Path, durationMs } = await recordSitePreview({
    url: `${fixtureServer.url}/index.html`,
    previewBaseUrl,
    outputDir: recordDir,
  });

  assert.ok(durationMs >= 4000, 'duration floors at 4000ms for a short fixture page');

  const stat = await fs.stat(mp4Path);
  assert.ok(stat.size > 0, 'mp4 file has nonzero size');

  const fd = await fs.open(mp4Path, 'r');
  const buffer = Buffer.alloc(12);
  await fd.read(buffer, 0, 12, 0);
  await fd.close();
  // MP4 files carry an 'ftyp' box; its 4-byte type tag sits at offset 4.
  assert.equal(buffer.toString('ascii', 4, 8), 'ftyp', 'output starts with a valid MP4 ftyp box');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/screenRecorder.test.js` (or `node --test test/screenRecorder.test.js`)
Expected: FAIL — `src/screenRecorder.js` does not exist, and `createPreviewRouter` does not yet accept `{ outputRoot }` (Task 2 changes that signature; for THIS task's test to run, `createPreviewRouter({ outputRoot })` just needs to not throw — check `src/routes/preview.js`'s current signature is `createPreviewRouter()` with no params, which already tolerates being called with an ignored argument object, so this test can be written now and will naturally start exercising the real `outputRoot` wiring once Task 2 lands; do not block Task 1 on Task 2).

- [ ] **Step 3: Add the `ffmpeg-static` dependency**

```bash
npm install ffmpeg-static
```

Verify `package.json`'s `dependencies` now includes `"ffmpeg-static"`.

- [ ] **Step 4: Write the implementation**

```js
// src/screenRecorder.js
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import ffmpegPath from 'ffmpeg-static';

const execFileAsync = promisify(execFile);

const STAGE_VIEWPORT = { width: 1450, height: 960 };
const SETTLE_WAIT_MS = 2500;
const SCROLL_SPEED_PX_PER_MS = 0.5;
const MIN_DURATION_MS = 4000;
const MAX_DURATION_MS = 15000;
const SCROLL_TICK_MS = 100;

export async function recordSitePreview({ url, previewBaseUrl, outputDir }) {
  const videoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'screenshot-taker-video-'));
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: STAGE_VIEWPORT,
      recordVideo: { dir: videoDir, size: STAGE_VIEWPORT },
    });
    const page = await context.newPage();
    try {
      const previewUrl = `${previewBaseUrl}/preview.html?url=${encodeURIComponent(url)}`;
      await page.goto(previewUrl, { waitUntil: 'load', timeout: 20000 });
      await page.waitForSelector('#preview-stage:not([hidden])', { timeout: 15000 });
      await page.waitForTimeout(SETTLE_WAIT_MS);

      const desktopHandle = await page.$('#preview-iframe-desktop');
      const desktopFrame = desktopHandle ? await desktopHandle.contentFrame() : null;

      let scrollDistance = 0;
      if (desktopFrame) {
        try {
          scrollDistance = await desktopFrame.evaluate(
            () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
          );
        } catch {
          scrollDistance = 0;
        }
      }

      const durationMs = Math.min(
        MAX_DURATION_MS,
        Math.max(MIN_DURATION_MS, scrollDistance / SCROLL_SPEED_PX_PER_MS)
      );

      if (scrollDistance > 0 && desktopHandle) {
        const box = await desktopHandle.boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          const ticks = Math.max(1, Math.round(durationMs / SCROLL_TICK_MS));
          const deltaPerTick = scrollDistance / ticks;
          for (let i = 0; i < ticks; i++) {
            await page.mouse.wheel(0, deltaPerTick);
            await page.waitForTimeout(SCROLL_TICK_MS);
          }
        } else {
          await page.waitForTimeout(durationMs);
        }
      } else {
        await page.waitForTimeout(durationMs);
      }

      const video = page.video();
      await page.close();
      await context.close();
      const webmPath = video ? await video.path() : null;
      if (!webmPath) {
        throw new Error('Playwright did not produce a video recording');
      }

      await fs.mkdir(outputDir, { recursive: true });
      const mp4Path = path.join(outputDir, `${path.basename(webmPath, path.extname(webmPath))}.mp4`);
      await execFileAsync(ffmpegPath, [
        '-y',
        '-i', webmPath,
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        mp4Path,
      ]);
      await fs.rm(webmPath, { force: true });

      return { mp4Path, durationMs };
    } finally {
      if (!page.isClosed()) await page.close().catch(() => {});
    }
  } finally {
    await browser.close();
    await fs.rm(videoDir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- test/screenRecorder.test.js`
Expected: PASS. This test launches a real browser and runs real ffmpeg, so allow it extra time (a `node --test` default timeout is generous, but if it times out, that's a real signal something in the record/transcode flow is hanging — investigate rather than just raising the timeout).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/screenRecorder.js test/screenRecorder.test.js
git commit -m "feat: add screen recording core module (Playwright + ffmpeg-static)"
```

---

### Task 2: Recording route

**Files:**
- Modify: `src/routes/preview.js`
- Modify: `src/server.js`
- Test: `test/previewRecordRoute.test.js`

**Interfaces:**
- Consumes: `recordSitePreview({ url, previewBaseUrl, outputDir })` from Task 1's `src/screenRecorder.js`.
- Produces: `createPreviewRouter({ outputRoot })` — note the signature change from today's zero-arg `createPreviewRouter()`. `POST /preview/record` route, body `{ url }`, responds `{ downloadUrl, durationMs }` on success.

- [ ] **Step 1: Write the failing test**

```js
// test/previewRecordRoute.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { startLocalServer } from '../src/localServer.js';
import { createPreviewRouter } from '../src/routes/preview.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'site');

test('POST /api/preview/record records a video and serves it from /output', async (t) => {
  const fixtureServer = await startLocalServer(fixtureDir);
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'screenshot-taker-test-'));

  const app = express();
  app.use(express.json());
  app.use('/api', createPreviewRouter({ outputRoot }));
  app.use('/output', express.static(outputRoot));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await fixtureServer.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const res = await fetch(`${base}/api/preview/record`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `${fixtureServer.url}/index.html` }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.downloadUrl, /^\/output\/recordings\/[a-f0-9-]+\.mp4$/);
  assert.ok(body.durationMs >= 4000);

  const videoRes = await fetch(`${base}${body.downloadUrl}`);
  assert.equal(videoRes.status, 200);
  assert.match(videoRes.headers.get('content-type') || '', /video\/mp4/);
});

test('POST /api/preview/record rejects a missing url', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'screenshot-taker-test-'));
  const app = express();
  app.use(express.json());
  app.use('/api', createPreviewRouter({ outputRoot }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const res = await fetch(`${base}/api/preview/record`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/previewRecordRoute.test.js`
Expected: FAIL — no `/preview/record` route exists yet, and `createPreviewRouter` ignores its argument.

- [ ] **Step 3: Update `src/routes/preview.js`**

Add these imports to the top of `src/routes/preview.js`, alongside the existing ones:

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { recordSitePreview } from '../screenRecorder.js';
```

Change the factory's signature line from `export function createPreviewRouter() {` to `export function createPreviewRouter({ outputRoot } = {}) {` — leave the function body's existing `/preview/page` and `/preview/asset` route handlers exactly as they are today, and add this new route among them (order doesn't matter):

```js
  router.post('/preview/record', async (req, res) => {
    const target = parseTargetUrl(req.body?.url);
    if (!target) {
      res.status(400).json({ error: 'Provide a valid http(s) url in the request body' });
      return;
    }
    if (!outputRoot) {
      res.status(500).json({ error: 'Recording is not configured (missing outputRoot)' });
      return;
    }
    try {
      const recordingsDir = path.join(outputRoot, 'recordings');
      const previewBaseUrl = `${req.protocol}://${req.get('host')}`;
      const { mp4Path, durationMs } = await recordSitePreview({
        url: target.href,
        previewBaseUrl,
        outputDir: recordingsDir,
      });
      const finalName = `${crypto.randomUUID()}.mp4`;
      const finalPath = path.join(recordingsDir, finalName);
      if (path.resolve(mp4Path) !== path.resolve(finalPath)) {
        await fs.rename(mp4Path, finalPath);
      }
      res.status(200).json({ downloadUrl: `/output/recordings/${finalName}`, durationMs });
    } catch (err) {
      res.status(502).json({ error: `Failed to record preview: ${err.message}` });
    }
  });
```

- [ ] **Step 4: Update `src/server.js`**

Change the mount line from:

```js
app.use('/api', createPreviewRouter());
```

to:

```js
app.use('/api', createPreviewRouter({ outputRoot }));
```

`outputRoot` is already an in-scope variable at this point in `createApp` (it's the function's own parameter, used by the other routers) — no new variable needed.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- test/previewRecordRoute.test.js test/screenRecorder.test.js`
Expected: PASS. Task 1's test should now also be exercising the real `createPreviewRouter({ outputRoot })` wiring correctly.

- [ ] **Step 6: Run the full suite to check for regressions**

Run: `npm test`
Expected: all existing tests still pass (in particular `test/previewRoute.test.js`, which calls `createPreviewRouter()` with no arguments in some of its setup — confirm the `{ outputRoot } = {}` default parameter keeps those calls working unchanged).

- [ ] **Step 7: Commit**

```bash
git add src/routes/preview.js src/server.js test/previewRecordRoute.test.js
git commit -m "feat: add POST /api/preview/record route"
```

---

### Task 3: Frontend recording UI + preview-stage width fix

**Files:**
- Modify: `public/preview.html`
- Modify: `public/preview.js`
- Modify: `public/style.css`

**Interfaces:**
- Consumes: `POST /api/preview/record` from Task 2.
- Produces: nothing consumed by later tasks — this is a leaf UI feature.

- [ ] **Step 1: Fix the pre-existing `.preview-stage` width cap**

In `public/preview.html`, add an id to the body tag: change `<body>` to `<body id="preview-page">`.

In `public/style.css`, add near the existing `.preview-stage` rule (`public/style.css:744`):

```css
body#preview-page main {
  max-width: 1500px;
}
```

This is scoped to `preview.html` only (via the body id) — it does not affect `index.html` or any other page's `main` layout. Verify visually (or via `javascript_tool`/browser inspection if available) that `.preview-stage` now actually renders near its intended 1400px width instead of being clipped to `main`'s project-wide 760px cap.

- [ ] **Step 2: Add the "Record video" button and video-result markup to `public/preview.html`**

In the `.card` div, after the existing `<form id="preview-form">` and its closing `</form>` tag, add a second button and a hidden result area:

```html
<button type="button" id="record-video-btn" class="frame-post-btn" disabled>
  <span class="shutter-ring"></span>
  <span class="shutter-label">Record video</span>
</button>
```

Place this button right after the `</form>` closing tag, before the `<p class="field-hint preview-limitation-note">` paragraph.

After the `#preview-stage` div (i.e. as the last child of `<main>`, after `</div>` that closes `#preview-stage`), add:

```html
<div id="record-result" class="record-result" hidden>
  <video id="record-video" controls></video>
  <a id="record-download" href="#" download class="download-chip">Download video</a>
</div>
<p id="record-error" class="field-error" hidden></p>
```

- [ ] **Step 3: Wire the button in `public/preview.js`**

Add these element refs near the top, alongside the existing ones:

```js
const recordBtn = document.getElementById('record-video-btn');
const recordResult = document.getElementById('record-result');
const recordVideo = document.getElementById('record-video');
const recordDownload = document.getElementById('record-download');
const recordError = document.getElementById('record-error');
```

Track the currently-loaded URL so the record button knows what to send — add a module-level variable and set it inside `loadAll`:

```js
let currentPreviewUrl = null;
```

In `loadAll(targetUrl)`, add `currentPreviewUrl = targetUrl;` as the first line, and add `recordBtn.disabled = false;` alongside the existing `stage.hidden = false;` line.

Add the click handler, near the existing `form.addEventListener('submit', ...)` block:

```js
recordBtn.addEventListener('click', async () => {
  if (!currentPreviewUrl) return;
  recordError.hidden = true;
  recordResult.hidden = true;
  recordBtn.disabled = true;
  recordBtn.classList.add('is-loading');
  const labelEl = recordBtn.querySelector('.shutter-label');
  const originalLabel = labelEl.textContent;
  labelEl.textContent = 'Recording… ~15s';
  try {
    const res = await fetch('/api/preview/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: currentPreviewUrl }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || 'Recording failed');
    }
    recordVideo.src = body.downloadUrl;
    recordDownload.href = body.downloadUrl;
    recordResult.hidden = false;
  } catch (err) {
    recordError.textContent = err.message;
    recordError.hidden = false;
  } finally {
    recordBtn.disabled = false;
    recordBtn.classList.remove('is-loading');
    labelEl.textContent = originalLabel;
  }
});
```

Check `public/style.css` for how the existing `.btn-primary`'s `is-loading`/busy state is styled (search for `shutter-ring`, `is-loading`, or similar — the run form's submit button already has a spinner treatment) and confirm `.frame-post-btn` either already supports a comparable `is-loading` visual, or add a minimal one consistent with the existing pattern; do not introduce a second, visually distinct spinner style.

- [ ] **Step 4: Add minimal CSS for the result area**

In `public/style.css`, near the other preview-page rules:

```css
.record-result {
  margin-top: 1.5rem;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.75rem;
}

.record-result video {
  width: 100%;
  max-width: 420px;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
}
```

- [ ] **Step 5: Manual verification**

Start the dev server, open `preview.html`, load a real site, click "Record video", confirm: the button disables and shows a busy state, after roughly the expected duration a `<video>` appears with working playback controls and a working download link, and the recorded video actually shows all 4 devices scrolling in sync (not a blank/cramped frame — this confirms Step 1's width fix worked).

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all tests pass (this task has no new automated tests — UI wiring, verified manually, consistent with how Task 4 of the live-preview feature was handled).

- [ ] **Step 7: Commit**

```bash
git add public/preview.html public/preview.js public/style.css
git commit -m "feat: add screen recording UI to the live preview page"
```

---

### Task 4: README documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Extend the "Live preview" section**

In `README.md`, after the existing "## Live preview" section's paragraphs (added by the prior live-preview feature), add:

```markdown
From the live preview page, click "Record video" to get a downloadable
MP4 of the same synced 4-device view auto-scrolling through the page —
ready to post as a Reel or Story. Recording takes roughly the length of
the resulting clip (4-15 seconds, scaled to how long the page is) plus a
few seconds to launch and encode. Recordings are saved under
`output/recordings/` and aren't tied to a capture run.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document the screen recording feature"
```

---

## Final check

After Task 4, run `npm test` once more for a clean full-suite pass, then use superpowers:finishing-a-development-branch to decide how to integrate (this plan is expected to execute directly on `main`, per this project's established pattern — confirm that's still wanted).
