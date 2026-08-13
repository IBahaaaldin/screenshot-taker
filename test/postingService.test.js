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

  const startLocalServerFn = async () => ({ url: 'http://127.0.0.1:9999', close: async () => {} });
  const startTunnelFn = async (port) => {
    assert.equal(port, '9999');
    return { url: 'https://fake.loca.lt', close: async () => {} };
  };
  const postSingleImageFn = async ({ imageUrl, caption }) => {
    assert.equal(
      imageUrl,
      'https://fake.loca.lt/index-html/composites/section-0-composite.png'
    );
    assert.equal(caption, 'hi');
    return 'media-1';
  };

  const result = await postQueueItem(item.id, {
    igUserId: 'IGUSER',
    accessToken: 'TOKEN',
    outputRoot: '/output/baba-ganoush',
    queueFilePath,
    startLocalServerFn,
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

  const startLocalServerFn = async () => ({ url: 'http://127.0.0.1:9999', close: async () => {} });
  const startTunnelFn = async (port) => {
    assert.equal(port, '9999');
    return { url: 'https://fake.loca.lt', close: async () => {} };
  };
  const postCarouselFn = async ({ imageUrls }) => {
    assert.equal(imageUrls.length, 2);
    return 'media-carousel-1';
  };

  const result = await postQueueItem(item.id, {
    igUserId: 'IGUSER',
    accessToken: 'TOKEN',
    outputRoot: '/output/baba-ganoush',
    queueFilePath,
    startLocalServerFn,
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
  const startLocalServerFn = async () => ({ url: 'http://127.0.0.1:9999', close: async () => {} });
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
    queueFilePath,
    startLocalServerFn,
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
    queueFilePath,
    startTunnelFn,
  });

  assert.equal(result.status, 'failed');
  assert.match(result.error, /rate limit/i);
  assert.equal(tunnelStarted, false);

  await fs.rm(dir, { recursive: true, force: true });
});

test('postQueueItem serializes concurrent calls so overlapping writes cannot stomp on each other', async () => {
  const itemA = createQueueItem({
    siteName: 'site-a',
    pageUrl: 'https://example.com/a.html',
    kind: 'single',
    images: ['/output/site-a/a-html/composites/section-0-composite.png'],
    caption: 'a',
  });
  const itemB = createQueueItem({
    siteName: 'site-b',
    pageUrl: 'https://example.com/b.html',
    kind: 'single',
    images: ['/output/site-b/b-html/composites/section-0-composite.png'],
    caption: 'b',
  });
  const { dir, queueFilePath } = await withTempQueue([itemA, itemB]);

  const startLocalServerFn = async () => ({ url: 'http://127.0.0.1:9999', close: async () => {} });
  const startTunnelFn = async () => ({ url: 'https://fake.loca.lt', close: async () => {} });
  const postSingleImageFn = async () => {
    // Artificial delay to force a realistic overlap window between the two
    // concurrent postQueueItem calls (tunnel setup + Graph API polling take
    // real time in production).
    await new Promise((r) => setTimeout(r, 50));
    return 'media-concurrent';
  };

  const [resultA, resultB] = await Promise.all([
    postQueueItem(itemA.id, {
      igUserId: 'IGUSER',
      accessToken: 'TOKEN',
      outputRoot: '/output/site-a',
      queueFilePath,
      startLocalServerFn,
      startTunnelFn,
      postSingleImageFn,
    }),
    postQueueItem(itemB.id, {
      igUserId: 'IGUSER',
      accessToken: 'TOKEN',
      outputRoot: '/output/site-b',
      queueFilePath,
      startLocalServerFn,
      startTunnelFn,
      postSingleImageFn,
    }),
  ]);

  assert.equal(resultA.status, 'posted');
  assert.equal(resultB.status, 'posted');

  const onDisk = await readQueue(queueFilePath);
  const diskA = onDisk.items.find((i) => i.id === itemA.id);
  const diskB = onDisk.items.find((i) => i.id === itemB.id);
  assert.equal(diskA.status, 'posted');
  assert.equal(diskB.status, 'posted');

  await fs.rm(dir, { recursive: true, force: true });
});
