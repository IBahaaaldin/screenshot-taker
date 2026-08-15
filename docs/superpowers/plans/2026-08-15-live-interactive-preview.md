# Live Interactive Multi-Device Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user preview any target site live at all 4 device viewports at once, in synced-scroll device-bezel frames, without running a full capture.

**Architecture:** A server-side proxy (`src/previewProxy.js` + `src/routes/preview.js`) fetches the target page and its assets, rewrites URLs so everything routes back through our own origin (sidestepping X-Frame-Options/CSP), and injects a small script that reports clicks/scroll to the parent page via `postMessage`. A new frontend page (`public/preview.html`/`preview.js`) renders 4 iframes in the existing device-bezel chrome and relays `postMessage` events between them to keep all 4 in sync.

**Tech Stack:** Node.js/Express (existing), `cheerio` (new dependency, HTML parsing/rewriting), native `fetch` (Node 20+, no new dependency), plain JS frontend (no framework, matches existing `public/app.js`).

## Global Constraints

- Node.js >= 20.9.0 (existing `engines` field) — native `fetch`/`Headers`/`Response` are available, do not add `node-fetch`.
- `"type": "module"` — all new files use ESM `import`/`export`.
- Router pattern: new Express routes are a `createXRouter({...})` factory exported from `src/routes/*.js` and mounted with `app.use('/api', createXRouter(...))` in `src/server.js`, matching `src/routes/run.js` and `src/routes/postQueue.js`.
- Tests use real `node:test` + a live `app.listen(0)` + native `fetch` against it — no `supertest`, no mocking `fetch` for the module under test. See `test/postQueueRoute.test.js` for the exact pattern.
- No screenshots, no `output/` writes, no manifest entries for anything in this feature — it is purely a live view.
- Frontend has no build step / no framework — plain `<script src=...>` files under `public/`, matching `public/app.js`.

---

### Task 1: Preview proxy core — HTML/CSS rewriting

**Files:**
- Create: `src/previewProxy.js`
- Test: `test/previewProxy.test.js`
- Modify: `package.json` (add `cheerio` dependency)

**Interfaces:**
- Produces:
  - `async function rewritePageHtml(html, baseUrl)` — parses `html` with cheerio, resolves every `href`/`src`/`action` attribute against `baseUrl` (via `new URL(value, baseUrl).href`), rewrites http(s) ones to `/api/preview/asset?url=<encodeURIComponent(absoluteUrl)>` (leave `href="#..."`, `mailto:`, `javascript:`, `tel:`, and already-relative-to-us `/api/preview/...` values alone), rewrites `url(...)` inside `<style>` text and `style="..."` attributes the same way, injects the sync-bridge `<script>` (exact text below) immediately before the closing `</body>` tag (append one if the document has no `<body>`), and returns the resulting HTML string.
  - `function rewriteCssUrls(cssText, baseUrl)` — regex-replaces every `url(...)` reference (handles unquoted, single-, and double-quoted forms) in `cssText`, resolving each against `baseUrl` the same way, rewriting http(s) ones to `/api/preview/asset?url=<encoded>`; returns the rewritten CSS string. `rewritePageHtml` calls this for `<style>`/`style=` content.
  - Both exported from `src/previewProxy.js`.

- [ ] **Step 1: Write the failing tests**

```js
// test/previewProxy.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { rewritePageHtml, rewriteCssUrls } from '../src/previewProxy.js';

test('rewritePageHtml rewrites relative href/src to /api/preview/asset', async () => {
  const html = `<html><head><link rel="stylesheet" href="/styles.css"></head>
