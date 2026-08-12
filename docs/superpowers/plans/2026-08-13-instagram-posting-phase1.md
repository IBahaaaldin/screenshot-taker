# Instagram Auto-Posting (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user review a generated composite (or a whole page's composites as a carousel), edit an auto-drafted caption, and post it to Instagram from the running app — proving the real Graph API + local-tunnel posting mechanism works before Phase 2 automates it.

**Architecture:** New backend modules (`caption`, `postQueue`, `instagram`, `tunnel`, `postingService`) compose into one Express route (`POST /api/queue`) that: builds a queue item, starts a local tunnel to expose the already-running server's `/output` static route publicly, posts to the Instagram Graph API (single image or carousel), records the result in `post-queue.json`, and closes the tunnel. The frontend gains post buttons in the gallery, a caption editor, and a queue status panel.

**Tech Stack:** Same as the rest of the project — Node.js, Express, `node:test`. New dependency: `localtunnel` (public HTTPS tunnel to localhost, no account signup). No new dependency for Instagram — the Graph API is plain HTTPS/JSON, called via global `fetch`.

## Global Constraints

- Instagram Graph API base: `https://graph.facebook.com/v19.0` — exact value, used verbatim in `src/instagram.js`.
- Credentials (`IG_BUSINESS_ACCOUNT_ID`, `IG_ACCESS_TOKEN`) come from a git-ignored `.env` file, loaded manually (no `dotenv` dependency) — see Task 1. Never entered into the app's UI or logged.
- Instagram's posting cap is 25 posts per rolling 24 hours per account — checked before every post attempt in `postingService.js`.
- Nothing in this codebase performs the Meta/Instagram account or app setup itself (that happens in the user's own browser, outside this repo) — the code only consumes the resulting credentials.
- `post-queue.json` lives at `<outputRoot>/post-queue.json` (one queue across all sites, not per-site), read/written via the same whole-file read/write pattern as `src/manifest.js`.
- All new network calls (Graph API, tunnel) must be dependency-injectable in every function that makes them, with the real implementation as the default parameter — this is how every test in this plan avoids touching the real network, matching how the rest of the test suite avoids mocking libraries in favor of plain function injection.
- No automatic retry on a failed post — failures are recorded with an error message and surfaced, never silently retried.

---

## File Structure

```
.env.example          # documents required/optional env vars, git-tracked
src/
  env.js                 # tiny .env file loader (no dotenv dependency)
  caption.js              # auto-draft caption generator
  postQueue.js             # post-queue.json read/write + rate-limit + item creation
  instagram.js              # Graph API client: single image + carousel posting
  tunnel.js                  # localtunnel wrapper
  postingService.js           # orchestrates tunnel + instagram + postQueue for one item
  routes/
    postQueue.js               # POST /api/queue, GET /api/queue
  server.js                     # (modified) load .env, wire the new router
public/
  index.html                    # (modified) queue panel section
  app.js                         # (modified) post buttons, caption modal, queue rendering
  style.css                      # (modified) styling for the above
test/
  env.test.js
  caption.test.js
  postQueue.test.js
  instagram.test.js
  tunnel.test.js
  postingService.test.js
  postQueueRoute.test.js
  instagramPosting.e2e.test.js
```

Each `src/` file has one responsibility. `postingService.js` is the only module that composes the others — routes stay thin (validate input, delegate, respond).

---

### Task 1: `.env` loader

**Files:**
- Create: `src/env.js`
- Test: `test/env.test.js`

**Interfaces:**
- Produces: `src/env.js` exports `function loadEnvFile(envPath)`. Reads a simple `KEY=VALUE` file (one per line, `#`-prefixed lines and blank lines ignored, optional matching single/double quotes around the value are stripped) and sets `process.env[KEY] = VALUE` for each — **only** for keys not already present in `process.env` (so real environment variables always win over the file). Silently does nothing if `envPath` doesn't exist. Throws on any other filesystem error.

- [ ] **Step 1: Write the failing test**

```javascript
// test/env.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadEnvFile } from '../src/env.js';

test('loadEnvFile sets process.env from a KEY=VALUE file, skipping comments/blanks', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'env-test-'));
  const envPath = path.join(dir, '.env');
  await fs.writeFile(
    envPath,
    [
      '# a comment',
      '',
      'FOO=bar',
      'QUOTED="hello world"',
      'SINGLE_QUOTED=\'single\'',
    ].join('\n'),
    'utf8'
  );

  delete process.env.FOO;
  delete process.env.QUOTED;
  delete process.env.SINGLE_QUOTED;

  loadEnvFile(envPath);

  assert.equal(process.env.FOO, 'bar');
  assert.equal(process.env.QUOTED, 'hello world');
  assert.equal(process.env.SINGLE_QUOTED, 'single');

  delete process.env.FOO;
  delete process.env.QUOTED;
  delete process.env.SINGLE_QUOTED;
  await fs.rm(dir, { recursive: true, force: true });
});

test('loadEnvFile does not overwrite an already-set environment variable', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'env-test-'));
  const envPath = path.join(dir, '.env');
  await fs.writeFile(envPath, 'FOO=from-file\n', 'utf8');

  process.env.FOO = 'from-real-env';
  loadEnvFile(envPath);
  assert.equal(process.env.FOO, 'from-real-env');

  delete process.env.FOO;
  await fs.rm(dir, { recursive: true, force: true });
});

test('loadEnvFile does nothing when the file does not exist', () => {
  assert.doesNotThrow(() => loadEnvFile('/tmp/definitely-does-not-exist-env-file'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/env.test.js`
Expected: FAIL — `Cannot find module '../src/env.js'`

- [ ] **Step 3: Write `src/env.js`**

```javascript
// src/env.js
import fs from 'node:fs';

export function loadEnvFile(envPath) {
  let content;
  try {
    content = fs.readFileSync(envPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    const isQuoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (isQuoted && value.length >= 2) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/env.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/env.js test/env.test.js
git commit -m "feat: minimal .env file loader"
```

---

### Task 2: Caption generator

**Files:**
- Create: `src/caption.js`
- Test: `test/caption.test.js`

**Interfaces:**
- Produces: `src/caption.js` exports `function generateCaption({ siteName, pageUrl, slug })` returning a `string`. Format: `"<siteName> — <heading>\n\n<hashtags>"` where `heading` is `slug` when `slug` doesn't match the generic auto-detect pattern `section-<number>` (i.e. it's a real selector-derived name), otherwise falls back to the page's path segment (e.g. `menu.html` → `menu`, `/` or `index.html` → `home`). `hashtags` is the fixed string `#webdesign #restaurant #instagood #foodie #smallbusiness`.

- [ ] **Step 1: Write the failing test**

```javascript
// test/caption.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCaption } from '../src/caption.js';

const HASHTAGS = '#webdesign #restaurant #instagood #foodie #smallbusiness';

test('uses the slug as the heading when it is a real selector-derived name', () => {
  const caption = generateCaption({
    siteName: 'baba-ganoush',
    pageUrl: 'https://example.com/index.html',
    slug: 'hero',
  });
  assert.equal(caption, `baba-ganoush — hero\n\n${HASHTAGS}`);
});

test('falls back to the page name when the slug is a generic auto-detect slug', () => {
  const caption = generateCaption({
    siteName: 'baba-ganoush',
    pageUrl: 'https://example.com/menu.html',
    slug: 'section-2',
  });
  assert.equal(caption, `baba-ganoush — menu\n\n${HASHTAGS}`);
});

test('falls back to "home" for the site root with a generic slug', () => {
  const caption = generateCaption({
    siteName: 'baba-ganoush',
    pageUrl: 'https://example.com/index.html',
    slug: 'section-0',
  });
  assert.equal(caption, `baba-ganoush — home\n\n${HASHTAGS}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/caption.test.js`
Expected: FAIL — `Cannot find module '../src/caption.js'`

- [ ] **Step 3: Write `src/caption.js`**

```javascript
// src/caption.js
const HASHTAGS = '#webdesign #restaurant #instagood #foodie #smallbusiness';
const GENERIC_SLUG = /^section-\d+$/;

