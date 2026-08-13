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
