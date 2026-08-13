# Instagram Auto-Posting (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build fully-automatic posting (opt into a run and every section gets queued automatically) and a scheduled queue (a background timer posts due items spaced apart, so a whole site's worth of sections doesn't all get posted to Instagram in the same second) on top of Phase 1's proven manual posting mechanism.

**Architecture:** No changes to the posting mechanism itself (`src/instagram.js`, `src/tunnel.js`, `src/postingService.js` are untouched). Two additions: (1) `POST /api/run` gains an opt-in `autoPost` flag — when a run finishes, every section with a composite is queued automatically with an auto-drafted caption and a `scheduledFor` timestamp spaced `SCHEDULE_INTERVAL_HOURS` apart; (2) a background interval (`src/scheduler.js`), started once when the server boots (only if Instagram is configured), wakes on a fixed cadence and posts at most one due queue item per tick. Manual "Post now" (Phase 1) keeps working exactly as before, unaffected and still immediate.

**Tech Stack:** Same as Phase 1 — no new dependencies.

## Global Constraints

- No changes to `src/instagram.js`, `src/tunnel.js`, or `src/postingService.js`'s posting logic — Phase 2 only changes how/when queue items get created and picked up, never how a post actually happens.
- `SCHEDULE_INTERVAL_HOURS` env var (documented in `.env.example` from Phase 1) controls spacing between auto-queued items; default 24 if unset or not a valid number.
- The scheduler must never start during tests — it's wired into `src/server.js`'s `if (import.meta.url === ...)` main-module guard only, never inside `createApp()` (which every test file calls freely and must stay side-effect-free with respect to timers).
- The scheduler posts **at most one** due item per tick — never a whole batch at once, even if multiple items are overdue.
- No automatic retry — same rule as Phase 1. A failed scheduled post is marked `failed` and left there; the scheduler moves on to the next tick, it doesn't retry the same item.

---

## File Structure

```
src/
  postQueue.js       # (modified) createQueueItem gains scheduledFor; add nextScheduledSlot, isDue
  scheduler.js         # new: runSchedulerTick (pure-ish, testable), startScheduler (setInterval wrapper)
  routes/
    run.js               # (modified) autoPost flag on POST /run; auto-queues sections on completion
  server.js                # (modified) starts the scheduler in the main-module guard, if IG configured
public/
  index.html                # (modified) auto-post checkbox on the run form
  app.js                     # (modified) send autoPost in the run POST body; show scheduledFor in the queue panel
test/
  postQueue.test.js            # (modified) new tests for nextScheduledSlot, isDue, scheduledFor default
  scheduler.test.js              # new
  runAutoPost.test.js              # new — tests the routes/run.js auto-queueing behavior
  instagramScheduling.e2e.test.js    # new — full run(autoPost) -> queue -> scheduler tick -> posted, over real HTTP
```

---

### Task 1: Scheduling primitives in postQueue.js

**Files:**
- Modify: `src/postQueue.js`
- Modify: `test/postQueue.test.js`

**Interfaces:**
- `createQueueItem({ siteName, pageUrl, kind, images, caption, scheduledFor })` — `scheduledFor` is now an accepted (optional) field; defaults to `new Date().toISOString()` (due immediately) when omitted, preserving Phase 1's existing manual-post behavior (every existing call site that doesn't pass it keeps working identically).
- `function nextScheduledSlot(queue, intervalHours, now = new Date())` → ISO timestamp string. Looks at every item in `queue.items` with `status === 'queued'`; if none, returns `now`. Otherwise returns the latest such item's `scheduledFor` plus `intervalHours` (so each newly auto-queued item lands `intervalHours` after the previous one, never bunching up).
- `function isDue(item, now = new Date())` → `boolean`. `true` iff `item.status === 'queued'` and `item.scheduledFor` is a valid timestamp `<= now`.

- [ ] **Step 1: Write the failing tests**

Add to `test/postQueue.test.js` (keep everything already in the file — these are additive):

