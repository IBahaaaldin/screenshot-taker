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