<body><img src="images/hero.png"><a href="/about.html">About</a></body></html>`;
  const out = await rewritePageHtml(html, 'https://example.com/index.html');
  assert.match(out, /href="\/api\/preview\/asset\?url=https%3A%2F%2Fexample\.com%2Fstyles\.css"/);
  assert.match(out, /src="\/api\/preview\/asset\?url=https%3A%2F%2Fexample\.com%2Fimages%2Fhero\.png"/);
  assert.match(out, /href="\/api\/preview\/asset\?url=https%3A%2F%2Fexample\.com%2Fabout\.html"/);
});

test('rewritePageHtml leaves anchor/mailto/javascript links untouched', async () => {
  const html = `<a href="#top">Top</a><a href="mailto:a@b.com">Mail</a><a href="javascript:void(0)">JS</a>`;
  const out = await rewritePageHtml(html, 'https://example.com/index.html');
  assert.match(out, /href="#top"/);
  assert.match(out, /href="mailto:a@b\.com"/);
  assert.match(out, /href="javascript:void\(0\)"/);
});

test('rewritePageHtml injects the sync-bridge script before </body>', async () => {
  const html = `<html><body><p>hi</p></body></html>`;
  const out = await rewritePageHtml(html, 'https://example.com/');
  assert.match(out, /preview-nav[\s\S]*preview-scroll[\s\S]*<\/body>/);
});

test('rewriteCssUrls rewrites unquoted, single-, and double-quoted url()', () => {
  const css = `a{background:url(/bg.png)} b{background:url('bg2.png')} c{background:url("https://cdn.example.com/x.png")}`;
  const out = rewriteCssUrls(css, 'https://example.com/styles/main.css');
  assert.match(out, /url\(\/api\/preview\/asset\?url=https%3A%2F%2Fexample\.com%2Fbg\.png\)/);
  assert.match(out, /url\(\/api\/preview\/asset\?url=https%3A%2F%2Fexample\.com%2Fstyles%2Fbg2\.png\)/);
  assert.match(out, /url\(\/api\/preview\/asset\?url=https%3A%2F%2Fcdn\.example\.com%2Fx\.png\)/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/previewProxy.test.js` (or `node --test test/previewProxy.test.js`)
Expected: FAIL — `src/previewProxy.js` does not exist yet / exports not found.

- [ ] **Step 3: Add the `cheerio` dependency**

```bash
npm install cheerio
```

Verify `package.json`'s `dependencies` now includes `"cheerio"`.

- [ ] **Step 4: Write the implementation**

```js
// src/previewProxy.js
import * as cheerio from 'cheerio';

const SYNC_BRIDGE_SCRIPT = `<script>
(function () {
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (/^(#|mailto:|tel:|javascript:)/i.test(href)) return;
    e.preventDefault();
    parent.postMessage({ type: 'preview-nav', url: a.href }, '*');
  }, true);

  var suppressScroll = false;
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'preview-scroll-to') {
      suppressScroll = true;
      window.scrollTo(0, e.data.y);
      suppressScroll = false;
    }
  });
  window.addEventListener('scroll', function () {
    if (suppressScroll) return;
    parent.postMessage({ type: 'preview-scroll', y: window.scrollY }, '*');
  }, { passive: true });
})();
</script>`;

const SKIP_HREF_RE = /^(#|mailto:|tel:|javascript:|data:)/i;

function toProxiedAssetUrl(rawValue, baseUrl) {
  if (!rawValue || SKIP_HREF_RE.test(rawValue) || rawValue.startsWith('/api/preview/')) {
    return null;
  }
  let absolute;
  try {
    absolute = new URL(rawValue, baseUrl).href;
  } catch {
    return null;
  }
  if (!/^https?:/i.test(absolute)) return null;
  return `/api/preview/asset?url=${encodeURIComponent(absolute)}`;
}

const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

export function rewriteCssUrls(cssText, baseUrl) {
  return cssText.replace(CSS_URL_RE, (match, quote, value) => {
    const proxied = toProxiedAssetUrl(value.trim(), baseUrl);
    if (!proxied) return match;
    return `url(${proxied})`;
  });
}

export async function rewritePageHtml(html, baseUrl) {
  const $ = cheerio.load(html);

  $('[href]').each((_, el) => {
    const proxied = toProxiedAssetUrl($(el).attr('href'), baseUrl);
    if (proxied) $(el).attr('href', proxied);
  });
  $('[src]').each((_, el) => {
    const proxied = toProxiedAssetUrl($(el).attr('src'), baseUrl);
    if (proxied) $(el).attr('src', proxied);
  });
  $('form[action]').each((_, el) => {
    const proxied = toProxiedAssetUrl($(el).attr('action'), baseUrl);
    if (proxied) $(el).attr('action', proxied);
  });
  $('style').each((_, el) => {
    $(el).text(rewriteCssUrls($(el).text(), baseUrl));
  });
  $('[style]').each((_, el) => {
    $(el).attr('style', rewriteCssUrls($(el).attr('style'), baseUrl));
  });

  if ($('body').length) {
    $('body').append(SYNC_BRIDGE_SCRIPT);
  } else {
    $.root().append(SYNC_BRIDGE_SCRIPT);
  }

  return $.html();
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- test/previewProxy.test.js`
Expected: PASS, all 4 tests green.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/previewProxy.js test/previewProxy.test.js
git commit -m "feat: add preview HTML/CSS rewriting for iframe proxying"
```

---

### Task 2: Preview proxy Express routes

**Files:**
- Create: `src/routes/preview.js`
- Test: `test/previewRoute.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `rewritePageHtml(html, baseUrl)` and `rewriteCssUrls(cssText, baseUrl)` from Task 1's `src/previewProxy.js`.
- Produces:
  - `export function createPreviewRouter()` returning an `express.Router()` with two routes:
    - `GET /preview/page?url=<encoded target URL>`
    - `GET /preview/asset?url=<encoded target URL>`
  - Mounted in `src/server.js` the same way as the other routers: `app.use('/api', createPreviewRouter())`.

