import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readQueue, writeQueue, createQueueItem, countPostsInLast24h, nextScheduledSlot, isDue } from '../src/postQueue.js';

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

test('writeQueue leaves no stray temp files behind after a successful write', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'post-queue-test-'));
  const queueFilePath = path.join(dir, 'post-queue.json');
  const queue = { items: [{ id: 'abc', status: 'queued' }] };

  await writeQueue(queueFilePath, queue);

  const entries = await fs.readdir(dir);
  assert.deepEqual(entries, ['post-queue.json']);

  await fs.rm(dir, { recursive: true, force: true });
});

test('writeQueue handles concurrent writes to the same path without collisions', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'post-queue-test-'));
  const queueFilePath = path.join(dir, 'post-queue.json');

  const writes = Array.from({ length: 8 }, (_, i) =>
    writeQueue(queueFilePath, { items: [{ id: `item-${i}`, status: 'queued' }] })
  );
  const results = await Promise.allSettled(writes);

  for (const result of results) {
    assert.equal(result.status, 'fulfilled');
  }

  const readBack = await readQueue(queueFilePath);
  assert.ok(Array.isArray(readBack.items));

  const entries = await fs.readdir(dir);
  assert.deepEqual(entries, ['post-queue.json']);
  assert.ok(!entries.some((entry) => entry.includes('.tmp-')));

  await fs.rm(dir, { recursive: true, force: true });
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