export function generateCaption({ siteName, pageUrl, slug }) {
  const heading = GENERIC_SLUG.test(slug) ? pageHeading(pageUrl) : slug;
  return `${siteName} — ${heading}\n\n${HASHTAGS}`;
}

function pageHeading(pageUrl) {
  const { pathname } = new URL(pageUrl);
  const base = pathname.replace(/^\/+|\/+$/g, '').replace(/\.html$/, '');
  return base === '' || base === 'index' ? 'home' : base;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/caption.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/caption.js test/caption.test.js
git commit -m "feat: auto-draft caption generator"
```

---

### Task 3: Post queue read/write

**Files:**
- Create: `src/postQueue.js`
- Test: `test/postQueue.test.js`

**Interfaces:**
- Produces:
  - `async function readQueue(queueFilePath)` → `{ items: [] }` if the file doesn't exist yet, otherwise the parsed JSON.
  - `async function writeQueue(queueFilePath, queue)` → writes pretty-printed JSON, creating parent directories as needed.
  - `function createQueueItem({ siteName, pageUrl, kind, images, caption })` → a new item object: `{ id, siteName, pageUrl, kind, images, caption, status: 'queued', createdAt, postedAt: null, igMediaId: null, error: null }`. `id` via `crypto.randomUUID()`, `createdAt` via `new Date().toISOString()`.
  - `function countPostsInLast24h(queue, now = Date.now())` → number of items with `status === 'posted'` and `postedAt` within the last 24h of `now`.

- [ ] **Step 1: Write the failing test**

```javascript
// test/postQueue.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readQueue, writeQueue, createQueueItem, countPostsInLast24h } from '../src/postQueue.js';

test('readQueue returns an empty queue when the file does not exist', async () => {
  const queue = await readQueue('/tmp/definitely-does-not-exist-post-queue.json');
  assert.deepEqual(queue, { items: [] });
});

test('writeQueue then readQueue round-trips, creating parent directories', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'post-queue-test-'));
  const queueFilePath = path.join(dir, 'nested', 'post-queue.json');
  const queue = { items: [{ id: 'abc', status: 'queued' }] };

  await writeQueue(queueFilePath, queue);
  const readBack = await readQueue(queueFilePath);
  assert.deepEqual(readBack, queue);

  await fs.rm(dir, { recursive: true, force: true });
});

test('createQueueItem builds a well-formed queued item', () => {
  const item = createQueueItem({
    siteName: 'baba-ganoush',
    pageUrl: 'https://example.com/index.html',
    kind: 'single',
    images: ['/abs/path/section-0-composite.png'],
    caption: 'baba-ganoush — hero',
  });

  assert.ok(item.id);
  assert.equal(item.siteName, 'baba-ganoush');
  assert.equal(item.kind, 'single');
  assert.deepEqual(item.images, ['/abs/path/section-0-composite.png']);
  assert.equal(item.status, 'queued');
  assert.ok(item.createdAt);
  assert.equal(item.postedAt, null);
  assert.equal(item.igMediaId, null);
  assert.equal(item.error, null);
});

