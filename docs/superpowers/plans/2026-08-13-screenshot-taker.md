# Screenshot Taker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Node.js web app that crawls a site, screenshots every section at 4 device viewports, builds a composite device-mockup image per section, and serves it all through a simple local UI with zip download.

**Architecture:** Express backend drives a Playwright (headless Chromium) pipeline: crawl → per-viewport section screenshots → composite render → manifest.json. A plain HTML/CSS/JS frontend submits a run, streams progress over Server-Sent Events, then renders a gallery from the manifest with a zip-download action.

**Tech Stack:** Node.js (>=18), Express, Playwright, archiver (zip), built-in `node:test` + `node:assert/strict` for tests, no frontend framework.

## Global Constraints

- Node.js >= 18 (built-in `node:test`, global `fetch`).
- Viewport presets are exactly: Desktop 1920px, Laptop 1440px, Tablet 768px, Mobile 390px — per spec.
- Output path structure is exactly: `output/<site>/<page>/<viewport>/<section-slug>.png` for raw shots, `output/<site>/<page>/composites/<section-slug>-composite.png` for composites, `output/<site>/manifest.json` for the manifest — per spec.
- Crawl is same-domain only, BFS, deduped, with a max-page safety cap.
- Page load timeout → retry once → skip + log, never crash the whole run.
- Auto-detect mode with zero sections found → fall back to full-page mode for that page, logged.
- No Instagram posting logic in this plan — manifest.json is the only future integration point.

---

## File Structure

```
package.json
.gitignore
src/
  viewports.js         # 4 viewport presets (data only)
  localServer.js        # ephemeral static file server for "local files" input
  crawler.js             # same-domain BFS page discovery
  sectionDetector.js    # section bounding-box detection (3 modes)
  screenshot.js          # per-viewport, per-section screenshot capture
  composite.js            # device-frame composite image builder
  manifest.js             # manifest.json read/write
  pipeline.js              # orchestrates crawler+screenshot+composite+manifest, emits progress
  server.js                # Express app wiring routes + static frontend
  routes/
    run.js                  # POST /api/run, GET /api/progress/:runId (SSE), GET /api/download/:runId
public/
  index.html                # form: URL, mode picker, run button, progress log, gallery
  app.js                     # frontend logic: submit run, SSE, render gallery
  style.css                  # minimal styling
test/
  fixtures/site/
    index.html
    about.html
    contact.html
  viewports.test.js
  localServer.test.js
  crawler.test.js
  sectionDetector.test.js
  screenshot.test.js
  composite.test.js
  manifest.test.js
  pipeline.test.js
  server.test.js
```

Each `src/` file has one responsibility and is consumed by `pipeline.js`, which `routes/run.js` calls. Tests mirror source files 1:1 except `pipeline.test.js` and `server.test.js`, which are integration tests over the fixture site.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `src/viewports.js`
- Test: `test/viewports.test.js`

**Interfaces:**
- Produces: `src/viewports.js` exports `VIEWPORTS`, an array of `{ name: string, width: number }`, in this exact order: `[{name:'desktop',width:1920},{name:'laptop',width:1440},{name:'tablet',width:768},{name:'mobile',width:390}]`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "screenshot-taker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=18" },
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test test/"
  },
  "dependencies": {
    "express": "^4.19.2",
    "playwright": "^1.47.0",
    "archiver": "^7.0.1"
  }
}
```

- [ ] **Step 2: Write `.gitignore`**

```
node_modules/
output/
*.log
```

- [ ] **Step 3: Install dependencies and Playwright browsers**

Run:
```bash
cd /Users/bahaam/Desktop/Screenshot-Taker
npm install
npx playwright install chromium
```
Expected: installs complete with no errors.

- [ ] **Step 4: Write the failing test for viewport presets**

```javascript
// test/viewports.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { VIEWPORTS } from '../src/viewports.js';