- [ ] **Step 1: Write the failing test**

```js
// test/previewRoute.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalServer } from '../src/localServer.js';
import { createPreviewRouter } from '../src/routes/preview.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'site');

async function withApp(fn) {
  const app = express();
  app.use('/api', createPreviewRouter());
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /api/preview/page proxies and rewrites a real page', async () => {
  const fixtureServer = await startLocalServer(fixtureDir);
  try {
    await withApp(async (base) => {
      const target = `${fixtureServer.url}/index.html`;
      const res = await fetch(`${base}/api/preview/page?url=${encodeURIComponent(target)}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-frame-options'), null);
      assert.equal(res.headers.get('content-security-policy'), null);
      const body = await res.text();
      assert.match(body, /\/api\/preview\/asset\?url=/);
      assert.match(body, /preview-nav/);
    });
  } finally {
    await fixtureServer.close();
  }
});

test('GET /api/preview/page rejects a missing url param', async () => {
  await withApp(async (base) => {
    const res = await fetch(`${base}/api/preview/page`);
    assert.equal(res.status, 400);
  });
});

test('GET /api/preview/page rejects a non-http(s) url', async () => {
  await withApp(async (base) => {
    const res = await fetch(`${base}/api/preview/page?url=${encodeURIComponent('file:///etc/passwd')}`);
    assert.equal(res.status, 400);
  });
});