test('countPostsInLast24h counts only posted items within the last 24 hours', () => {
  const now = Date.parse('2026-01-02T12:00:00.000Z');
  const queue = {
    items: [
      { status: 'posted', postedAt: '2026-01-02T11:00:00.000Z' }, // 1h ago: counts
      { status: 'posted', postedAt: '2026-01-01T11:00:00.000Z' }, // 25h ago: does not count
      { status: 'failed', postedAt: null }, // not posted: does not count
      { status: 'queued', postedAt: null }, // not posted: does not count
    ],
  };
  assert.equal(countPostsInLast24h(queue, now), 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/postQueue.test.js`
Expected: FAIL — `Cannot find module '../src/postQueue.js'`

- [ ] **Step 3: Write `src/postQueue.js`**

```javascript
// src/postQueue.js
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export async function readQueue(queueFilePath) {
  try {
    const raw = await fs.readFile(queueFilePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return { items: [] };
    throw err;
  }
}

export async function writeQueue(queueFilePath, queue) {
  await fs.mkdir(path.dirname(queueFilePath), { recursive: true });
  await fs.writeFile(queueFilePath, JSON.stringify(queue, null, 2), 'utf8');
}

export function createQueueItem({ siteName, pageUrl, kind, images, caption }) {
  return {
    id: crypto.randomUUID(),
    siteName,
    pageUrl,
    kind,
    images,
    caption,
    status: 'queued',
    createdAt: new Date().toISOString(),
    postedAt: null,
    igMediaId: null,
    error: null,
  };
}

export function countPostsInLast24h(queue, now = Date.now()) {
  const cutoff = now - 24 * 60 * 60 * 1000;
  return queue.items.filter(
    (item) => item.status === 'posted' && item.postedAt && Date.parse(item.postedAt) >= cutoff
  ).length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/postQueue.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/postQueue.js test/postQueue.test.js
git commit -m "feat: post-queue.json read/write, item creation, rate-limit counting"
```

---

### Task 4: Instagram Graph API client — single image

**Files:**
- Create: `src/instagram.js`
- Test: `test/instagram.test.js`

**Interfaces:**
- Produces:
  - `const GRAPH_API_BASE = 'https://graph.facebook.com/v19.0'` (exported for tests/inspection).
  - `async function createImageContainer({ igUserId, accessToken, imageUrl, caption, isCarouselItem = false }, fetchImpl = fetch)` → `string` (the created container's id). Caption is omitted from the request when `isCarouselItem` is true (Instagram rejects captions on carousel child items).
  - `async function pollContainerStatus({ creationId, accessToken, delayMs = 2000, maxAttempts = 30 }, fetchImpl = fetch)` → resolves (no return value) once `status_code` is `'FINISHED'`; throws if it's `'ERROR'` or `'EXPIRED'`, or if `maxAttempts` is exceeded while still `'IN_PROGRESS'`.
  - `async function publishContainer({ igUserId, accessToken, creationId }, fetchImpl = fetch)` → `string` (published media id).
  - `async function postSingleImage({ igUserId, accessToken, imageUrl, caption }, fetchImpl = fetch)` → `string` (published media id); composes the three functions above.
  - All functions throw an `Error` with the Graph API's own error message (from the response body's `error.message`, falling back to the HTTP status text) on any non-2xx response.

- [ ] **Step 1: Write the failing test**

```javascript
// test/instagram.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GRAPH_API_BASE,
  createImageContainer,
  pollContainerStatus,
  publishContainer,
  postSingleImage,
} from '../src/instagram.js';

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

test('createImageContainer posts to /{igUserId}/media and returns the container id', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ id: 'container-123' });
  };

  const id = await createImageContainer(
    { igUserId: 'IGUSER', accessToken: 'TOKEN', imageUrl: 'https://ex.com/a.png', caption: 'hi' },
    fakeFetch
  );

  assert.equal(id, 'container-123');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${GRAPH_API_BASE}/IGUSER/media`);
  const body = new URLSearchParams(calls[0].options.body);
  assert.equal(body.get('image_url'), 'https://ex.com/a.png');
  assert.equal(body.get('caption'), 'hi');
  assert.equal(body.get('access_token'), 'TOKEN');
});

test('createImageContainer omits caption for carousel items', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push(options);
    return jsonResponse({ id: 'child-1' });
  };

  await createImageContainer(
    { igUserId: 'IGUSER', accessToken: 'TOKEN', imageUrl: 'https://ex.com/a.png', isCarouselItem: true },
    fakeFetch
  );

  const body = new URLSearchParams(calls[0].body);
  assert.equal(body.get('is_carousel_item'), 'true');
  assert.equal(body.has('caption'), false);
});

test('pollContainerStatus resolves once status_code is FINISHED', async () => {
  let call = 0;
  const statuses = ['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED'];
  const fakeFetch = async () => {
    const status_code = statuses[call++];
    return jsonResponse({ status_code });
  };

  await assert.doesNotReject(() =>
    pollContainerStatus({ creationId: 'c1', accessToken: 'TOKEN', delayMs: 1, maxAttempts: 10 }, fakeFetch)
  );
  assert.equal(call, 3);
});

test('pollContainerStatus throws on ERROR status', async () => {
  const fakeFetch = async () => jsonResponse({ status_code: 'ERROR' });
  await assert.rejects(
    () => pollContainerStatus({ creationId: 'c1', accessToken: 'TOKEN', delayMs: 1, maxAttempts: 10 }, fakeFetch),
    /ERROR/
  );
});

test('pollContainerStatus throws after exceeding maxAttempts while still IN_PROGRESS', async () => {
  const fakeFetch = async () => jsonResponse({ status_code: 'IN_PROGRESS' });
  await assert.rejects(() =>
    pollContainerStatus({ creationId: 'c1', accessToken: 'TOKEN', delayMs: 1, maxAttempts: 3 }, fakeFetch)
  );
});

test('publishContainer posts to /{igUserId}/media_publish and returns the media id', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ id: 'media-999' });
  };

  const id = await publishContainer({ igUserId: 'IGUSER', accessToken: 'TOKEN', creationId: 'c1' }, fakeFetch);

  assert.equal(id, 'media-999');
  assert.equal(calls[0].url, `${GRAPH_API_BASE}/IGUSER/media_publish`);
  const body = new URLSearchParams(calls[0].options.body);
  assert.equal(body.get('creation_id'), 'c1');
});

test('a non-ok response throws with the Graph API error message', async () => {
  const fakeFetch = async () => jsonResponse({ error: { message: 'Invalid token' } }, false, 400);
  await assert.rejects(
    () => createImageContainer({ igUserId: 'X', accessToken: 'BAD', imageUrl: 'https://ex.com/a.png' }, fakeFetch),
    /Invalid token/
  );
});

test('postSingleImage composes create + poll + publish into one media id', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.endsWith('/media')) return jsonResponse({ id: 'container-1' });
    if (url.endsWith('/media_publish')) return jsonResponse({ id: 'media-1' });
    return jsonResponse({ status_code: 'FINISHED' }); // the polling GET
  };

  const mediaId = await postSingleImage(
    { igUserId: 'IGUSER', accessToken: 'TOKEN', imageUrl: 'https://ex.com/a.png', caption: 'hi' },
    fakeFetch
  );

  assert.equal(mediaId, 'media-1');
  assert.ok(calls.some((u) => u.endsWith('/media')));
  assert.ok(calls.some((u) => u.includes('container-1')));
  assert.ok(calls.some((u) => u.endsWith('/media_publish')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/instagram.test.js`
Expected: FAIL — `Cannot find module '../src/instagram.js'`

- [ ] **Step 3: Write `src/instagram.js`**

```javascript
// src/instagram.js
export const GRAPH_API_BASE = 'https://graph.facebook.com/v19.0';

export async function createImageContainer(
  { igUserId, accessToken, imageUrl, caption, isCarouselItem = false },
  fetchImpl = fetch
) {
  const params = { image_url: imageUrl, access_token: accessToken };
  if (isCarouselItem) {
    params.is_carousel_item = 'true';
  } else if (caption) {
    params.caption = caption;
  }
  const body = await graphPost(`/${igUserId}/media`, params, fetchImpl);
  return body.id;
}

export async function pollContainerStatus(
  { creationId, accessToken, delayMs = 2000, maxAttempts = 30 },
  fetchImpl = fetch
) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const body = await graphGet(`/${creationId}`, { fields: 'status_code', access_token: accessToken }, fetchImpl);
    if (body.status_code === 'FINISHED') return;
    if (body.status_code === 'ERROR' || body.status_code === 'EXPIRED') {
      throw new Error(`Instagram media container ${creationId} failed with status ${body.status_code}`);
    }
    await sleep(delayMs);
  }
  throw new Error(`Instagram media container ${creationId} did not finish processing in time`);
}

export async function publishContainer({ igUserId, accessToken, creationId }, fetchImpl = fetch) {
  const body = await graphPost(
    `/${igUserId}/media_publish`,
    { creation_id: creationId, access_token: accessToken },
    fetchImpl
  );
  return body.id;
}

export async function postSingleImage({ igUserId, accessToken, imageUrl, caption }, fetchImpl = fetch) {
  const creationId = await createImageContainer({ igUserId, accessToken, imageUrl, caption }, fetchImpl);
  await pollContainerStatus({ creationId, accessToken }, fetchImpl);
  return publishContainer({ igUserId, accessToken, creationId }, fetchImpl);
}

async function graphPost(path, params, fetchImpl) {
  const res = await fetchImpl(`${GRAPH_API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  return parseGraphResponse(res);
}

async function graphGet(path, params, fetchImpl) {
  const query = new URLSearchParams(params).toString();
  const res = await fetchImpl(`${GRAPH_API_BASE}${path}?${query}`);
  return parseGraphResponse(res);
}

async function parseGraphResponse(res) {
  const body = await res.json();
  if (!res.ok || body.error) {
    throw new Error(body.error?.message || `Instagram API request failed (${res.status})`);
  }
  return body;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/instagram.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/instagram.js test/instagram.test.js
git commit -m "feat: Instagram Graph API client (single image posting)"
```

---

### Task 5: Instagram Graph API client — carousel

**Files:**
- Modify: `src/instagram.js`
- Modify: `test/instagram.test.js`

**Interfaces:**
- Consumes: `createImageContainer`, `pollContainerStatus`, `publishContainer` from Task 4 (same file).
- Produces: adds `async function postCarousel({ igUserId, accessToken, imageUrls, caption }, fetchImpl = fetch)` → `string` (published media id). Creates one child container per URL in `imageUrls` (`isCarouselItem: true`, no caption), polls each to `FINISHED`, creates a parent container (`media_type: 'CAROUSEL'`, `children` = comma-joined child ids, the caption), polls the parent, publishes it.

- [ ] **Step 1: Write the failing test**

Append to `test/instagram.test.js`:

```javascript
test('postCarousel creates child containers, a parent carousel container, and publishes it', async () => {
  const calls = [];
  let childCount = 0;
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    if (options?.method === 'POST' && url.endsWith('/media')) {
      const body = new URLSearchParams(options.body);
      if (body.get('is_carousel_item') === 'true') {
        childCount += 1;
        return jsonResponse({ id: `child-${childCount}` });
      }
      // parent carousel container
      return jsonResponse({ id: 'parent-1' });
    }
    if (url.endsWith('/media_publish')) return jsonResponse({ id: 'media-carousel-1' });
    return jsonResponse({ status_code: 'FINISHED' }); // polling GET
  };

  const mediaId = await postCarousel(
    {
      igUserId: 'IGUSER',
      accessToken: 'TOKEN',
      imageUrls: ['https://ex.com/a.png', 'https://ex.com/b.png'],
      caption: 'carousel caption',
    },
    fakeFetch
  );

  assert.equal(mediaId, 'media-carousel-1');

  const parentCall = calls.find((c) => {
    if (!c.url.endsWith('/media') || c.options?.method !== 'POST') return false;
    const body = new URLSearchParams(c.options.body);
    return body.get('media_type') === 'CAROUSEL';
  });
  assert.ok(parentCall, 'expected a parent container request with media_type=CAROUSEL');
  const parentBody = new URLSearchParams(parentCall.options.body);
  assert.equal(parentBody.get('children'), 'child-1,child-2');
  assert.equal(parentBody.get('caption'), 'carousel caption');
});
```

Also update the import line at the top of `test/instagram.test.js` to include `postCarousel`:

```javascript
import {
  GRAPH_API_BASE,
  createImageContainer,
  pollContainerStatus,
  publishContainer,
  postSingleImage,
  postCarousel,
} from '../src/instagram.js';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/instagram.test.js`
Expected: FAIL — `postCarousel is not a function` (or similar)

- [ ] **Step 3: Add `postCarousel` to `src/instagram.js`**

Append to `src/instagram.js` (keep everything else unchanged):

```javascript
export async function postCarousel({ igUserId, accessToken, imageUrls, caption }, fetchImpl = fetch) {
  const childIds = [];
  for (const imageUrl of imageUrls) {
    const childId = await createImageContainer(
      { igUserId, accessToken, imageUrl, isCarouselItem: true },
      fetchImpl
    );
    await pollContainerStatus({ creationId: childId, accessToken }, fetchImpl);
    childIds.push(childId);
  }

  const parentBody = await graphPost(
    `/${igUserId}/media`,
    {
      media_type: 'CAROUSEL',
      children: childIds.join(','),
      caption,
      access_token: accessToken,
    },
    fetchImpl
  );
  const parentId = parentBody.id;

  await pollContainerStatus({ creationId: parentId, accessToken }, fetchImpl);
  return publishContainer({ igUserId, accessToken, creationId: parentId }, fetchImpl);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/instagram.test.js`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/instagram.js test/instagram.test.js
git commit -m "feat: Instagram carousel posting"
```

---

### Task 6: Local tunnel wrapper

**Files:**
- Create: `src/tunnel.js`
- Test: `test/tunnel.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `src/tunnel.js` exports `async function startTunnel(port, localtunnelImpl = localtunnel)` (default import from the `localtunnel` package) → `{ url: string, close: () => Promise<void> }`.

- [ ] **Step 1: Add the `localtunnel` dependency**

Modify `package.json`'s `dependencies` block to add (keep existing entries and alphabetical-ish ordering as-is, just add this line):

```json
    "localtunnel": "^2.0.2",
```

Run:
```bash
npm install
```
Expected: installs with no errors.

- [ ] **Step 2: Write the failing test**

```javascript
// test/tunnel.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { startTunnel } from '../src/tunnel.js';

test('startTunnel wraps the underlying tunnel implementation with { url, close }', async () => {
  let closed = false;
  let requestedPort = null;
  const fakeLocaltunnel = async ({ port }) => {
    requestedPort = port;
    return {
      url: 'https://fake-subdomain.loca.lt',
      close: async () => {
        closed = true;
      },
    };
  };

  const tunnel = await startTunnel(4321, fakeLocaltunnel);

  assert.equal(requestedPort, 4321);
  assert.equal(tunnel.url, 'https://fake-subdomain.loca.lt');

  await tunnel.close();
  assert.equal(closed, true);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/tunnel.test.js`
Expected: FAIL — `Cannot find module '../src/tunnel.js'`

- [ ] **Step 4: Write `src/tunnel.js`**

```javascript
// src/tunnel.js
import localtunnel from 'localtunnel';

export async function startTunnel(port, localtunnelImpl = localtunnel) {
  const tunnel = await localtunnelImpl({ port });
  return {
    url: tunnel.url,
    close: () => tunnel.close(),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/tunnel.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/tunnel.js test/tunnel.test.js
git commit -m "feat: local tunnel wrapper for public image URLs"
```

---

### Task 7: Posting orchestration service

**Files:**
- Create: `src/postingService.js`
- Test: `test/postingService.test.js`

**Interfaces:**
- Consumes: `readQueue`, `writeQueue`, `countPostsInLast24h` from Task 3 (`src/postQueue.js`); `postSingleImage`, `postCarousel` from Tasks 4/5 (`src/instagram.js`); `startTunnel` from Task 6 (`src/tunnel.js`).
- Produces: `src/postingService.js` exports `async function postQueueItem(itemId, { igUserId, accessToken, outputRoot, port, queueFilePath, postSingleImageFn = postSingleImage, postCarouselFn = postCarousel, startTunnelFn = startTunnel })` → the updated queue item object (also persisted to `queueFilePath`). Looks up `itemId` in the queue at `queueFilePath` (throws if not found), checks the 25/24h rate limit (marks `failed` and returns early if at the cap), sets `status: 'posting'` and persists, starts a tunnel, builds public URL(s) for `item.images` as `${tunnelUrl}/output/<path relative to outputRoot>`, posts (single or carousel per `item.kind`), sets `status: 'posted'` with `igMediaId`/`postedAt` on success or `status: 'failed'` with `error` on any thrown error, always closes the tunnel and persists the final state.

- [ ] **Step 1: Write the failing test**

```javascript
// test/postingService.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readQueue, writeQueue, createQueueItem } from '../src/postQueue.js';
import { postQueueItem } from '../src/postingService.js';

async function withTempQueue(items) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'posting-service-test-'));
  const queueFilePath = path.join(dir, 'post-queue.json');
  await writeQueue(queueFilePath, { items });
  return { dir, queueFilePath };
}

test('postQueueItem posts a single image and records success', async () => {
  const item = createQueueItem({
    siteName: 'baba-ganoush',
    pageUrl: 'https://example.com/index.html',
    kind: 'single',
    images: ['/output/baba-ganoush/index-html/composites/section-0-composite.png'],
    caption: 'hi',
  });
  const { dir, queueFilePath } = await withTempQueue([item]);

  const startTunnelFn = async () => ({ url: 'https://fake.loca.lt', close: async () => {} });
  const postSingleImageFn = async ({ imageUrl, caption }) => {
    assert.equal(
      imageUrl,
      'https://fake.loca.lt/output/index-html/composites/section-0-composite.png'
    );
    assert.equal(caption, 'hi');
    return 'media-1';
  };

  const result = await postQueueItem(item.id, {
    igUserId: 'IGUSER',
    accessToken: 'TOKEN',
    outputRoot: '/output/baba-ganoush',
    port: 3000,
    queueFilePath,
    startTunnelFn,
    postSingleImageFn,
  });

  assert.equal(result.status, 'posted');
  assert.equal(result.igMediaId, 'media-1');
  assert.ok(result.postedAt);
  assert.equal(result.error, null);

  const onDisk = await readQueue(queueFilePath);
  assert.equal(onDisk.items[0].status, 'posted');

  await fs.rm(dir, { recursive: true, force: true });
});

test('postQueueItem posts a carousel using postCarouselFn', async () => {
  const item = createQueueItem({
    siteName: 'baba-ganoush',
    pageUrl: 'https://example.com/index.html',
    kind: 'carousel',
    images: [
      '/output/baba-ganoush/index-html/composites/section-0-composite.png',
      '/output/baba-ganoush/index-html/composites/section-1-composite.png',
    ],
    caption: 'hi',
  });
  const { dir, queueFilePath } = await withTempQueue([item]);

  const startTunnelFn = async () => ({ url: 'https://fake.loca.lt', close: async () => {} });
  const postCarouselFn = async ({ imageUrls }) => {
    assert.equal(imageUrls.length, 2);
    return 'media-carousel-1';
  };

  const result = await postQueueItem(item.id, {
    igUserId: 'IGUSER',
    accessToken: 'TOKEN',
    outputRoot: '/output/baba-ganoush',
    port: 3000,
    queueFilePath,
    startTunnelFn,
    postCarouselFn,
  });

  assert.equal(result.status, 'posted');
  assert.equal(result.igMediaId, 'media-carousel-1');

  await fs.rm(dir, { recursive: true, force: true });
});

test('postQueueItem marks the item failed and always closes the tunnel on error', async () => {
  const item = createQueueItem({
    siteName: 'baba-ganoush',
    pageUrl: 'https://example.com/index.html',
    kind: 'single',
    images: ['/output/baba-ganoush/index-html/composites/section-0-composite.png'],
    caption: 'hi',
  });
  const { dir, queueFilePath } = await withTempQueue([item]);

  let closed = false;
  const startTunnelFn = async () => ({
    url: 'https://fake.loca.lt',
    close: async () => {
      closed = true;
    },
  });
  const postSingleImageFn = async () => {
    throw new Error('Instagram said no');
  };

  const result = await postQueueItem(item.id, {
    igUserId: 'IGUSER',
    accessToken: 'TOKEN',
    outputRoot: '/output/baba-ganoush',
    port: 3000,
    queueFilePath,
    startTunnelFn,
    postSingleImageFn,
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'Instagram said no');
  assert.equal(closed, true);

  await fs.rm(dir, { recursive: true, force: true });
});

test('postQueueItem refuses to post past the 25/24h rate limit without starting a tunnel', async () => {
  const now = Date.now();
  const postedRecently = Array.from({ length: 25 }, (_, i) =>
    createQueueItem({
      siteName: 's',
      pageUrl: 'https://example.com/index.html',
      kind: 'single',
      images: ['/output/s/page/composites/a.png'],
      caption: 'c',
    })
  ).map((it) => ({ ...it, status: 'posted', postedAt: new Date(now - 1000).toISOString() }));

  const item = createQueueItem({
    siteName: 'baba-ganoush',
    pageUrl: 'https://example.com/index.html',
    kind: 'single',
    images: ['/output/baba-ganoush/index-html/composites/section-0-composite.png'],
    caption: 'hi',
  });
  const { dir, queueFilePath } = await withTempQueue([...postedRecently, item]);

  let tunnelStarted = false;
  const startTunnelFn = async () => {
    tunnelStarted = true;
    return { url: 'https://fake.loca.lt', close: async () => {} };
  };

  const result = await postQueueItem(item.id, {
    igUserId: 'IGUSER',
    accessToken: 'TOKEN',
    outputRoot: '/output/baba-ganoush',
    port: 3000,
    queueFilePath,
    startTunnelFn,
  });

  assert.equal(result.status, 'failed');
  assert.match(result.error, /rate limit/i);
  assert.equal(tunnelStarted, false);

  await fs.rm(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/postingService.test.js`
Expected: FAIL — `Cannot find module '../src/postingService.js'`

- [ ] **Step 3: Write `src/postingService.js`**

```javascript
// src/postingService.js
import path from 'node:path';
import { readQueue, writeQueue, countPostsInLast24h } from './postQueue.js';
import { postSingleImage, postCarousel } from './instagram.js';
import { startTunnel } from './tunnel.js';

export async function postQueueItem(
  itemId,
  {
    igUserId,
    accessToken,
    outputRoot,
    port,
    queueFilePath,
    postSingleImageFn = postSingleImage,
    postCarouselFn = postCarousel,
    startTunnelFn = startTunnel,
  }
) {
  const queue = await readQueue(queueFilePath);
  const item = queue.items.find((i) => i.id === itemId);
  if (!item) {
    throw new Error(`Queue item ${itemId} not found`);
  }

  if (countPostsInLast24h(queue) >= 25) {
    item.status = 'failed';
    item.error = 'Instagram rate limit reached (25 posts/24h) — try again later.';
    await writeQueue(queueFilePath, queue);
    return item;
  }

  item.status = 'posting';
  await writeQueue(queueFilePath, queue);

  let tunnel;
  try {
    tunnel = await startTunnelFn(port);
    const imageUrls = item.images.map((imagePath) => toPublicUrl(imagePath, outputRoot, tunnel.url));

    const igMediaId =
      item.kind === 'carousel'
        ? await postCarouselFn({ igUserId, accessToken, imageUrls, caption: item.caption })
        : await postSingleImageFn({ igUserId, accessToken, imageUrl: imageUrls[0], caption: item.caption });

    item.status = 'posted';
    item.igMediaId = igMediaId;
    item.postedAt = new Date().toISOString();
    item.error = null;
  } catch (err) {
    item.status = 'failed';
    item.error = err.message;
  } finally {
    if (tunnel) await tunnel.close();
    await writeQueue(queueFilePath, queue);
  }

  return item;
}

function toPublicUrl(absoluteImagePath, outputRoot, tunnelUrl) {
  const relative = path.relative(outputRoot, absoluteImagePath).split(path.sep).join('/');
  return `${tunnelUrl}/output/${relative}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/postingService.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/postingService.js test/postingService.test.js
git commit -m "feat: posting orchestration service (tunnel + instagram + queue)"
```

---

### Task 8: Queue API routes + server wiring

**Files:**
- Create: `src/routes/postQueue.js`
- Modify: `src/server.js`
- Test: `test/postQueueRoute.test.js`

**Interfaces:**
- Consumes: `readQueue`, `writeQueue`, `createQueueItem` from Task 3; `postQueueItem` from Task 7; `loadEnvFile` from Task 1.
- Produces:
  - `src/routes/postQueue.js` exports `function createPostQueueRouter({ outputRoot, deps = {} })` returning an Express router with:
    - `POST /queue` — body `{ siteName, pageUrl, kind, images, caption }`. Validates all fields present (`images` non-empty array). Returns 400 with `{error}` if invalid, or if `IG_BUSINESS_ACCOUNT_ID`/`IG_ACCESS_TOKEN` env vars are unset. Otherwise creates the queue item, persists it, immediately calls `postQueueItem` (via `req.socket.localPort` as the port, so it always matches however the server was actually started — fixed port, autoPort, or an ephemeral test port), and responds with the resulting item (200, whatever its final `status`).
    - `GET /queue` — responds `{ items }`, newest first (reverse of storage order).
  - `deps` is spread into the `postQueueItem` call's options object, so tests can inject fake `postSingleImageFn`/`postCarouselFn`/`startTunnelFn` at router-creation time.
  - `src/server.js` is modified: calls `loadEnvFile` for a `.env` next to `package.json` before anything else, and mounts `createPostQueueRouter({ outputRoot })` under `/api` alongside the existing run router.

- [ ] **Step 1: Write the failing test**

```javascript
// test/postQueueRoute.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createPostQueueRouter } from '../src/routes/postQueue.js';
import { readQueue } from '../src/postQueue.js';

async function startTestApp(outputRoot, deps) {
  const app = express();
  app.use(express.json());
  app.use('/api', createPostQueueRouter({ outputRoot, deps }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

test('POST /api/queue validates required fields', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-route-test-'));
  const { server, base } = await startTestApp(outputRoot, {});
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const res = await fetch(`${base}/api/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteName: 'x' }),
  });
  assert.equal(res.status, 400);
});

test('POST /api/queue requires Instagram env vars to be configured', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-route-test-'));
  const { server, base } = await startTestApp(outputRoot, {});
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const originalUserId = process.env.IG_BUSINESS_ACCOUNT_ID;
  const originalToken = process.env.IG_ACCESS_TOKEN;
  delete process.env.IG_BUSINESS_ACCOUNT_ID;
  delete process.env.IG_ACCESS_TOKEN;

  const res = await fetch(`${base}/api/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      siteName: 'baba-ganoush',
      pageUrl: 'https://example.com/index.html',
      kind: 'single',
      images: ['/x/a.png'],
      caption: 'hi',
    }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /not configured/i);

  if (originalUserId !== undefined) process.env.IG_BUSINESS_ACCOUNT_ID = originalUserId;
  if (originalToken !== undefined) process.env.IG_ACCESS_TOKEN = originalToken;
});

test('POST /api/queue then GET /api/queue reflects a posted item, using injected fakes', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-route-test-'));
  const deps = {
    startTunnelFn: async () => ({ url: 'https://fake.loca.lt', close: async () => {} }),
    postSingleImageFn: async () => 'media-1',
  };
  const { server, base } = await startTestApp(outputRoot, deps);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  process.env.IG_BUSINESS_ACCOUNT_ID = 'IGUSER';
  process.env.IG_ACCESS_TOKEN = 'TOKEN';

  const postRes = await fetch(`${base}/api/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      siteName: 'baba-ganoush',
      pageUrl: 'https://example.com/index.html',
      kind: 'single',
      images: [path.join(outputRoot, 'baba-ganoush/index-html/composites/section-0-composite.png')],
      caption: 'hi',
    }),
  });
  assert.equal(postRes.status, 200);
  const posted = await postRes.json();
  assert.equal(posted.status, 'posted');
  assert.equal(posted.igMediaId, 'media-1');

  const listRes = await fetch(`${base}/api/queue`);
  const { items } = await listRes.json();
  assert.equal(items.length, 1);
  assert.equal(items[0].id, posted.id);

  const onDisk = await readQueue(path.join(outputRoot, 'post-queue.json'));
  assert.equal(onDisk.items[0].status, 'posted');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/postQueueRoute.test.js`
Expected: FAIL — `Cannot find module '../src/routes/postQueue.js'`

- [ ] **Step 3: Write `src/routes/postQueue.js`**

```javascript
// src/routes/postQueue.js
import express from 'express';
import path from 'node:path';
import { readQueue, writeQueue, createQueueItem } from '../postQueue.js';
import { postQueueItem } from '../postingService.js';

export function createPostQueueRouter({ outputRoot, deps = {} }) {
  const router = express.Router();
  const queueFilePath = path.join(outputRoot, 'post-queue.json');

  router.post('/queue', async (req, res) => {
    const { siteName, pageUrl, kind, images, caption } = req.body || {};
    if (
      !siteName ||
      !pageUrl ||
      !kind ||
      !Array.isArray(images) ||
      images.length === 0 ||
      !caption
    ) {
      res.status(400).json({
        error: 'Provide siteName, pageUrl, kind, images (non-empty array), and caption',
      });
      return;
    }

    const igUserId = process.env.IG_BUSINESS_ACCOUNT_ID;
    const accessToken = process.env.IG_ACCESS_TOKEN;
    if (!igUserId || !accessToken) {
      res.status(400).json({
        error: 'Instagram is not configured — set IG_BUSINESS_ACCOUNT_ID and IG_ACCESS_TOKEN in .env',
      });
      return;
    }

    const item = createQueueItem({ siteName, pageUrl, kind, images, caption });
    const queue = await readQueue(queueFilePath);
    queue.items.push(item);
    await writeQueue(queueFilePath, queue);

    const result = await postQueueItem(item.id, {
      igUserId,
      accessToken,
      outputRoot,
      port: req.socket.localPort,
      queueFilePath,
      ...deps,
    });
    res.json(result);
  });

  router.get('/queue', async (req, res) => {
    const queue = await readQueue(queueFilePath);
    res.json({ items: [...queue.items].reverse() });
  });

  return router;
}
```

- [ ] **Step 4: Modify `src/server.js`**

Add the import and the env-loading call near the top, and mount the new router. The file should end up looking like this in full:

```javascript
// src/server.js
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunRouter } from './routes/run.js';
import { createPostQueueRouter } from './routes/postQueue.js';
import { loadEnvFile } from './env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