```javascript
import { nextScheduledSlot, isDue } from '../src/postQueue.js';

test('createQueueItem defaults scheduledFor to "now" when omitted', () => {
  const before = Date.now();
  const item = createQueueItem({
    siteName: 's', pageUrl: 'https://example.com/index.html', kind: 'single',
    images: ['/a.png'], caption: 'c',
  });
  const scheduledMs = Date.parse(item.scheduledFor);
  assert.ok(scheduledMs >= before && scheduledMs <= Date.now());
});

test('createQueueItem uses an explicit scheduledFor when given', () => {
  const item = createQueueItem({
    siteName: 's', pageUrl: 'https://example.com/index.html', kind: 'single',
    images: ['/a.png'], caption: 'c', scheduledFor: '2030-01-01T00:00:00.000Z',
  });
  assert.equal(item.scheduledFor, '2030-01-01T00:00:00.000Z');
});

test('nextScheduledSlot returns now when nothing is queued', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const slot = nextScheduledSlot({ items: [] }, 24, now);
  assert.equal(slot, now.toISOString());
});

test('nextScheduledSlot spaces subsequent items by intervalHours after the latest queued item', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const queue = {
    items: [
      { status: 'queued', scheduledFor: '2026-01-01T00:00:00.000Z' },
      { status: 'queued', scheduledFor: '2026-01-02T00:00:00.000Z' }, // latest
      { status: 'posted', scheduledFor: '2026-01-10T00:00:00.000Z' }, // not queued, ignored
    ],
  };
  const slot = nextScheduledSlot(queue, 24, now);
  assert.equal(slot, '2026-01-03T00:00:00.000Z');
});

test('isDue is true for a queued item whose scheduledFor has passed', () => {
  const now = new Date('2026-01-02T00:00:00.000Z');
  assert.equal(isDue({ status: 'queued', scheduledFor: '2026-01-01T00:00:00.000Z' }, now), true);
});

test('isDue is false for a queued item scheduled in the future', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(isDue({ status: 'queued', scheduledFor: '2026-01-02T00:00:00.000Z' }, now), false);
});

test('isDue is false for a non-queued item even if its scheduledFor has passed', () => {
  const now = new Date('2026-01-02T00:00:00.000Z');
  assert.equal(isDue({ status: 'posted', scheduledFor: '2026-01-01T00:00:00.000Z' }, now), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/postQueue.test.js`
Expected: FAIL — `nextScheduledSlot`/`isDue` not exported; the `scheduledFor` default test fails against the current `createQueueItem`.

- [ ] **Step 3: Modify `src/postQueue.js`**

Change `createQueueItem`'s signature and body to:

```javascript
export function createQueueItem({ siteName, pageUrl, kind, images, caption, scheduledFor }) {
  return {
    id: crypto.randomUUID(),
    siteName,
    pageUrl,
    kind,
    images,
    caption,
    status: 'queued',
    createdAt: new Date().toISOString(),
    scheduledFor: scheduledFor ?? new Date().toISOString(),
    postedAt: null,
    igMediaId: null,
    error: null,
  };
}
```

Add these two new exported functions (anywhere after `createQueueItem`):

```javascript
export function nextScheduledSlot(queue, intervalHours, now = new Date()) {
  const pendingTimes = queue.items
    .filter((item) => item.status === 'queued')
    .map((item) => Date.parse(item.scheduledFor))
    .filter((t) => Number.isFinite(t));

  if (pendingTimes.length === 0) {
    return now.toISOString();
  }

  const latest = Math.max(...pendingTimes);
  const intervalMs = intervalHours * 60 * 60 * 1000;
  return new Date(latest + intervalMs).toISOString();
}

export function isDue(item, now = new Date()) {
  if (item.status !== 'queued') return false;
  const scheduledMs = Date.parse(item.scheduledFor);
  return Number.isFinite(scheduledMs) && scheduledMs <= now.getTime();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/postQueue.test.js`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Commit**

```bash
git add src/postQueue.js test/postQueue.test.js
git commit -m "feat: scheduling primitives (scheduledFor, nextScheduledSlot, isDue)"
```

---

### Task 2: Scheduler module

**Files:**
- Create: `src/scheduler.js`
- Test: `test/scheduler.test.js`

