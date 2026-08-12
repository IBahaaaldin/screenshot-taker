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