loadEnvFile(path.join(__dirname, '..', '.env'));

export function createApp({ outputRoot = path.join(__dirname, '..', 'output') } = {}) {
  const app = express();
  const runs = new Map();

  app.use(express.json());
  app.use('/api', createRunRouter({ outputRoot, runs }));
  app.use('/api', createPostQueueRouter({ outputRoot }));
  app.use('/output', express.static(outputRoot));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  const port = process.env.PORT || 3000;
  app.listen(port, '127.0.0.1', () =>
    console.log(`Screenshot Taker running on http://localhost:${port}`)
  );
}
```

(This preserves every existing line from Task 10's final-review fix — the loopback bind, the `/output` static mount — and only adds the `loadEnvFile` call and the new router. If your working copy of `server.js` differs from this in some other way, keep those differences and just add the two new lines plus the import.)

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/postQueueRoute.test.js`
Expected: PASS

Then run the full suite to confirm nothing else broke:

Run: `npm test`
Expected: PASS (all prior tests plus these)

- [ ] **Step 6: Commit**

```bash
git add src/routes/postQueue.js src/server.js test/postQueueRoute.test.js
git commit -m "feat: POST/GET /api/queue routes, wire into server"
```

---

### Task 9: Frontend — post buttons, caption editor, queue panel

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`

**Interfaces:**
- Consumes: `POST /api/queue`, `GET /api/queue` from Task 8.
- Produces: no new backend interfaces — UI only.

- [ ] **Step 1: Add a Queue section to `public/index.html`**

Add this new `<section>` right after the existing `<section id="gallery" ...>` block (before the closing `</main>`):

```html
    <section id="queue-panel" class="deck" aria-labelledby="queue-heading">
      <div class="deck-label">
        <span class="frame-no">04</span>
        <h2 id="queue-heading">Post log</h2>
      </div>
      <div id="queue-content" class="queue-content">
        <p class="queue-empty">Nothing posted yet.</p>
      </div>
    </section>

    <div id="caption-modal" class="modal-overlay" hidden>
      <div class="modal-card">
        <h3 id="caption-modal-title">Post to Instagram</h3>
        <textarea id="caption-text" rows="6"></textarea>
        <div class="modal-actions">
          <button type="button" id="caption-cancel" class="modal-btn-secondary">Cancel</button>
          <button type="button" id="caption-submit" class="shutter">
            <span class="shutter-ring"></span>
            <span class="shutter-label">Post</span>
          </button>
        </div>
        <p id="caption-error" class="caption-error" hidden></p>
      </div>
    </div>