**Interfaces:**
- Consumes: `readQueue`, `isDue` from Task 1 (`src/postQueue.js`); `postQueueItem` from `src/postingService.js` (unchanged, Phase 1).
- Produces:
  - `async function runSchedulerTick({ outputRoot, igUserId, accessToken, now = new Date(), postQueueItemFn = postQueueItem })` → does ONE tick's worth of work: reads the queue at `<outputRoot>/post-queue.json`, finds the first item where `isDue(item, now)` is true (in array order — i.e. oldest-added due item first), and if found calls `postQueueItemFn(item.id, { igUserId, accessToken, outputRoot, queueFilePath })` and returns its result; if no item is due, returns `null` without calling `postQueueItemFn` at all.
  - `function startScheduler({ outputRoot, igUserId, accessToken, intervalMs = 15 * 60 * 1000, runTickFn = runSchedulerTick })` → starts a `setInterval` that calls `runTickFn` on each tick (catching and logging any rejection via `console.error`, never letting a tick's failure kill the interval), returns `{ stop: () => void }` to clear it. Calls `.unref()` on the timer if available, so this alone never keeps the Node process alive.

- [ ] **Step 1: Write the failing test**

```javascript
// test/scheduler.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { writeQueue, createQueueItem } from '../src/postQueue.js';
import { runSchedulerTick, startScheduler } from '../src/scheduler.js';

test('runSchedulerTick posts the first due item and leaves others alone', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scheduler-test-'));
  const queueFilePath = path.join(dir, 'post-queue.json');
  const now = new Date('2026-01-05T00:00:00.000Z');

  const due = { ...createQueueItem({ siteName: 's', pageUrl: 'https://example.com/index.html', kind: 'single', images: ['/a.png'], caption: 'c', scheduledFor: '2026-01-01T00:00:00.000Z' }) };
  const notDue = { ...createQueueItem({ siteName: 's', pageUrl: 'https://example.com/index.html', kind: 'single', images: ['/b.png'], caption: 'c', scheduledFor: '2026-01-10T00:00:00.000Z' }) };
  await writeQueue(queueFilePath, { items: [due, notDue] });

  const calls = [];
  const postQueueItemFn = async (itemId, opts) => {
    calls.push({ itemId, opts });
    return { id: itemId, status: 'posted' };
  };

  const result = await runSchedulerTick({ outputRoot: dir, igUserId: 'IGUSER', accessToken: 'TOKEN', now, postQueueItemFn });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].itemId, due.id);
  assert.equal(calls[0].opts.queueFilePath, queueFilePath);
  assert.equal(result.status, 'posted');

  await fs.rm(dir, { recursive: true, force: true });
});

test('runSchedulerTick does nothing and returns null when nothing is due', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scheduler-test-none-'));
  const queueFilePath = path.join(dir, 'post-queue.json');
  const now = new Date('2026-01-01T00:00:00.000Z');
  const notDue = createQueueItem({ siteName: 's', pageUrl: 'https://example.com/index.html', kind: 'single', images: ['/a.png'], caption: 'c', scheduledFor: '2026-01-10T00:00:00.000Z' });
  await writeQueue(queueFilePath, { items: [notDue] });

  let called = false;
  const postQueueItemFn = async () => { called = true; };

  const result = await runSchedulerTick({ outputRoot: dir, igUserId: 'IGUSER', accessToken: 'TOKEN', now, postQueueItemFn });

  assert.equal(called, false);
  assert.equal(result, null);

  await fs.rm(dir, { recursive: true, force: true });
});

test('startScheduler calls runTickFn on the configured interval and stop() clears it', async () => {
  let calls = 0;
  const runTickFn = async () => { calls += 1; };

  const scheduler = startScheduler({ outputRoot: '/tmp/does-not-matter', igUserId: 'U', accessToken: 'T', intervalMs: 20, runTickFn });

  await new Promise((resolve) => setTimeout(resolve, 65));
  scheduler.stop();
  const callsAtStop = calls;
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.ok(callsAtStop >= 2, `expected at least 2 ticks in ~65ms at 20ms interval, got ${callsAtStop}`);
  assert.equal(calls, callsAtStop, 'no further ticks should fire after stop()');
});

test('startScheduler does not throw the process down when a tick rejects', async () => {
  const runTickFn = async () => { throw new Error('boom'); };
  const scheduler = startScheduler({ outputRoot: '/tmp/does-not-matter', igUserId: 'U', accessToken: 'T', intervalMs: 20, runTickFn });
  await new Promise((resolve) => setTimeout(resolve, 50));
  scheduler.stop();
  // If we reach here without the test process crashing, the rejection was handled.
  assert.ok(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scheduler.test.js`
Expected: FAIL — `Cannot find module '../src/scheduler.js'`

- [ ] **Step 3: Write `src/scheduler.js`**

```javascript
// src/scheduler.js
import path from 'node:path';
import { readQueue, isDue } from './postQueue.js';
import { postQueueItem } from './postingService.js';

export async function runSchedulerTick({
  outputRoot,
  igUserId,
  accessToken,
  now = new Date(),
  postQueueItemFn = postQueueItem,
}) {
  const queueFilePath = path.join(outputRoot, 'post-queue.json');
  const queue = await readQueue(queueFilePath);
  const due = queue.items.find((item) => isDue(item, now));
  if (!due) {
    return null;
  }
  return postQueueItemFn(due.id, { igUserId, accessToken, outputRoot, queueFilePath });
}

export function startScheduler({
  outputRoot,
  igUserId,
  accessToken,
  intervalMs = 15 * 60 * 1000,
  runTickFn = runSchedulerTick,
}) {
  const timer = setInterval(() => {
    runTickFn({ outputRoot, igUserId, accessToken }).catch((err) => {
      console.error('[scheduler] tick failed:', err.message);
    });
  }, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/scheduler.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/scheduler.js test/scheduler.test.js
git commit -m "feat: scheduler module (post-one-due-item-per-tick)"
```

---

### Task 3: Auto-post wiring in the run route

**Files:**
- Modify: `src/routes/run.js`
- Test: `test/runAutoPost.test.js`

**Interfaces:**
- Consumes: `generateCaption` from `src/caption.js`; `readQueue`, `writeQueue`, `createQueueItem`, `nextScheduledSlot` from `src/postQueue.js` (Task 1).
- Produces: `POST /run`'s body gains an optional `autoPost` boolean (default `false`, backward compatible — every existing call site/test that doesn't send it is unaffected). When a run with `autoPost: true` finishes successfully, every section with a non-null `composite` across every page in the resulting manifest is automatically queued (kind `'single'`, one composite each — no auto-carousels in Phase 2) with an auto-drafted caption and a `scheduledFor` spaced `SCHEDULE_INTERVAL_HOURS` (env var, default 24) apart via `nextScheduledSlot`. If Instagram isn't configured (`IG_BUSINESS_ACCOUNT_ID`/`IG_ACCESS_TOKEN` unset), nothing is queued and an `auto-post-skipped` progress event is emitted instead — the run itself still succeeds either way (screenshot capture must never fail because Instagram isn't configured).

