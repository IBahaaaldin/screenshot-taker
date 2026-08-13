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