```

- [ ] **Step 2: Add posting UI logic to `public/app.js`**

Add these new element references near the top of the file, right after the existing `const downloadLink = ...` line:

```javascript
const queueContent = document.getElementById('queue-content');
const captionModal = document.getElementById('caption-modal');
const captionModalTitle = document.getElementById('caption-modal-title');
const captionText = document.getElementById('caption-text');
const captionCancel = document.getElementById('caption-cancel');
const captionSubmit = document.getElementById('caption-submit');
const captionError = document.getElementById('caption-error');

const HASHTAGS = '#webdesign #restaurant #instagood #foodie #smallbusiness';
let pendingPost = null; // { siteName, pageUrl, kind, images } awaiting caption confirmation
```

Add this draft-caption helper and the modal wiring anywhere after those declarations (e.g. right before the `renderGallery` function):

```javascript
function draftCaption({ siteName, pageUrl, slug }) {
  const generic = /^section-\d+$/.test(slug);
  let heading = slug;
  if (generic) {
    const { pathname } = new URL(pageUrl);
    const base = pathname.replace(/^\/+|\/+$/g, '').replace(/\.html$/, '');
    heading = base === '' || base === 'index' ? 'home' : base;
  }
  return `${siteName} — ${heading}\n\n${HASHTAGS}`;
}