- [ ] **Step 1: Write the failing test**

```javascript
// test/runAutoPost.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRunRouter } from '../src/routes/run.js';
import { readQueue } from '../src/postQueue.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'site');

async function startTestApp(outputRoot) {
  const app = express();
  app.use(express.json());
  const runs = new Map();
  app.use('/api', createRunRouter({ outputRoot, runs }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

async function waitForRunDone(base, runId) {
  const res = await fetch(`${base}/api/progress/${runId}`);
  const text = await res.text();
  const match = text.match(/data: (\{"type":"manifest-ready".*\})\n\n/);
  return JSON.parse(match[1]).manifest;
}

test('autoPost:true queues every composite with spaced scheduledFor when Instagram is configured', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autopost-test-'));
  const { server, base } = await startTestApp(outputRoot);
  const originalUserId = process.env.IG_BUSINESS_ACCOUNT_ID;
  const originalToken = process.env.IG_ACCESS_TOKEN;
  const originalInterval = process.env.SCHEDULE_INTERVAL_HOURS;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
    if (originalUserId === undefined) delete process.env.IG_BUSINESS_ACCOUNT_ID; else process.env.IG_BUSINESS_ACCOUNT_ID = originalUserId;
    if (originalToken === undefined) delete process.env.IG_ACCESS_TOKEN; else process.env.IG_ACCESS_TOKEN = originalToken;
    if (originalInterval === undefined) delete process.env.SCHEDULE_INTERVAL_HOURS; else process.env.SCHEDULE_INTERVAL_HOURS = originalInterval;
  });

  process.env.IG_BUSINESS_ACCOUNT_ID = 'IGUSER';
  process.env.IG_ACCESS_TOKEN = 'TOKEN';
  process.env.SCHEDULE_INTERVAL_HOURS = '1';

  const runRes = await fetch(`${base}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ localFolder: fixtureDir, mode: 'auto', siteName: 'autopost-fixture', autoPost: true }),
  });
  const { runId } = await runRes.json();
  const manifest = await waitForRunDone(base, runId);

  const totalComposites = manifest.pages.flatMap((p) => p.sections).filter((s) => s.composite).length;
  assert.ok(totalComposites > 0);

  const queue = await readQueue(path.join(outputRoot, 'post-queue.json'));
  assert.equal(queue.items.length, totalComposites);
  assert.ok(queue.items.every((item) => item.status === 'queued'));
  assert.ok(queue.items.every((item) => item.caption && item.caption.length > 0));

  const sortedTimes = queue.items.map((item) => Date.parse(item.scheduledFor)).sort((a, b) => a - b);
  for (let i = 1; i < sortedTimes.length; i++) {
    const gapHours = (sortedTimes[i] - sortedTimes[i - 1]) / (60 * 60 * 1000);
    assert.ok(gapHours >= 1, `expected at least 1h between scheduled items, got ${gapHours}h`);
  }
});