test('VIEWPORTS has exactly the 4 required presets in order', () => {
  assert.deepEqual(VIEWPORTS, [
    { name: 'desktop', width: 1920 },
    { name: 'laptop', width: 1440 },
    { name: 'tablet', width: 768 },
    { name: 'mobile', width: 390 },
  ]);
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `node --test test/viewports.test.js`
Expected: FAIL — `Cannot find module '../src/viewports.js'`

- [ ] **Step 6: Write `src/viewports.js`**

```javascript
// src/viewports.js
export const VIEWPORTS = [
  { name: 'desktop', width: 1920 },
  { name: 'laptop', width: 1440 },
  { name: 'tablet', width: 768 },
  { name: 'mobile', width: 390 },
];
```

- [ ] **Step 7: Run test to verify it passes**

Run: `node --test test/viewports.test.js`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git init
git add package.json .gitignore src/viewports.js test/viewports.test.js
git commit -m "feat: project scaffold and viewport presets"
```

---

### Task 2: Fixture test site

**Files:**
- Create: `test/fixtures/site/index.html`
- Create: `test/fixtures/site/about.html`
- Create: `test/fixtures/site/contact.html`

**Interfaces:**
- Produces: a 3-page static site fixture used by Tasks 3–9's tests. `index.html` links to `about.html` and `contact.html`; each page links back to `index.html`. `index.html` has 2 top-level sections, `about.html` and `contact.html` each have 1.

- [ ] **Step 1: Write `test/fixtures/site/index.html`**

```html
<!doctype html>
<html>
<head><title>Fixture Home</title></head>
<body>
  <section id="hero" style="height:400px;background:#eee;">
    <h1>Hero</h1>
    <a href="about.html">About</a>
    <a href="contact.html">Contact</a>
  </section>
  <section id="features" style="height:500px;background:#ddd;">
    <h2>Features</h2>
    <p>Some feature content here.</p>
  </section>
</body>
</html>
```

- [ ] **Step 2: Write `test/fixtures/site/about.html`**

```html
<!doctype html>
<html>
<head><title>Fixture About</title></head>
<body>
  <section id="about-content" style="height:600px;background:#eee;">
    <h1>About</h1>
    <a href="index.html">Home</a>
  </section>
</body>
</html>
```

- [ ] **Step 3: Write `test/fixtures/site/contact.html`**

```html
<!doctype html>
<html>
<head><title>Fixture Contact</title></head>
<body>
  <section id="contact-content" style="height:450px;background:#eee;">
    <h1>Contact</h1>
    <a href="index.html">Home</a>
  </section>
</body>
</html>
```

- [ ] **Step 4: Commit**

```bash
git add test/fixtures/site/
git commit -m "test: add fixture site for pipeline tests"
```

---

### Task 3: Local static file server

**Files:**
- Create: `src/localServer.js`
- Test: `test/localServer.test.js`

**Interfaces:**
- Produces: `src/localServer.js` exports `async function startLocalServer(folderPath)` returning `{ url: string, close: () => Promise<void> }`. `url` is `http://127.0.0.1:<port>` for the given folder, port auto-picked and free.

- [ ] **Step 1: Write the failing test**

```javascript
// test/localServer.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalServer } from '../src/localServer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'site');

test('startLocalServer serves the folder and returns a working url', async () => {
  const server = await startLocalServer(fixtureDir);
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);

  const res = await fetch(`${server.url}/index.html`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /Fixture Home/);

  await server.close();
});

test('startLocalServer picks a different free port on concurrent calls', async () => {
  const a = await startLocalServer(fixtureDir);
  const b = await startLocalServer(fixtureDir);
  assert.notEqual(a.url, b.url);
  await a.close();
  await b.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/localServer.test.js`
Expected: FAIL — `Cannot find module '../src/localServer.js'`

- [ ] **Step 3: Write `src/localServer.js`**

```javascript
// src/localServer.js
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

export async function startLocalServer(folderPath) {
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      let filePath = path.join(folderPath, urlPath);
      if (urlPath === '/' || urlPath === '') {
        filePath = path.join(folderPath, 'index.html');
      }
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(path.resolve(folderPath))) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      const data = await fs.readFile(resolved);
      const ext = path.extname(resolved);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(data);
    } catch (err) {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.on('error', reject);
  });

  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/localServer.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/localServer.js test/localServer.test.js
git commit -m "feat: ephemeral local static file server"
```

---

### Task 4: Site crawler

**Files:**
- Create: `src/crawler.js`
- Test: `test/crawler.test.js`

**Interfaces:**
- Consumes: `startLocalServer` from Task 3 (test only, to serve the fixture site).
- Produces: `src/crawler.js` exports `async function crawlSite(startUrl, { maxPages = 50 } = {})` returning `string[]` of same-domain page URLs found via BFS from `startUrl`, deduped, capped at `maxPages`.

- [ ] **Step 1: Write the failing test**

```javascript
// test/crawler.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalServer } from '../src/localServer.js';
import { crawlSite } from '../src/crawler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'site');

test('crawlSite discovers all same-domain pages from the fixture site', async () => {
  const server = await startLocalServer(fixtureDir);
  try {
    const pages = await crawlSite(`${server.url}/index.html`);
    const names = pages.map((u) => new URL(u).pathname).sort();
    assert.deepEqual(names, ['/about.html', '/contact.html', '/index.html']);
  } finally {
    await server.close();
  }
});

test('crawlSite respects maxPages cap', async () => {
  const server = await startLocalServer(fixtureDir);
  try {
    const pages = await crawlSite(`${server.url}/index.html`, { maxPages: 1 });
    assert.equal(pages.length, 1);
  } finally {
    await server.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/crawler.test.js`
Expected: FAIL — `Cannot find module '../src/crawler.js'`

- [ ] **Step 3: Write `src/crawler.js`**

```javascript
// src/crawler.js
import { chromium } from 'playwright';

export async function crawlSite(startUrl, { maxPages = 50 } = {}) {
  const origin = new URL(startUrl).origin;
  const visited = new Set();
  const queue = [normalize(startUrl)];
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    while (queue.length > 0 && visited.size < maxPages) {
      const url = queue.shift();
      if (visited.has(url)) continue;
      visited.add(url);

      await page.goto(url, { waitUntil: 'networkidle' }).catch(() => {});
      const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));

      for (const href of hrefs) {
        if (!href) continue;
        let absolute;
        try {
          absolute = new URL(href, url).href;
        } catch {
          continue;
        }
        if (new URL(absolute).origin !== origin) continue;
        const clean = normalize(absolute);
        if (!visited.has(clean) && !queue.includes(clean)) {
          queue.push(clean);
        }
      }
    }
    await page.close();
  } finally {
    await browser.close();
  }
  return Array.from(visited).slice(0, maxPages);
}

function normalize(url) {
  const u = new URL(url);
  u.hash = '';
  return u.href;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/crawler.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/crawler.js test/crawler.test.js
git commit -m "feat: same-domain BFS site crawler"
```

---

### Task 5: Section detector

**Files:**
- Create: `src/sectionDetector.js`
- Test: `test/sectionDetector.test.js`

**Interfaces:**
- Produces: `src/sectionDetector.js` exports `async function detectSections(page, mode, selectors = [])`, where `page` is a Playwright `Page` already navigated and sized to full document height (see Task 6). Returns `Array<{ slug: string, x: number, y: number, width: number, height: number }>`. `mode` is one of `'auto' | 'selectors' | 'full-page'`.
  - `'auto'`: direct children of `<body>` (descending one level if body has a single wrapper child), filtered to `width > 50 && height > 50`.
  - `'selectors'`: one entry per selector in `selectors`, in order, skipping selectors that match nothing.
  - `'full-page'`: single entry covering the full document (`x:0, y:0`, full scroll width/height).
  - If `mode === 'auto'` and zero sections are found, falls back to `'full-page'` behavior internally (per spec fallback rule).
  - `slug` is a URL/filename-safe string: `section-0`, `section-1`, ... for `'auto'`/`'full-page'`, or derived from the selector (lowercased, non-alphanumerics replaced with `-`) for `'selectors'`.

- [ ] **Step 1: Write the failing test**

```javascript
// test/sectionDetector.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { detectSections } from '../src/sectionDetector.js';

const TWO_SECTION_HTML = `<!doctype html><html><body>
  <section id="hero" style="height:300px;">Hero</section>
  <section id="features" style="height:400px;">Features</section>
</body></html>`;

const NO_SECTION_HTML = `<!doctype html><html><body>
  <span>just inline text, no block sections</span>
</body></html>`;

test('auto mode finds top-level sections', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.setContent(TWO_SECTION_HTML);
  const sections = await detectSections(page, 'auto');
  assert.equal(sections.length, 2);
  assert.equal(sections[0].slug, 'section-0');
  assert.equal(sections[1].slug, 'section-1');
  assert.ok(sections[0].height >= 290 && sections[0].height <= 310);
  await browser.close();
});

test('auto mode falls back to full-page when nothing found', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 200 } });
  await page.setContent(NO_SECTION_HTML);
  const sections = await detectSections(page, 'auto');
  assert.equal(sections.length, 1);
  assert.equal(sections[0].slug, 'section-0');
  assert.equal(sections[0].x, 0);
  assert.equal(sections[0].y, 0);
  await browser.close();
});

test('selectors mode returns one entry per matching selector', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.setContent(TWO_SECTION_HTML);
  const sections = await detectSections(page, 'selectors', ['#hero', '#features', '#missing']);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].slug, 'hero');
  assert.equal(sections[1].slug, 'features');
  await browser.close();
});

test('full-page mode returns a single full-document entry', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.setContent(TWO_SECTION_HTML);
  const sections = await detectSections(page, 'full-page');
  assert.equal(sections.length, 1);
  assert.equal(sections[0].slug, 'section-0');
  await browser.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sectionDetector.test.js`
Expected: FAIL — `Cannot find module '../src/sectionDetector.js'`

- [ ] **Step 3: Write `src/sectionDetector.js`**

```javascript
// src/sectionDetector.js
export async function detectSections(page, mode, selectors = []) {
  if (mode === 'selectors') {
    return detectBySelectors(page, selectors);
  }
  if (mode === 'full-page') {
    return [await detectFullPage(page)];
  }
  // mode === 'auto'
  const boxes = await page.evaluate(() => {
    const skip = new Set(['SCRIPT', 'STYLE', 'LINK', 'NOSCRIPT', 'META']);
    let roots = Array.from(document.body.children).filter((el) => !skip.has(el.tagName));
    if (roots.length === 1 && roots[0].children.length > 1) {
      roots = Array.from(roots[0].children).filter((el) => !skip.has(el.tagName));
    }
    return roots
      .map((el) => el.getBoundingClientRect())
      .map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }))
      .filter((r) => r.width > 50 && r.height > 50);
  });

  if (boxes.length === 0) {
    return [await detectFullPage(page)];
  }

  return boxes.map((box, i) => ({ slug: `section-${i}`, ...box }));
}

async function detectBySelectors(page, selectors) {
  const results = [];
  for (const selector of selectors) {
    const box = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, selector);
    if (box) {
      results.push({ slug: slugify(selector), ...box });
    }
  }
  return results;
}

async function detectFullPage(page) {
  const size = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));
  return { slug: 'section-0', x: 0, y: 0, width: size.width, height: size.height };
}

function slugify(selector) {
  return selector
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sectionDetector.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sectionDetector.js test/sectionDetector.test.js
git commit -m "feat: section boundary detection (auto/selectors/full-page)"
```

---

### Task 6: Screenshot capture

**Files:**
- Create: `src/screenshot.js`
- Test: `test/screenshot.test.js`

**Interfaces:**
- Consumes: `VIEWPORTS` from Task 1 (`src/viewports.js`), `detectSections` from Task 5 (`src/sectionDetector.js`).
- Produces: `src/screenshot.js` exports `async function captureAllViewports(browser, pageUrl, { mode, selectors, outputDir })`, where `browser` is a launched Playwright `Browser`, `outputDir` is the page's output root (e.g. `output/<site>/<page>`). Returns:
  ```
  Array<{ viewport: string, sections: Array<{ slug: string, path: string }> }>
  ```
  Writes files to `outputDir/<viewport>/<slug>.png` for every viewport in `VIEWPORTS`. On navigation timeout, retries once, then skips that viewport (returns `sections: []` for it) and does not throw.

- [ ] **Step 1: Write the failing test**

```javascript
// test/screenshot.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startLocalServer } from '../src/localServer.js';
import { captureAllViewports } from '../src/screenshot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'site');

test('captureAllViewports writes a PNG per section per viewport', async () => {
  const server = await startLocalServer(fixtureDir);
  const browser = await chromium.launch();
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shot-test-'));
  try {
    const result = await captureAllViewports(browser, `${server.url}/index.html`, {
      mode: 'auto',
      selectors: [],
      outputDir,
    });

    assert.equal(result.length, 4);
    const desktop = result.find((r) => r.viewport === 'desktop');
    assert.equal(desktop.sections.length, 2);

    for (const { viewport, sections } of result) {
      for (const { slug, path: filePath } of sections) {
        assert.equal(filePath, path.join(outputDir, viewport, `${slug}.png`));
        const stat = await fs.stat(filePath);
        assert.ok(stat.size > 0, `${filePath} should be non-empty`);
      }
    }
  } finally {
    await browser.close();
    await server.close();
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/screenshot.test.js`
Expected: FAIL — `Cannot find module '../src/screenshot.js'`

- [ ] **Step 3: Write `src/screenshot.js`**

```javascript
// src/screenshot.js
import fs from 'node:fs/promises';
import path from 'node:path';
import { VIEWPORTS } from './viewports.js';
import { detectSections } from './sectionDetector.js';

export async function captureAllViewports(browser, pageUrl, { mode, selectors = [], outputDir }) {
  const results = [];

  for (const viewport of VIEWPORTS) {
    const viewportDir = path.join(outputDir, viewport.name);
    await fs.mkdir(viewportDir, { recursive: true });

    const sections = await captureOneViewport(browser, pageUrl, viewport, mode, selectors, viewportDir);
    results.push({ viewport: viewport.name, sections });
  }

  return results;
}

async function captureOneViewport(browser, pageUrl, viewport, mode, selectors, viewportDir) {
  const page = await browser.newPage();
  try {
    await page.setViewportSize({ width: viewport.width, height: 800 });
    const loaded = await gotoWithRetry(page, pageUrl);
    if (!loaded) {
      return [];
    }

    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: viewport.width, height: Math.max(scrollHeight, 800) });

    const sections = await detectSections(page, mode, selectors);
    const written = [];
    for (const section of sections) {
      const filePath = path.join(viewportDir, `${section.slug}.png`);
      await page.screenshot({
        path: filePath,
        clip: {
          x: Math.max(section.x, 0),
          y: Math.max(section.y, 0),
          width: Math.max(section.width, 1),
          height: Math.max(section.height, 1),
        },
      });
      written.push({ slug: section.slug, path: filePath });
    }
    return written;
  } finally {
    await page.close();
  }
}

async function gotoWithRetry(page, pageUrl) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 15000 });
      return true;
    } catch (err) {
      if (attempt === 1) {
        console.error(`[screenshot] failed to load ${pageUrl}: ${err.message}`);
        return false;
      }
    }
  }
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/screenshot.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/screenshot.js test/screenshot.test.js
git commit -m "feat: per-viewport per-section screenshot capture with retry"
```

---

### Task 7: Composite device-mockup builder

**Files:**
- Create: `src/composite.js`
- Test: `test/composite.test.js`

**Interfaces:**
- Produces: `src/composite.js` exports `async function buildComposite(browser, imagesByViewport, outputPath)`, where `imagesByViewport` is `{ desktop?: string, laptop?: string, tablet?: string, mobile?: string }` (absolute file paths to raw PNGs, any subset may be missing), and `outputPath` is the destination composite PNG path. Renders a dark-background canvas with one labeled device frame per provided viewport, writes the PNG, and returns `outputPath`. Skips missing viewports (no frame drawn), and throws if `imagesByViewport` has zero entries.

- [ ] **Step 1: Write the failing test**

```javascript
// test/composite.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { buildComposite } from '../src/composite.js';

async function makeSamplePng(dir, name, width, height, color) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(`<body style="margin:0;background:${color};width:${width}px;height:${height}px;"></body>`);
  const filePath = path.join(dir, name);
  await page.screenshot({ path: filePath });
  await browser.close();
  return filePath;
}

test('buildComposite renders a PNG containing all provided viewports', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'composite-test-'));
  const browser = await chromium.launch();
  try {
    const desktop = await makeSamplePng(tmp, 'desktop.png', 400, 200, 'red');
    const mobile = await makeSamplePng(tmp, 'mobile.png', 120, 240, 'blue');
    const outputPath = path.join(tmp, 'composite.png');

    const result = await buildComposite(browser, { desktop, mobile }, outputPath);

    assert.equal(result, outputPath);
    const stat = await fs.stat(outputPath);
    assert.ok(stat.size > 1000, 'composite PNG should be non-trivial in size');
  } finally {
    await browser.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('buildComposite throws when given no images', async () => {
  const browser = await chromium.launch();
  try {
    await assert.rejects(() => buildComposite(browser, {}, '/tmp/should-not-write.png'));
  } finally {
    await browser.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/composite.test.js`
Expected: FAIL — `Cannot find module '../src/composite.js'`

- [ ] **Step 3: Write `src/composite.js`**

```javascript
// src/composite.js
import fs from 'node:fs/promises';
import path from 'node:path';

const FRAME_ORDER = ['desktop', 'laptop', 'tablet', 'mobile'];
const CANVAS_WIDTH = 2000;
const CANVAS_HEIGHT = 1200;

export async function buildComposite(browser, imagesByViewport, outputPath) {
  const entries = FRAME_ORDER.filter((name) => imagesByViewport[name]);
  if (entries.length === 0) {
    throw new Error('buildComposite requires at least one viewport image');
  }

  const dataUris = {};
  for (const name of entries) {
    const buf = await fs.readFile(imagesByViewport[name]);
    dataUris[name] = `data:image/png;base64,${buf.toString('base64')}`;
  }

  const html = renderHtml(entries, dataUris);

  const page = await browser.newPage({ viewport: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT } });
  try {
    await page.setContent(html);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await page.screenshot({ path: outputPath });
  } finally {
    await page.close();
  }

  return outputPath;
}

function renderHtml(entries, dataUris) {
  const frames = entries
    .map((name) => frameHtml(name, dataUris[name]))
    .join('\n');

  return `<!doctype html>
<html>
<head>
<style>
  body { margin: 0; width: ${CANVAS_WIDTH}px; height: ${CANVAS_HEIGHT}px; background: #0a0a0a; display: flex; align-items: center; justify-content: center; gap: 40px; font-family: sans-serif; }
  .frame { display: flex; flex-direction: column; align-items: center; }
  .bezel { border: 10px solid #2a2a2a; border-radius: 14px; background: #111; box-shadow: 0 20px 40px rgba(0,0,0,0.5); overflow: hidden; }
  .bezel img { display: block; max-width: 100%; max-height: 100%; object-fit: cover; }
  .label { color: #8bc34a; margin-top: 12px; font-size: 18px; text-transform: capitalize; }
</style>
</head>
<body>
  ${frames}
</body>
</html>`;
}

function frameHtml(name, dataUri) {
  const dims = {
    desktop: { w: 560, h: 350 },
    laptop: { w: 460, h: 300 },
    tablet: { w: 300, h: 400 },
    mobile: { w: 200, h: 420 },
  }[name];

  return `<div class="frame">
    <div class="bezel" style="width:${dims.w}px;height:${dims.h}px;">
      <img src="${dataUri}" />
    </div>
    <div class="label">${name}</div>
  </div>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/composite.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/composite.js test/composite.test.js
git commit -m "feat: device-frame composite image builder"
```

---

### Task 8: Manifest read/write

**Files:**
- Create: `src/manifest.js`
- Test: `test/manifest.test.js`

**Interfaces:**
- Produces: `src/manifest.js` exports `async function writeManifest(siteOutputDir, manifest)` writing pretty-printed JSON to `<siteOutputDir>/manifest.json`, and `async function readManifest(siteOutputDir)` reading it back. `manifest` shape:
  ```
  {
    site: string,
    generatedAt: string, // ISO timestamp, caller-supplied
    pages: Array<{
      url: string,
      sections: Array<{
        slug: string,
        viewports: { desktop?: string, laptop?: string, tablet?: string, mobile?: string },
        composite: string | null
      }>
    }>
  }
  ```

- [ ] **Step 1: Write the failing test**

```javascript
// test/manifest.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { writeManifest, readManifest } from '../src/manifest.js';

test('writeManifest then readManifest round-trips the data', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'manifest-test-'));
  const manifest = {
    site: 'example.com',
    generatedAt: '2026-08-13T00:00:00.000Z',
    pages: [
      {
        url: 'https://example.com/',
        sections: [
          {
            slug: 'section-0',
            viewports: { desktop: '/out/desktop/section-0.png', mobile: '/out/mobile/section-0.png' },
            composite: '/out/composites/section-0-composite.png',
          },
        ],
      },
    ],
  };

  await writeManifest(dir, manifest);
  const filePath = path.join(dir, 'manifest.json');
  const stat = await fs.stat(filePath);
  assert.ok(stat.isFile());

  const readBack = await readManifest(dir);
  assert.deepEqual(readBack, manifest);

  await fs.rm(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/manifest.test.js`
Expected: FAIL — `Cannot find module '../src/manifest.js'`

- [ ] **Step 3: Write `src/manifest.js`**

```javascript
// src/manifest.js
import fs from 'node:fs/promises';
import path from 'node:path';

export async function writeManifest(siteOutputDir, manifest) {
  await fs.mkdir(siteOutputDir, { recursive: true });
  const filePath = path.join(siteOutputDir, 'manifest.json');
  await fs.writeFile(filePath, JSON.stringify(manifest, null, 2), 'utf8');
  return filePath;
}

export async function readManifest(siteOutputDir) {
  const filePath = path.join(siteOutputDir, 'manifest.json');
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/manifest.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/manifest.js test/manifest.test.js
git commit -m "feat: manifest.json read/write"
```

---

### Task 9: Pipeline orchestrator

**Files:**
- Create: `src/pipeline.js`
- Test: `test/pipeline.test.js`

**Interfaces:**
- Consumes: `crawlSite` (Task 4), `captureAllViewports` (Task 6), `buildComposite` (Task 7), `writeManifest` (Task 8).
- Produces: `src/pipeline.js` exports `async function runPipeline({ startUrl, mode, selectors, siteName, outputRoot, maxPages }, onProgress)`. `onProgress` is `(event: { type: string, message: string }) => void`, called at least on: `'crawl-start'`, `'page-start'` (per page), `'page-done'` (per page), `'composite-done'` (per section), `'run-done'`. Returns the manifest object (same shape as Task 8) and writes it to `<outputRoot>/<siteName>/manifest.json`.

- [ ] **Step 1: Write the failing test**

```javascript
// test/pipeline.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { startLocalServer } from '../src/localServer.js';
import { runPipeline } from '../src/pipeline.js';
import { readManifest } from '../src/manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'site');

test('runPipeline crawls, shoots, composites, and writes a manifest for the fixture site', async () => {
  const server = await startLocalServer(fixtureDir);
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pipeline-test-'));
  const events = [];
  try {
    const manifest = await runPipeline(
      {
        startUrl: `${server.url}/index.html`,
        mode: 'auto',
        selectors: [],
        siteName: 'fixture-site',
        outputRoot,
        maxPages: 10,
      },
      (event) => events.push(event.type)
    );

    assert.equal(manifest.site, 'fixture-site');
    assert.equal(manifest.pages.length, 3);

    const home = manifest.pages.find((p) => p.url.endsWith('/index.html'));
    assert.equal(home.sections.length, 2);
    for (const section of home.sections) {
      assert.ok(section.composite, 'every section should have a composite path');
      const stat = await fs.stat(section.composite);
      assert.ok(stat.size > 0);
    }

    const onDisk = await readManifest(path.join(outputRoot, 'fixture-site'));
    assert.deepEqual(onDisk, manifest);

    assert.ok(events.includes('crawl-start'));
    assert.ok(events.includes('run-done'));
  } finally {
    await server.close();
    await fs.rm(outputRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pipeline.test.js`
Expected: FAIL — `Cannot find module '../src/pipeline.js'`

- [ ] **Step 3: Write `src/pipeline.js`**

```javascript
// src/pipeline.js
import path from 'node:path';
import { chromium } from 'playwright';
import { crawlSite } from './crawler.js';
import { captureAllViewports } from './screenshot.js';
import { buildComposite } from './composite.js';
import { writeManifest } from './manifest.js';

export async function runPipeline(
  { startUrl, mode, selectors = [], siteName, outputRoot, maxPages = 50 },
  onProgress = () => {}
) {
  const siteOutputDir = path.join(outputRoot, siteName);
  const browser = await chromium.launch();
  const manifest = { site: siteName, generatedAt: new Date().toISOString(), pages: [] };

  try {
    onProgress({ type: 'crawl-start', message: `Crawling ${startUrl}` });
    const pageUrls = await crawlSite(startUrl, { maxPages });

    for (const pageUrl of pageUrls) {
      onProgress({ type: 'page-start', message: `Processing ${pageUrl}` });

      const pageSlug = pageSlugFor(pageUrl);
      const pageOutputDir = path.join(siteOutputDir, pageSlug);
      const viewportResults = await captureAllViewports(browser, pageUrl, {
        mode,
        selectors,
        outputDir: pageOutputDir,
      });

      const sections = await buildCompositesForPage(browser, pageOutputDir, viewportResults, onProgress);
      manifest.pages.push({ url: pageUrl, sections });

      onProgress({ type: 'page-done', message: `Finished ${pageUrl}` });
    }
  } finally {
    await browser.close();
  }

  await writeManifest(siteOutputDir, manifest);
  onProgress({ type: 'run-done', message: 'Run complete' });
  return manifest;
}

async function buildCompositesForPage(browser, pageOutputDir, viewportResults, onProgress) {
  const slugs = new Set();
  for (const { sections } of viewportResults) {
    for (const { slug } of sections) slugs.add(slug);
  }

  const sections = [];
  for (const slug of slugs) {
    const imagesByViewport = {};
    for (const { viewport, sections: vSections } of viewportResults) {
      const match = vSections.find((s) => s.slug === slug);
      if (match) imagesByViewport[viewport] = match.path;
    }

    let compositePath = null;
    if (Object.keys(imagesByViewport).length > 0) {
      const outputPath = path.join(pageOutputDir, 'composites', `${slug}-composite.png`);
      compositePath = await buildComposite(browser, imagesByViewport, outputPath);
      onProgress({ type: 'composite-done', message: `Composite ready: ${slug}` });
    }

    sections.push({ slug, viewports: imagesByViewport, composite: compositePath });
  }

  return sections;
}

function pageSlugFor(pageUrl) {
  const { pathname } = new URL(pageUrl);
  const base = pathname.replace(/^\/+|\/+$/g, '') || 'index';
  return base.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase() || 'index';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/pipeline.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pipeline.js test/pipeline.test.js
git commit -m "feat: pipeline orchestrator tying crawler, screenshots, composites, manifest"
```

---

### Task 10: Express server and run API

**Files:**
- Create: `src/routes/run.js`
- Create: `src/server.js`
- Test: `test/server.test.js`

**Interfaces:**
- Consumes: `runPipeline` from Task 9 (`src/pipeline.js`), `startLocalServer` from Task 3.
- Produces:
  - `POST /api/run` body `{ url?: string, localFolder?: string, mode: 'auto'|'selectors'|'full-page', selectors?: string[], siteName: string }` → `{ runId: string }`. Exactly one of `url`/`localFolder` must be given.
  - `GET /api/progress/:runId` — SSE stream of `{ type, message }` events as emitted by `runPipeline`'s `onProgress`, plus a final event with `type: 'manifest-ready'` carrying the manifest.
  - `GET /api/download/:runId` — streams a zip of that run's output directory.
  - Static frontend served from `public/` at `/`.
  - In-memory run registry: `Map<runId, { status: 'running'|'done'|'error', events: Array, manifest: object|null, outputDir: string }>`.

- [ ] **Step 1: Write the failing test**

```javascript
// test/server.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'site');

test('POST /api/run then GET /api/progress/:runId streams to run-done, manifest available', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'server-test-'));
  const app = createApp({ outputRoot });
  const server = app.listen(0);
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  t.after(async () => {
    server.close();
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const runRes = await fetch(`${base}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ localFolder: fixtureDir, mode: 'auto', siteName: 'fixture-site' }),
  });
  assert.equal(runRes.status, 200);
  const { runId } = await runRes.json();
  assert.ok(runId);

  const progressRes = await fetch(`${base}/api/progress/${runId}`);
  assert.equal(progressRes.status, 200);
  const text = await progressRes.text();
  assert.match(text, /run-done/);
  assert.match(text, /manifest-ready/);

  const downloadRes = await fetch(`${base}/api/download/${runId}`);
  assert.equal(downloadRes.status, 200);
  assert.equal(downloadRes.headers.get('content-type'), 'application/zip');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/server.test.js`
Expected: FAIL — `Cannot find module '../src/server.js'`

- [ ] **Step 3: Write `src/routes/run.js`**

```javascript
// src/routes/run.js
import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import archiver from 'archiver';
import { runPipeline } from '../pipeline.js';
import { startLocalServer } from '../localServer.js';

export function createRunRouter({ outputRoot, runs }) {
  const router = express.Router();

  router.post('/run', async (req, res) => {
    const { url, localFolder, mode, selectors = [], siteName } = req.body || {};
    if (!siteName || !mode || (!url && !localFolder) || (url && localFolder)) {
      res.status(400).json({ error: 'Provide siteName, mode, and exactly one of url/localFolder' });
      return;
    }

    const runId = crypto.randomUUID();
    const outputDir = path.join(outputRoot, siteName);
    runs.set(runId, { status: 'running', events: [], manifest: null, outputDir });

    res.json({ runId });

    executeRun({ runId, url, localFolder, mode, selectors, siteName, outputRoot, runs }).catch((err) => {
      const run = runs.get(runId);
      run.status = 'error';
      run.events.push({ type: 'error', message: err.message });
    });
  });

  router.get('/progress/:runId', async (req, res) => {
    const run = runs.get(req.params.runId);
    if (!run) {
      res.status(404).end();
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    let sent = 0;
    const interval = setInterval(() => {
      while (sent < run.events.length) {
        const event = run.events[sent++];
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      if (run.status !== 'running' && sent >= run.events.length) {
        if (run.manifest) {
          res.write(`data: ${JSON.stringify({ type: 'manifest-ready', manifest: run.manifest })}\n\n`);
        }
        clearInterval(interval);
        res.end();
      }
    }, 100);

    req.on('close', () => clearInterval(interval));
  });

  router.get('/download/:runId', (req, res) => {
    const run = runs.get(req.params.runId);
    if (!run) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.runId}.zip"`);
    const archive = archiver('zip');
    archive.pipe(res);
    archive.directory(run.outputDir, false);
    archive.finalize();
  });

  return router;
}

async function executeRun({ runId, url, localFolder, mode, selectors, siteName, outputRoot, runs }) {
  const run = runs.get(runId);
  let localServer = null;
  let startUrl = url;

  if (localFolder) {
    localServer = await startLocalServer(localFolder);
    startUrl = `${localServer.url}/index.html`;
  }

  try {
    const manifest = await runPipeline(
      { startUrl, mode, selectors, siteName, outputRoot },
      (event) => run.events.push(event)
    );
    run.manifest = manifest;
    run.status = 'done';
  } finally {
    if (localServer) await localServer.close();
  }
}
```

- [ ] **Step 4: Write `src/server.js`**

```javascript
// src/server.js
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunRouter } from './routes/run.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ outputRoot = path.join(__dirname, '..', 'output') } = {}) {
  const app = express();
  const runs = new Map();

  app.use(express.json());
  app.use('/api', createRunRouter({ outputRoot, runs }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Screenshot Taker running on http://localhost:${port}`));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/server.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/routes/run.js src/server.js test/server.test.js
git commit -m "feat: Express server with run/progress/download API"
```

---

### Task 11: Frontend UI

**Files:**
- Create: `public/index.html`
- Create: `public/app.js`
- Create: `public/style.css`

**Interfaces:**
- Consumes: `POST /api/run`, `GET /api/progress/:runId` (SSE), `GET /api/download/:runId` from Task 10.
- Produces: a working browser UI — no new backend interfaces.

- [ ] **Step 1: Write `public/index.html`**

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Screenshot Taker</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <main>
    <h1>Screenshot Taker</h1>
    <form id="run-form">
      <label>
        Site name
        <input type="text" id="siteName" required placeholder="my-restaurant-site" />
      </label>
      <label>
        Source type
        <select id="sourceType">
          <option value="url">Live URL / dev server URL</option>
          <option value="localFolder">Local folder path</option>
        </select>
      </label>
      <label>
        <span id="sourceLabel">URL</span>
        <input type="text" id="sourceValue" required placeholder="https://example.com" />
      </label>
      <label>
        Section detection
        <select id="mode">
          <option value="auto">Auto-detect</option>
          <option value="selectors">CSS selector list</option>
          <option value="full-page">Full page only</option>
        </select>
      </label>
      <label id="selectorsRow" style="display:none;">
        Selectors (comma-separated)
        <input type="text" id="selectors" placeholder="#hero, .menu-section" />
      </label>
      <button type="submit">Run</button>
    </form>

    <section id="progress" hidden>
      <h2>Progress</h2>
      <ul id="progress-log"></ul>
    </section>

    <section id="gallery" hidden>
      <h2>Results</h2>
      <a id="download-link" href="#">Download all as zip</a>
      <div id="gallery-content"></div>
    </section>
  </main>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `public/style.css`**

```css
body { font-family: -apple-system, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #222; }
label { display: block; margin-bottom: 14px; font-weight: 600; }
input, select { display: block; width: 100%; padding: 8px; margin-top: 4px; font-weight: normal; box-sizing: border-box; }
button { padding: 10px 20px; font-weight: 600; cursor: pointer; }
#progress-log { list-style: none; padding: 0; font-family: monospace; font-size: 13px; }
#progress-log li { padding: 2px 0; }
.page-block { margin-bottom: 32px; }
.section-block { display: flex; gap: 8px; align-items: center; margin: 8px 0; flex-wrap: wrap; }
.section-block img { max-height: 100px; border: 1px solid #ccc; }
```

- [ ] **Step 3: Write `public/app.js`**

```javascript
// public/app.js
const form = document.getElementById('run-form');
const sourceType = document.getElementById('sourceType');
const sourceLabel = document.getElementById('sourceLabel');
const modeSelect = document.getElementById('mode');
const selectorsRow = document.getElementById('selectorsRow');
const progressSection = document.getElementById('progress');
const progressLog = document.getElementById('progress-log');
const gallerySection = document.getElementById('gallery');
const galleryContent = document.getElementById('gallery-content');
const downloadLink = document.getElementById('download-link');

sourceType.addEventListener('change', () => {
  sourceLabel.textContent = sourceType.value === 'url' ? 'URL' : 'Local folder path';
});

modeSelect.addEventListener('change', () => {
  selectorsRow.style.display = modeSelect.value === 'selectors' ? 'block' : 'none';
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  progressLog.innerHTML = '';
  galleryContent.innerHTML = '';
  progressSection.hidden = false;
  gallerySection.hidden = true;

  const body = {
    siteName: document.getElementById('siteName').value,
    mode: modeSelect.value,
    selectors: document.getElementById('selectors').value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
  const sourceValue = document.getElementById('sourceValue').value;
  if (sourceType.value === 'url') {
    body.url = sourceValue;
  } else {
    body.localFolder = sourceValue;
  }

  const runRes = await fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const { runId } = await runRes.json();

  const events = new EventSource(`/api/progress/${runId}`);
  events.onmessage = (msg) => {
    const event = JSON.parse(msg.data);
    const li = document.createElement('li');
    li.textContent = `[${event.type}] ${event.message || ''}`;
    progressLog.appendChild(li);

    if (event.type === 'manifest-ready') {
      renderGallery(event.manifest, runId);
      events.close();
    }
  };
});

function renderGallery(manifest, runId) {
  gallerySection.hidden = false;
  downloadLink.href = `/api/download/${runId}`;

  for (const page of manifest.pages) {
    const pageBlock = document.createElement('div');
    pageBlock.className = 'page-block';
    const title = document.createElement('h3');
    title.textContent = page.url;
    pageBlock.appendChild(title);

    for (const section of page.sections) {
      const sectionBlock = document.createElement('div');
      sectionBlock.className = 'section-block';
      const label = document.createElement('strong');
      label.textContent = section.slug;
      sectionBlock.appendChild(label);

      if (section.composite) {
        const img = document.createElement('img');
        img.src = toWebPath(section.composite);
        sectionBlock.appendChild(img);
      }
      pageBlock.appendChild(sectionBlock);
    }
    galleryContent.appendChild(pageBlock);
  }
}

function toWebPath(absolutePath) {
  const idx = absolutePath.indexOf('/output/');
  return idx >= 0 ? absolutePath.slice(idx) : absolutePath;
}
```

- [ ] **Step 4: Serve `output/` as static files so gallery images load**

Modify `src/server.js` — add a static mount for the output root, right after the `/api` mount:

```javascript
  app.use('/api', createRunRouter({ outputRoot, runs }));
  app.use('/output', express.static(outputRoot));
  app.use(express.static(path.join(__dirname, '..', 'public')));
```

- [ ] **Step 5: Manual verification**

Run:
```bash
npm start
```
Open `http://localhost:3000`, submit the fixture site folder path (`test/fixtures/site`) as a local folder run with mode `auto`, watch progress log fill, confirm gallery renders composite thumbnails, confirm "Download all as zip" produces a working zip.

- [ ] **Step 6: Commit**

```bash
git add public/ src/server.js
git commit -m "feat: frontend UI for run submission, progress, and gallery"
```

---

### Task 12: Full end-to-end smoke test

**Files:**
- Test: `test/e2e.test.js`

**Interfaces:**
- Consumes: `createApp` from Task 10, fixture site from Task 2.
- Produces: one integration test proving the whole stack works together over HTTP, independent of the manual check in Task 11.

- [ ] **Step 1: Write the test**

```javascript
// test/e2e.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'site');

test('end-to-end: run fixture site through HTTP API, all viewports and composites present', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'e2e-test-'));
  const app = createApp({ outputRoot });
  const server = app.listen(0);
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  t.after(async () => {
    server.close();
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const runRes = await fetch(`${base}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ localFolder: fixtureDir, mode: 'auto', siteName: 'e2e-fixture' }),
  });
  const { runId } = await runRes.json();

  const progressRes = await fetch(`${base}/api/progress/${runId}`);
  const text = await progressRes.text();
  assert.match(text, /manifest-ready/);

  const manifestMatch = text.match(/data: (\{"type":"manifest-ready".*\})\n\n/);
  assert.ok(manifestMatch, 'manifest-ready event should be present');
  const { manifest } = JSON.parse(manifestMatch[1]);

  assert.equal(manifest.pages.length, 3);
  for (const page of manifest.pages) {
    for (const section of page.sections) {
      assert.ok(section.composite);
      const viewportCount = Object.keys(section.viewports).length;
      assert.equal(viewportCount, 4, `${page.url} / ${section.slug} should have all 4 viewports`);
    }
  }

  const zipRes = await fetch(`${base}/api/download/${runId}`);
  assert.equal(zipRes.status, 200);
  const buf = Buffer.from(await zipRes.arrayBuffer());
  assert.ok(buf.length > 0);
  assert.equal(buf.slice(0, 2).toString(), 'PK');
});
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS — all test files including `e2e.test.js` green.

- [ ] **Step 3: Commit**

```bash
git add test/e2e.test.js
git commit -m "test: full end-to-end smoke test over HTTP API"
```

---

## Post-plan manual check

After Task 12 passes, run `npm start` and do one real-world run against a live site (not just the fixture) with `mode: auto`, to sanity-check the section-detection heuristic against real-world markup before relying on it day-to-day. Note any heuristic misses in `Notes/Engineering/Decisions.md`.