function openCaptionModal({ siteName, pageUrl, kind, images, slugForDraft }) {
  pendingPost = { siteName, pageUrl, kind, images };
  captionModalTitle.textContent = kind === 'carousel' ? 'Post page as carousel' : 'Post section';
  captionText.value = draftCaption({ siteName, pageUrl, slug: slugForDraft });
  captionError.hidden = true;
  captionModal.hidden = false;
  captionText.focus();
}

function closeCaptionModal() {
  captionModal.hidden = true;
  pendingPost = null;
}

captionCancel.addEventListener('click', closeCaptionModal);

captionSubmit.addEventListener('click', async () => {
  if (!pendingPost) return;
  captionSubmit.disabled = true;
  captionSubmit.classList.add('spinning');
  captionError.hidden = true;

  try {
    const res = await fetch('/api/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...pendingPost, caption: captionText.value }),
    });
    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || `Request failed (status ${res.status})`);
    }
    closeCaptionModal();
    await refreshQueue();
  } catch (err) {
    captionError.textContent = err.message;
    captionError.hidden = false;
  } finally {
    captionSubmit.disabled = false;
    captionSubmit.classList.remove('spinning');
  }
});

async function refreshQueue() {
  const res = await fetch('/api/queue');
  const { items } = await res.json();
  renderQueue(items);
}