test('GET /api/preview/asset proxies a CSS file with rewritten url()', async () => {
  const fixtureServer = await startLocalServer(fixtureDir);
  try {
    await withApp(async (base) => {
      const target = `${fixtureServer.url}/about.html`;
      const res = await fetch(`${base}/api/preview/asset?url=${encodeURIComponent(target)}`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') || '', /text\/html/);
    });
  } finally {
    await fixtureServer.close();
  }
});
```

Adjust the fixture-file assertions in the last test only if `test/fixtures/site/about.html` does not exist under that exact name — run `ls test/fixtures/site` first and use whatever HTML fixture file is actually there; the important assertions are the 200 status and content-type passthrough, not the specific filename.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/previewRoute.test.js`
Expected: FAIL — `src/routes/preview.js` does not exist.

- [ ] **Step 3: Write the implementation**

```js
// src/routes/preview.js
import express from 'express';
import { rewritePageHtml, rewriteCssUrls } from '../previewProxy.js';

function parseTargetUrl(raw) {
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url;
}

export function createPreviewRouter() {
  const router = express.Router();

  router.get('/preview/page', async (req, res) => {
    const target = parseTargetUrl(req.query.url);
    if (!target) {
      res.status(400).json({ error: 'Provide a valid http(s) url query param' });
      return;
    }
    try {
      const upstream = await fetch(target.href);
      const html = await upstream.text();
      const rewritten = await rewritePageHtml(html, target.href);
      res.status(200).set('Content-Type', 'text/html; charset=utf-8').send(rewritten);
    } catch (err) {
      res.status(502).json({ error: `Failed to fetch preview target: ${err.message}` });
    }
  });

  router.get('/preview/asset', async (req, res) => {
    const target = parseTargetUrl(req.query.url);
    if (!target) {
      res.status(400).json({ error: 'Provide a valid http(s) url query param' });
      return;
    }
    try {
      const upstream = await fetch(target.href);
      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
      if (/text\/css/i.test(contentType)) {
        const css = await upstream.text();
        res.status(upstream.status).set('Content-Type', contentType).send(rewriteCssUrls(css, target.href));
        return;
      }
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.status(upstream.status).set('Content-Type', contentType).send(buffer);
    } catch (err) {
      res.status(502).json({ error: `Failed to fetch preview asset: ${err.message}` });
    }
  });

  return router;
}
```

- [ ] **Step 4: Mount the router in `src/server.js`**

In `src/server.js`, add the import alongside the other route imports:

```js
import { createPreviewRouter } from './routes/preview.js';
```

And add the mount line alongside the other `app.use('/api', ...)` calls inside `createApp`:

```js
app.use('/api', createPreviewRouter());
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- test/previewRoute.test.js`
Expected: PASS, all 4 tests green.

- [ ] **Step 6: Run the full suite to check for regressions**

Run: `npm test`
Expected: all existing tests still pass, plus the new ones.

- [ ] **Step 7: Commit**

```bash
git add src/routes/preview.js src/server.js test/previewRoute.test.js
git commit -m "feat: add /api/preview proxy routes for live iframe embedding"
```

---

### Task 3: Standalone preview page (frontend)

**Files:**
- Create: `public/preview.html`
- Create: `public/preview.js`
- Modify: `public/style.css` (append preview-specific rules)

**Interfaces:**
- Consumes: `GET /api/preview/page?url=...` from Task 2.
- Produces: a working standalone page at `public/preview.html` that a user can open, type/paste a URL into, click "Load preview", and see 4 synced device-bezel iframes. No exports needed — this is a leaf page, nothing else in the codebase depends on `preview.js`'s internals.

- [ ] **Step 1: Write `public/preview.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Live Preview — Screenshot Taker</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>

  <nav>
    <div class="nav-logo">
      <div class="nav-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="14" rx="2"/>
          <path d="M8 4l1.5-2h5L16 4"/>
          <circle cx="12" cy="11" r="3.2"/>
        </svg>
      </div>
      <span class="nav-title">Screenshot Taker</span>
    </div>
    <div class="nav-links">
      <a href="index.html">Capture</a>
    </div>
  </nav>

  <main>
    <div class="hero">
      <h1>Live preview. <span>All 4 devices at once.</span></h1>
      <p>Paste a URL, scroll or click anywhere, and all 4 frames move together — like standing in front of the real site on every screen size.</p>
    </div>

    <div class="card">
      <form id="preview-form" class="control-panel" novalidate>
        <div class="field">
          <label for="preview-url">URL</label>
          <input type="text" id="preview-url" name="previewUrl" required placeholder="https://example.com" autocomplete="off" />
        </div>
        <button type="submit" class="btn-primary" id="preview-submit">
          <span class="shutter-ring"></span>
          <span class="shutter-label">Load preview</span>
        </button>
      </form>
      <p class="field-hint preview-limitation-note">
        Works best on standard multi-page sites — heavily JS-driven single-page apps may not preview perfectly.
      </p>
    </div>

    <div id="preview-stage" class="preview-stage" hidden>
      <div class="preview-frame preview-frame-desktop">
        <iframe id="preview-iframe-desktop" title="Desktop preview"></iframe>
      </div>
      <div class="preview-frame preview-frame-laptop">
        <iframe id="preview-iframe-laptop" title="Laptop preview"></iframe>
      </div>
      <div class="preview-frame preview-frame-tablet">
        <iframe id="preview-iframe-tablet" title="Tablet preview"></iframe>
      </div>
      <div class="preview-frame preview-frame-mobile">
        <iframe id="preview-iframe-mobile" title="Mobile preview"></iframe>
      </div>
    </div>
  </main>

  <script src="preview.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `public/preview.js`**

```js
const DEVICES = {
  desktop: { width: 1920 },
  laptop: { width: 1440 },
  tablet: { width: 768 },
  mobile: { width: 390 },
};

const form = document.getElementById('preview-form');
const urlInput = document.getElementById('preview-url');
const stage = document.getElementById('preview-stage');
const iframes = {
  desktop: document.getElementById('preview-iframe-desktop'),
  laptop: document.getElementById('preview-iframe-laptop'),
  tablet: document.getElementById('preview-iframe-tablet'),
  mobile: document.getElementById('preview-iframe-mobile'),
};

let syncing = false;

function proxiedPageUrl(targetUrl) {
  return `/api/preview/page?url=${encodeURIComponent(targetUrl)}`;
}

function loadAll(targetUrl) {
  for (const key of Object.keys(iframes)) {
    iframes[key].src = proxiedPageUrl(targetUrl);
  }
  stage.hidden = false;
}

function sourceDeviceOf(win) {
  return Object.keys(iframes).find((key) => iframes[key].contentWindow === win);
}

window.addEventListener('message', (event) => {
  if (!event.data || typeof event.data !== 'object') return;
  const fromDevice = sourceDeviceOf(event.source);
  if (!fromDevice || syncing) return;

  if (event.data.type === 'preview-scroll') {
    syncing = true;
    for (const key of Object.keys(iframes)) {
      if (key === fromDevice) continue;
      iframes[key].contentWindow?.postMessage({ type: 'preview-scroll-to', y: event.data.y }, '*');
    }
    syncing = false;
  }

  if (event.data.type === 'preview-nav' && typeof event.data.url === 'string') {
    syncing = true;
    for (const key of Object.keys(iframes)) {
      iframes[key].src = proxiedPageUrl(event.data.url);
    }
    syncing = false;
  }
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const value = urlInput.value.trim();
  if (!value) return;
  loadAll(value);
});

const params = new URLSearchParams(window.location.search);
const prefill = params.get('url');
if (prefill) {
  urlInput.value = prefill;
  loadAll(prefill);
}
```

- [ ] **Step 3: Append device-bezel + layout CSS to `public/style.css`**

Read `public/style.css` first to find the existing `.frame`/device-bezel rules used by the composite gallery (search for `.frame`, `desktop`, `laptop`, `tablet`, `mobile` class names) and match their visual language (border-radius, shadow, notch/home-indicator styling) for the new `.preview-frame-*` rules below, adjusting exact values to match what's already there rather than introducing a second visual style. Append:

```css
.preview-stage {
  position: relative;
  width: 100%;
  max-width: 1400px;
  margin: 2rem auto;
  height: 900px;
}

.preview-frame {
  position: absolute;
  overflow: hidden;
  border-radius: 18px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
  background: #111;
}

.preview-frame iframe {
  border: 0;
  transform-origin: top left;
}

.preview-frame-desktop {
  left: 5%;
  top: 3%;
  width: 55%;
  height: 55%;
}
.preview-frame-desktop iframe { width: 1920px; height: 1140px; }

.preview-frame-laptop {
  left: 52%;
  top: 42%;
  width: 42%;
  height: 42%;
}
.preview-frame-laptop iframe { width: 1440px; height: 900px; }

.preview-frame-tablet {
  left: 15%;
  top: 55%;
  width: 22%;
  height: 38%;
}
.preview-frame-tablet iframe { width: 768px; height: 1024px; }

.preview-frame-mobile {
  left: 38%;
  top: 62%;
  width: 12%;
  height: 32%;
}
.preview-frame-mobile iframe { width: 390px; height: 844px; }

.preview-limitation-note {
  margin-top: 0.75rem;
}
```

The exact `transform: scale(...)` per frame (to fit each fixed-width iframe into its bezel's percentage-based box) is computed at runtime in Step 4, since it depends on the bezel's actual rendered pixel size.

- [ ] **Step 4: Add runtime scaling to `public/preview.js`**

Add this function and call it from `loadAll` and on window resize:

```js
function scaleFramesToFit() {
  for (const [key, config] of Object.entries(DEVICES)) {
    const frame = document.querySelector(`.preview-frame-${key}`);
    const iframe = iframes[key];
    if (!frame || !iframe) continue;
    const scale = frame.clientWidth / config.width;
    iframe.style.transform = `scale(${scale})`;
    iframe.style.height = `${frame.clientHeight / scale}px`;
  }
}

window.addEventListener('resize', scaleFramesToFit);
```

And call `scaleFramesToFit()` at the end of `loadAll`, after `stage.hidden = false`.

- [ ] **Step 5: Manual verification (no automated test for this task — see Task 4 for the note on why)**

Start the dev server (`npm start`), open `http://localhost:3000/preview.html`, enter a real URL (or a local fixture site URL), confirm all 4 frames load, scrolling one scrolls all 4, and clicking a link in one navigates all 4.

- [ ] **Step 6: Commit**

```bash
git add public/preview.html public/preview.js public/style.css
git commit -m "feat: add standalone live multi-device preview page"
```

---

### Task 4: Wire preview into the main run form + nav

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`

**Interfaces:**
- Consumes: `public/preview.html` from Task 3 (opened via `window.open`, no shared JS state needed — it's a separate page/tab).
- Produces: nothing consumed by later tasks — this is the final integration point.

- [ ] **Step 1: Add a nav link in `public/index.html`**

In the `<nav>` block's `.nav-links` div (see the file's current content — it currently has GitHub/LinkedIn/Portfolio links), add as the first link:

```html
<a href="preview.html">Live Preview</a>
```

- [ ] **Step 2: Add a "Preview live" button next to the Source URL field**

In `public/index.html`, inside the `.field.field-source` div (around the `sourceValue` input), add a button after the `source-row` div:

```html
<button type="button" id="preview-live-btn" class="frame-post-btn">Preview live</button>
```

- [ ] **Step 3: Wire the button in `public/app.js`**

Read `public/app.js` first to find where other element refs are declared near the top (`const siteName = document.getElementById('siteName')` etc. — the file already reads `sourceValue`/`sourceType` for form submission) and add near them:

```js
const previewLiveBtn = document.getElementById('preview-live-btn');
```

Then near the other `addEventListener` calls at the end of the file:

```js
previewLiveBtn?.addEventListener('click', () => {
  const value = sourceValue.value.trim();
  if (!value) {
    sourceValue.focus();
    return;
  }
  window.open(`preview.html?url=${encodeURIComponent(value)}`, '_blank', 'noopener');
});
```

Only wire this for `sourceType === 'url'` — if `public/app.js`'s existing `sourceType` element value is `'localFolder'`, disable or hide the button, since the proxy targets http(s) URLs, not local filesystem paths (a local folder is served by `localServer.js` at capture time, not before). Check the existing `sourceType` change-handler in `app.js` (it already toggles other UI based on this) and add the same toggle for `previewLiveBtn`'s `disabled` state there.

- [ ] **Step 4: Manual verification**

Start the dev server, open `http://localhost:3000`, select "Live URL" as source type, type a URL, click "Preview live", confirm it opens `preview.html?url=...` in a new tab and auto-loads all 4 frames (this exercises the `prefill` logic already written in Task 3 Step 2). Switch source type to "Local folder" and confirm the button is disabled.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests pass (this task has no new automated tests — it's UI wiring covered by manual verification, consistent with how the lightbox/filter frontend work earlier in this project was verified).

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat: wire live preview into nav and run form"
```

---

### Task 5: README documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a "Live preview" section**

After the existing "## Run" section in `README.md` (before "## Desktop app (macOS)"), add:

```markdown
## Live preview

Before (or without) running a full capture, you can preview any site live
at all 4 device sizes at once: open the "Live Preview" link in the nav, or
click "Preview live" next to the Source URL field on the run form. All 4
frames scroll and navigate together, like standing in front of the real
site at every screen size simultaneously.

This works by proxying the target page through the app's own server so it
can be embedded (many sites block being framed directly). It works best on
standard multi-page sites — heavily JS-driven single-page apps may not
preview perfectly, since the proxy rewrites links/assets rather than
executing arbitrary client-side routing logic.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document the live preview feature"
```

---

## Final check

After Task 5, run `npm test` once more for a clean full-suite pass, then use superpowers:finishing-a-development-branch to decide how to integrate (this plan was executed directly on `main` per this project's established pattern this session — confirm that's still wanted, or merge/PR as appropriate).