test('autoPost:true with Instagram not configured still succeeds and queues nothing', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autopost-test-noconfig-'));
  const { server, base } = await startTestApp(outputRoot);
  const originalUserId = process.env.IG_BUSINESS_ACCOUNT_ID;
  const originalToken = process.env.IG_ACCESS_TOKEN;
  delete process.env.IG_BUSINESS_ACCOUNT_ID;
  delete process.env.IG_ACCESS_TOKEN;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
    if (originalUserId !== undefined) process.env.IG_BUSINESS_ACCOUNT_ID = originalUserId;
    if (originalToken !== undefined) process.env.IG_ACCESS_TOKEN = originalToken;
  });

  const runRes = await fetch(`${base}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ localFolder: fixtureDir, mode: 'auto', siteName: 'autopost-noconfig', autoPost: true }),
  });
  const { runId } = await runRes.json();
  const manifest = await waitForRunDone(base, runId);
  assert.ok(manifest.pages.length > 0, 'run should still succeed');

  const queue = await readQueue(path.join(outputRoot, 'post-queue.json'));
  assert.equal(queue.items.length, 0);
});

test('autoPost defaults to false — a normal run queues nothing', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autopost-test-default-'));
  const { server, base } = await startTestApp(outputRoot);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const runRes = await fetch(`${base}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ localFolder: fixtureDir, mode: 'auto', siteName: 'autopost-default' }),
  });
  const { runId } = await runRes.json();
  await waitForRunDone(base, runId);

  const queue = await readQueue(path.join(outputRoot, 'post-queue.json'));
  assert.equal(queue.items.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/runAutoPost.test.js`
Expected: FAIL — `autoPost` isn't read from the body yet, nothing gets queued.

- [ ] **Step 3: Modify `src/routes/run.js`**

Add imports at the top (alongside the existing ones):

```javascript
import { generateCaption } from '../caption.js';
import { readQueue, writeQueue, createQueueItem, nextScheduledSlot } from '../postQueue.js';
```

In the `POST /run` handler, destructure `autoPost = false` alongside the existing fields, and pass it through to `executeRun`:

```javascript
  router.post('/run', async (req, res) => {
    const { url, localFolder, mode, selectors = [], siteName, autoPost = false } = req.body || {};
```

(leave every other line of that handler exactly as-is), and update the `executeRun(...)` call to include it:

```javascript
    executeRun({ runId, url, localFolder, mode, selectors, siteName, outputRoot, runs, autoPost }).catch((err) => {
```

Update `executeRun`'s signature and body — add `autoPost` to the destructured parameters, and after the existing `run.manifest = manifest; run.status = 'done';` lines, add the auto-queue call:

```javascript
async function executeRun({ runId, url, localFolder, mode, selectors, siteName, outputRoot, runs, autoPost }) {
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

    if (autoPost) {
      await autoQueueManifest(manifest, { outputRoot, onProgress: (event) => run.events.push(event) });
    }
  } finally {
    if (localServer) await localServer.close();
  }
}

async function autoQueueManifest(manifest, { outputRoot, onProgress }) {
  const igUserId = process.env.IG_BUSINESS_ACCOUNT_ID;
  const accessToken = process.env.IG_ACCESS_TOKEN;
  if (!igUserId || !accessToken) {
    onProgress({
      type: 'auto-post-skipped',
      message: 'Instagram is not configured — set IG_BUSINESS_ACCOUNT_ID and IG_ACCESS_TOKEN in .env to enable auto-posting',
    });
    return;
  }

  const intervalHours = Number(process.env.SCHEDULE_INTERVAL_HOURS) || 24;
  const queueFilePath = path.join(outputRoot, 'post-queue.json');
  const queue = await readQueue(queueFilePath);

  for (const page of manifest.pages) {
    for (const section of page.sections) {
      if (!section.composite) continue;
      const caption = generateCaption({ siteName: manifest.site, pageUrl: page.url, slug: section.slug });
      const scheduledFor = nextScheduledSlot(queue, intervalHours);
      const item = createQueueItem({
        siteName: manifest.site,
        pageUrl: page.url,
        kind: 'single',
        images: [section.composite],
        caption,
        scheduledFor,
      });
      queue.items.push(item);
      onProgress({ type: 'auto-post-queued', message: `Queued ${section.slug} for ${scheduledFor}` });
    }
  }

  await writeQueue(queueFilePath, queue);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/runAutoPost.test.js`
Expected: PASS

Then run the full suite: `npm test` — expect all tests (old + new) to pass.

- [ ] **Step 5: Commit**

```bash
git add src/routes/run.js test/runAutoPost.test.js
git commit -m "feat: autoPost flag auto-queues every section after a run completes"
```

---

### Task 4: Wire the scheduler into the server boot + frontend auto-post controls

**Files:**
- Modify: `src/server.js`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`

**Interfaces:**
- Consumes: `startScheduler` from Task 2 (`src/scheduler.js`).
- Produces: no new backend interfaces — the scheduler starts as a side effect of running `node src/server.js` directly (never inside `createApp()`, so tests are unaffected). Frontend: a checkbox on the run form that sends `autoPost` in the `POST /api/run` body, and the queue panel shows a queued item's `scheduledFor` time when it's in the future.

- [ ] **Step 1: Modify `src/server.js`**

Add the import at the top:

```javascript
import { startScheduler } from './scheduler.js';
```

In the `if (import.meta.url === ...)` block at the bottom of the file, start the scheduler (only if Instagram is configured) right before `app.listen(...)`:

```javascript
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  const port = process.env.PORT || 3000;
  const outputRoot = path.join(__dirname, '..', 'output');
  const igUserId = process.env.IG_BUSINESS_ACCOUNT_ID;
  const accessToken = process.env.IG_ACCESS_TOKEN;
  if (igUserId && accessToken) {
    startScheduler({ outputRoot, igUserId, accessToken });
    console.log('Instagram scheduler started (posts due queue items automatically).');
  }
  app.listen(port, '127.0.0.1', () =>
    console.log(`Screenshot Taker running on http://localhost:${port}`)
  );
}
```

(Keep every other line of `src/server.js` — `createApp`, the router mounts, etc. — exactly as it currently is. Only this bottom block changes.)

- [ ] **Step 2: Add the auto-post checkbox to `public/index.html`**

In the `<form id="run-form">`, right before the closing `</form>` tag (after the existing `selectorsRow` field, before the `<button type="submit" class="shutter" ...>`), add:

```html
      <label class="field field-checkbox">
        <input type="checkbox" id="autoPost" />
        <span>Auto-post every section (spaced out over time, once Instagram is configured)</span>
      </label>
```

- [ ] **Step 3: Wire it into `public/app.js`**

In the form's `submit` event handler, find where `body` is constructed (the object later passed to `JSON.stringify` for the `POST /api/run` call) and add one field:

```javascript
    autoPost: document.getElementById('autoPost').checked,
```

(Add it as a new key in that same `body` object — alongside `siteName`, `mode`, `selectors`, and `url`/`localFolder`.)

In `renderQueue`, for each queue item row, show the scheduled time when the item is still queued and its `scheduledFor` is in the future — find the existing per-item row-building code and add, after the status/label elements are appended:

```javascript
    if (item.status === 'queued') {
      const scheduledMs = Date.parse(item.scheduledFor);
      if (Number.isFinite(scheduledMs) && scheduledMs > Date.now()) {
        const when = document.createElement('span');
        when.className = 'queue-scheduled';
        when.textContent = `posts ${new Date(scheduledMs).toLocaleString()}`;
        row.appendChild(when);
      }
    }
```

- [ ] **Step 4: Add styling to `public/style.css`**

Append:

```css
.field-checkbox {
  flex-direction: row;
  align-items: center;
  gap: 10px;
}

.field-checkbox input[type="checkbox"] {
  width: auto;
  accent-color: var(--safelight);
}

.field-checkbox span {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 400;
  text-transform: none;
  letter-spacing: normal;
  color: var(--ink-dim);
}

.queue-scheduled {
  color: var(--ink-faint);
  font-size: 12px;
}
```

- [ ] **Step 5: Manual verification**

Run: `npm test` — confirm the full suite still passes (this task adds no new automated tests; it's glue + UI).

If you have no browser available in this environment, do a headless smoke check instead: start the server in the background (`PORT=<a free port> node src/server.js &`), `curl -s http://localhost:<port>/` and confirm the response body contains `id="autoPost"`, then `curl -s -X POST http://localhost:<port>/api/run -H "Content-Type: application/json" -d '{"localFolder":"<absolute path to test/fixtures/site>","mode":"auto","siteName":"manual-check","autoPost":true}'`, poll `GET /api/progress/<runId>` until `manifest-ready` appears, and confirm the response includes an `auto-post-skipped` event (since no real `.env` credentials are set in this check) rather than any error — the run itself must still succeed. Kill the background server afterward. Note in your report that this substitutes for a full browser check of the checkbox UI and queue-panel scheduled-time display, which need a real browser.

- [ ] **Step 6: Commit**

```bash
git add src/server.js public/index.html public/app.js public/style.css
git commit -m "feat: wire scheduler into server boot, add auto-post UI controls"
```

---

### Task 5: End-to-end test — autoPost run through a scheduler tick to posted

**Files:**
- Test: `test/instagramScheduling.e2e.test.js`

**Interfaces:**
- Consumes: `createApp` from `src/server.js` (unchanged signature — `postQueueDeps` already exists from Phase 1); `runSchedulerTick` from Task 2; fixture site from the existing test suite.
- Produces: one integration test proving the full Phase 2 loop — a run with `autoPost: true` queues sections with spaced `scheduledFor` times, and a scheduler tick (with time advanced past the first item's `scheduledFor`) posts exactly that one item, using faked tunnel/Instagram calls (no real network).

- [ ] **Step 1: Write the test**

```javascript
// test/instagramScheduling.e2e.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.js';
import { readQueue } from '../src/postQueue.js';
import { runSchedulerTick } from '../src/scheduler.js';
import { postQueueItem } from '../src/postingService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'site');

test('end-to-end: autoPost queues sections, a scheduler tick posts the first due one (faked network)', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ig-schedule-e2e-'));
  const postSingleImageCalls = [];
  const postQueueDeps = {
    startLocalServerFn: async () => ({ url: 'http://127.0.0.1:9999', close: async () => {} }),
    startTunnelFn: async () => ({ url: 'https://fake.loca.lt', close: async () => {} }),
    postSingleImageFn: async (args) => {
      postSingleImageCalls.push(args);
      return `media-${postSingleImageCalls.length}`;
    },
  };
  const app = createApp({ outputRoot, postQueueDeps });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const originalUserId = process.env.IG_BUSINESS_ACCOUNT_ID;
  const originalToken = process.env.IG_ACCESS_TOKEN;
  const originalInterval = process.env.SCHEDULE_INTERVAL_HOURS;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
    if (originalUserId === undefined) delete process.env.IG_BUSINESS_ACCOUNT_ID; else process.env.IG_BUSINESS_ACCOUNT_ID = originalUserId;
    if (originalToken === undefined) delete process.env.IG_ACCESS_TOKEN; else process.env.IG_ACCESS_TOKEN = originalToken;
    if (originalInterval === undefined) delete process.env.SCHEDULE_INTERVAL_HOURS; else process.env.SCHEDULE_INTERVAL_HOURS = originalInterval;
  });

  process.env.IG_BUSINESS_ACCOUNT_ID = 'IGUSER';
  process.env.IG_ACCESS_TOKEN = 'TOKEN';
  process.env.SCHEDULE_INTERVAL_HOURS = '24';

  const runRes = await fetch(`${base}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ localFolder: fixtureDir, mode: 'auto', siteName: 'schedule-e2e-fixture', autoPost: true }),
  });
  const { runId } = await runRes.json();

  const progressRes = await fetch(`${base}/api/progress/${runId}`);
  const text = await progressRes.text();
  assert.match(text, /auto-post-queued/);

  const queueBefore = await readQueue(path.join(outputRoot, 'post-queue.json'));
  assert.ok(queueBefore.items.length >= 2, 'fixture site has multiple sections across pages');
  assert.ok(queueBefore.items.every((item) => item.status === 'queued'));

  const sorted = [...queueBefore.items].sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor));
  const firstItem = sorted[0];
  const secondItem = sorted[1];

  // Advance "now" to just past the first item's schedule, but before the second's.
  const tickTime = new Date(Date.parse(firstItem.scheduledFor) + 1000);
  assert.ok(tickTime.getTime() < Date.parse(secondItem.scheduledFor), 'test fixture assumption: items are spaced far enough apart');

  const tickResult = await runSchedulerTick({
    outputRoot,
    igUserId: 'IGUSER',
    accessToken: 'TOKEN',
    now: tickTime,
    postQueueItemFn: (itemId, opts) => postQueueItem(itemId, { ...opts, ...postQueueDeps }),
  });

  assert.equal(tickResult.status, 'posted');
  assert.equal(tickResult.id, firstItem.id);
  assert.equal(postSingleImageCalls.length, 1);

  const queueAfter = await readQueue(path.join(outputRoot, 'post-queue.json'));
  const postedItem = queueAfter.items.find((i) => i.id === firstItem.id);
  const stillQueuedItem = queueAfter.items.find((i) => i.id === secondItem.id);
  assert.equal(postedItem.status, 'posted');
  assert.equal(stillQueuedItem.status, 'queued', 'the not-yet-due item must be untouched');
});
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS — all test files including `instagramScheduling.e2e.test.js` green.

- [ ] **Step 3: Commit**

```bash
git add test/instagramScheduling.e2e.test.js
git commit -m "test: end-to-end autoPost -> scheduler tick -> posted, faked network"
```

---

## Post-plan manual check

After Task 5 passes, with real Instagram credentials configured (following the README's setup guide from Phase 1), run `npm start`, confirm the server log prints "Instagram scheduler started", run a site with "Auto-post every section" checked, confirm items appear in the Queue panel with future `scheduledFor` times spaced by `SCHEDULE_INTERVAL_HOURS`, and — this is the one thing that can't be automated — wait for (or temporarily set `SCHEDULE_INTERVAL_HOURS=0` and wait ~15 minutes for) a real scheduled post to land on the real Instagram account, confirming the whole automatic loop works end to end against the real API. Log any issues in `Notes/Engineering/Decisions.md`.