function renderQueue(items) {
  queueContent.innerHTML = '';
  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'queue-empty';
    empty.textContent = 'Nothing posted yet.';
    queueContent.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'queue-row';

    const status = document.createElement('span');
    status.className = `queue-status queue-status-${item.status}`;
    status.textContent = item.status;

    const label = document.createElement('span');
    label.className = 'queue-label';
    label.textContent = `${item.siteName} — ${item.kind === 'carousel' ? 'carousel' : 'single'}`;

    row.appendChild(status);
    row.appendChild(label);

    if (item.status === 'failed' && item.error) {
      const err = document.createElement('span');
      err.className = 'queue-error';
      err.textContent = item.error;
      row.appendChild(err);
    }

    queueContent.appendChild(row);
  }
}
```

- [ ] **Step 3: Wire post buttons into the gallery renderer**

Modify the existing `renderGallery` function's per-section loop in `public/app.js` — inside `for (const section of page.sections) { ... }`, right after the `frame.appendChild(tag);` line (which appends the slug/count tag), add a post button:

```javascript
      if (section.composite) {
        const postBtn = document.createElement('button');
        postBtn.type = 'button';
        postBtn.className = 'frame-post-btn';
        postBtn.textContent = 'Post';
        postBtn.addEventListener('click', () =>
          openCaptionModal({
            siteName: manifest.site,
            pageUrl: page.url,
            kind: 'single',
            images: [section.composite],
            slugForDraft: section.slug,
          })
        );
        frame.appendChild(postBtn);
      }
```

Also add a "Post page as carousel" button per page — modify the existing `pageBlock.appendChild(title);` line to be followed by:

```javascript
    const pageComposites = page.sections.filter((s) => s.composite).map((s) => s.composite);
    if (pageComposites.length > 1) {
      const carouselBtn = document.createElement('button');
      carouselBtn.type = 'button';
      carouselBtn.className = 'page-carousel-btn';
      carouselBtn.textContent = `Post all ${pageComposites.length} as carousel`;
      carouselBtn.addEventListener('click', () =>
        openCaptionModal({
          siteName: manifest.site,
          pageUrl: page.url,
          kind: 'carousel',
          images: pageComposites,
          slugForDraft: page.sections[0].slug,
        })
      );
      pageBlock.appendChild(carouselBtn);
    }
```

Finally, call `refreshQueue()` once on initial page load — add this line at the very end of `public/app.js`:

```javascript
refreshQueue();
```

- [ ] **Step 4: Add styling to `public/style.css`**

Append to the end of `public/style.css`:

```css
/* ---------------------------------------------------------------
   Instagram posting UI
   ------------------------------------------------------------- */

.frame-post-btn,
.page-carousel-btn {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink);
  background: var(--ground-raised);
  border: 1px solid var(--line-bright);
  border-radius: 999px;
  padding: 5px 12px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.frame-post-btn:hover,
.page-carousel-btn:hover {
  border-color: var(--safelight);
  color: var(--safelight);
}

.page-carousel-btn {
  margin: -4px 0 14px;
  display: inline-block;
}

.queue-content {
  background: var(--ground-card);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.queue-empty {
  color: var(--ink-faint);
  font-size: 13px;
  margin: 0;
}

.queue-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  padding: 6px 0;
  border-bottom: 1px dashed var(--line);
  flex-wrap: wrap;
}

.queue-row:last-child {
  border-bottom: none;
}

.queue-status {
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--line-bright);
  color: var(--ink-dim);
}

.queue-status-posted { color: var(--good); border-color: var(--good); }
.queue-status-failed { color: var(--bad); border-color: var(--bad); }
.queue-status-posting,
.queue-status-queued { color: var(--safelight); border-color: var(--safelight-dim); }

.queue-label {
  color: var(--ink-dim);
}

.queue-error {
  color: var(--bad);
  font-size: 12px;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
  padding: 24px;
}

.modal-card {
  background: var(--ground-card);
  border: 1px solid var(--line-bright);
  border-radius: 10px;
  padding: 24px;
  max-width: 480px;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.modal-card h3 {
  font-family: var(--font-display);
  font-weight: 600;
  margin: 0;
  color: var(--ink);
}

#caption-text {
  width: 100%;
  background: var(--ground-raised);
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: 13px;
  padding: 10px 12px;
  resize: vertical;
}

#caption-text:focus {
  outline: none;
  border-color: var(--safelight);
  box-shadow: 0 0 0 3px var(--safelight-glow);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.modal-btn-secondary {
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 13px;
  color: var(--ink-dim);
  background: transparent;
  border: 1px solid var(--line-bright);
  border-radius: 999px;
  padding: 10px 18px;
  cursor: pointer;
}

.modal-btn-secondary:hover {
  color: var(--ink);
  border-color: var(--ink-dim);
}

.caption-error {
  color: var(--bad);
  font-size: 12px;
  margin: 0;
}
```

- [ ] **Step 5: Manual verification**

Run:
```bash
npm start
```
Open `http://localhost:3000`, run against the fixture site (`test/fixtures/site` as a local folder), confirm the gallery now shows a "Post" button per composite and a "Post all N as carousel" button per page, clicking either opens the caption modal pre-filled with a draft, and the Post log section is present (will show "Nothing posted yet" without real Instagram credentials configured — that's expected and correct for this manual check; posting to a real account is verified separately after this plan is fully implemented).

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/app.js public/style.css
git commit -m "feat: frontend post buttons, caption editor, queue panel"
```

---

### Task 10: `.env.example` + README setup section

**Files:**
- Create: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Produces: no code interfaces — documentation only.

- [ ] **Step 1: Write `.env.example`**

```
# Instagram posting (optional — the app works fully without these, the
# gallery's Post buttons will just show "Instagram is not configured"
# until they're set).
#
# See the README's "Instagram posting setup" section for how to obtain
# these from your own Meta developer account.
IG_BUSINESS_ACCOUNT_ID=
IG_ACCESS_TOKEN=
```

- [ ] **Step 2: Add a setup section to `README.md`**

Add this new section to `README.md`, right before the existing `## License` heading:

```markdown
## Instagram posting setup

Posting requires an Instagram **Professional (Business or Creator)**
account linked to a Facebook Page, and a Meta developer app with Graph API
access. This is a one-time setup you do yourself in your own browser —
this tool never touches your Facebook/Instagram login.

1. In the Instagram app: Settings → Account type and tools → switch to a
   Professional account (Business or Creator) if you haven't already.
2. Create (or use an existing) Facebook Page, and link your Instagram
   account to it: Instagram Settings → Linked accounts, or via
   [Meta Business Suite](https://business.facebook.com).
3. Go to [developers.facebook.com](https://developers.facebook.com) →
   My Apps → Create App → choose "Business" as the app type.
4. In your new app, add the **Instagram Graph API** product.
5. Open the [Graph API Explorer](https://developers.facebook.com/tools/explorer),
   select your app and your Page, and generate a User Access Token with
   the `instagram_basic`, `instagram_content_publish`, `pages_show_list`,
   and `pages_read_engagement` permissions.
6. Exchange that short-lived token for a long-lived one (valid ~60 days) —
   the Graph API Explorer's token has a "debug"/extend option, or use the
   `oauth/access_token` endpoint with `grant_type=fb_exchange_token`.
7. Find your Instagram Business Account ID:
   `GET /{page-id}?fields=instagram_business_account&access_token=...`
8. Copy `.env.example` to `.env` and fill in `IG_BUSINESS_ACCOUNT_ID` and
   `IG_ACCESS_TOKEN`. Restart the app (`npm start`) to pick them up.

Long-lived tokens expire after ~60 days — repeat steps 5-8 to refresh.
```

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "docs: Instagram posting setup guide, .env.example"
```

---

### Task 11: End-to-end smoke test

**Files:**
- Test: `test/instagramPosting.e2e.test.js`

**Interfaces:**
- Consumes: `createApp` from `src/server.js` (Task 8), fixture site from the existing test suite.
- Produces: one integration test proving the whole posting flow works together over real HTTP, with Instagram/tunnel network calls faked at the dependency-injection seam — no real network call is made.

Note: `createApp` doesn't currently accept a `deps` parameter for the post-queue router — this task also threads one through, since the e2e test needs to inject fakes the same way `postQueueRoute.test.js` does directly against the router.

- [ ] **Step 1: Thread a `postQueueDeps` option through `createApp`**

Modify `src/server.js`'s `createApp` function signature and body:

```javascript
export function createApp({ outputRoot = path.join(__dirname, '..', 'output'), postQueueDeps = {} } = {}) {
  const app = express();
  const runs = new Map();

  app.use(express.json());
  app.use('/api', createRunRouter({ outputRoot, runs }));
  app.use('/api', createPostQueueRouter({ outputRoot, deps: postQueueDeps }));
  app.use('/output', express.static(outputRoot));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  return app;
}
```

- [ ] **Step 2: Write the test**

```javascript
// test/instagramPosting.e2e.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'site');

test('end-to-end: run the pipeline, then post a resulting composite to Instagram (faked)', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ig-e2e-test-'));
  const postSingleImageCalls = [];
  const postQueueDeps = {
    startTunnelFn: async () => ({ url: 'https://fake.loca.lt', close: async () => {} }),
    postSingleImageFn: async (args) => {
      postSingleImageCalls.push(args);
      return 'media-e2e-1';
    },
  };
  const app = createApp({ outputRoot, postQueueDeps });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  process.env.IG_BUSINESS_ACCOUNT_ID = 'IGUSER';
  process.env.IG_ACCESS_TOKEN = 'TOKEN';

  const runRes = await fetch(`${base}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ localFolder: fixtureDir, mode: 'auto', siteName: 'ig-e2e-fixture' }),
  });
  const { runId } = await runRes.json();

  const progressRes = await fetch(`${base}/api/progress/${runId}`);
  const text = await progressRes.text();
  const manifestMatch = text.match(/data: (\{"type":"manifest-ready".*\})\n\n/);
  const { manifest } = JSON.parse(manifestMatch[1]);

  const firstSection = manifest.pages[0].sections[0];
  assert.ok(firstSection.composite);

  const queueRes = await fetch(`${base}/api/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      siteName: manifest.site,
      pageUrl: manifest.pages[0].url,
      kind: 'single',
      images: [firstSection.composite],
      caption: 'end-to-end test caption',
    }),
  });
  assert.equal(queueRes.status, 200);
  const posted = await queueRes.json();
  assert.equal(posted.status, 'posted');
  assert.equal(posted.igMediaId, 'media-e2e-1');

  assert.equal(postSingleImageCalls.length, 1);
  assert.equal(postSingleImageCalls[0].caption, 'end-to-end test caption');
  assert.ok(postSingleImageCalls[0].imageUrl.startsWith('https://fake.loca.lt/output/'));

  const listRes = await fetch(`${base}/api/queue`);
  const { items } = await listRes.json();
  assert.equal(items.length, 1);
  assert.equal(items[0].status, 'posted');
});
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS — all test files including `instagramPosting.e2e.test.js` green.

- [ ] **Step 4: Commit**

```bash
git add src/server.js test/instagramPosting.e2e.test.js
git commit -m "test: full end-to-end smoke test for Instagram posting flow"
```

---

## Post-plan manual check

After Task 11 passes, follow the README's "Instagram posting setup" section to get a real `IG_BUSINESS_ACCOUNT_ID`/`IG_ACCESS_TOKEN` for a real test Instagram account, put them in a real `.env`, run `npm start`, generate composites for a real site, and click "Post" on one section to confirm an actual post appears on that Instagram account. This is the one step that can't be automated — it needs your own Meta login and posts to a real account. Log any issues found in `Notes/Engineering/Decisions.md`, the same way the earlier real-website capture testing was logged.
