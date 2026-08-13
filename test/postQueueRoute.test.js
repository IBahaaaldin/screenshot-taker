import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createPostQueueRouter } from '../src/routes/postQueue.js';
import { readQueue, writeQueue, createQueueItem } from '../src/postQueue.js';
import { postQueueItem } from '../src/postingService.js';

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

  const originalUserId = process.env.IG_BUSINESS_ACCOUNT_ID;
  const originalToken = process.env.IG_ACCESS_TOKEN;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
    if (originalUserId !== undefined) process.env.IG_BUSINESS_ACCOUNT_ID = originalUserId;
    if (originalToken !== undefined) process.env.IG_ACCESS_TOKEN = originalToken;
  });

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
});

test('POST /api/queue then GET /api/queue reflects a posted item, using injected fakes', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-route-test-'));
  const deps = {
    startLocalServerFn: async () => ({ url: 'http://127.0.0.1:9999', close: async () => {} }),
    startTunnelFn: async () => ({ url: 'https://fake.loca.lt', close: async () => {} }),
    postSingleImageFn: async () => 'media-1',
  };
  const { server, base } = await startTestApp(outputRoot, deps);

  const originalUserId = process.env.IG_BUSINESS_ACCOUNT_ID;
  const originalToken = process.env.IG_ACCESS_TOKEN;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
    if (originalUserId !== undefined) process.env.IG_BUSINESS_ACCOUNT_ID = originalUserId;
    else delete process.env.IG_BUSINESS_ACCOUNT_ID;
    if (originalToken !== undefined) process.env.IG_ACCESS_TOKEN = originalToken;
    else delete process.env.IG_ACCESS_TOKEN;
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

test('GET /api/queue returns a clean 500 when the queue file on disk is corrupted', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-route-test-'));
  const { server, base } = await startTestApp(outputRoot, {});
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const queueFilePath = path.join(outputRoot, 'post-queue.json');
  await fs.writeFile(queueFilePath, '{ this is not valid json', 'utf8');

  const res = await fetch(`${base}/api/queue`);
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.match(body.error, /internal error/i);
});

test('POST /api/queue rejects carousel posts with more than 10 images', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-route-test-'));
  const { server, base } = await startTestApp(outputRoot, {});

  const originalUserId = process.env.IG_BUSINESS_ACCOUNT_ID;
  const originalToken = process.env.IG_ACCESS_TOKEN;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
    if (originalUserId !== undefined) process.env.IG_BUSINESS_ACCOUNT_ID = originalUserId;
    else delete process.env.IG_BUSINESS_ACCOUNT_ID;
    if (originalToken !== undefined) process.env.IG_ACCESS_TOKEN = originalToken;
    else delete process.env.IG_ACCESS_TOKEN;
  });

  process.env.IG_BUSINESS_ACCOUNT_ID = 'IGUSER';
  process.env.IG_ACCESS_TOKEN = 'TOKEN';

  const images = Array.from({ length: 11 }, (_, i) => `/x/section-${i}.png`);
  const res = await fetch(`${base}/api/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      siteName: 'baba-ganoush',
      pageUrl: 'https://example.com/index.html',
      kind: 'carousel',
      images,
      caption: 'hi',
    }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /at most 10/i);
});

test('POST /api/queue append does not get lost while another postQueueItem call is mid-flight (Residual A)', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-route-test-'));
  const queueFilePath = path.join(outputRoot, 'post-queue.json');

  // Pre-seed the queue with an item A whose post will be artificially slow —
  // long enough to still be mid-flight (holding the lock, about to do its
  // finally-block write) when the route's own append for item B happens.
  const itemA = createQueueItem({
    siteName: 'site-a',
    pageUrl: 'https://example.com/a.html',
    kind: 'single',
    images: ['/output/site-a/a-html/composites/section-0-composite.png'],
    caption: 'a',
  });
  await writeQueue(queueFilePath, { items: [itemA] });

  const deps = {
    startLocalServerFn: async () => ({ url: 'http://127.0.0.1:9999', close: async () => {} }),
    startTunnelFn: async () => ({ url: 'https://fake.loca.lt', close: async () => {} }),
    postSingleImageFn: async () => 'media-b',
  };
  const { server, base } = await startTestApp(outputRoot, deps);

  const originalUserId = process.env.IG_BUSINESS_ACCOUNT_ID;
  const originalToken = process.env.IG_ACCESS_TOKEN;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
    if (originalUserId !== undefined) process.env.IG_BUSINESS_ACCOUNT_ID = originalUserId;
    else delete process.env.IG_BUSINESS_ACCOUNT_ID;
    if (originalToken !== undefined) process.env.IG_ACCESS_TOKEN = originalToken;
    else delete process.env.IG_ACCESS_TOKEN;
  });
  process.env.IG_BUSINESS_ACCOUNT_ID = 'IGUSER';
  process.env.IG_ACCESS_TOKEN = 'TOKEN';

  // Start item A's post directly through the real postQueueItem, using the
  // real queue file, with an artificial delay so it's still mid-flight
  // (holding the shared lock) when the route's append for item B fires.
  const postA = postQueueItem(itemA.id, {
    igUserId: 'IGUSER',
    accessToken: 'TOKEN',
    outputRoot,
    queueFilePath,
    startLocalServerFn: async () => ({ url: 'http://127.0.0.1:9998', close: async () => {} }),
    startTunnelFn: async () => ({ url: 'https://fake.loca.lt', close: async () => {} }),
    postSingleImageFn: async () => {
      await new Promise((r) => setTimeout(r, 100));
      return 'media-a';
    },
  });

  // Give postA a moment to acquire the lock and start its slow post before
  // firing the route's append-and-post for item B.
  await new Promise((r) => setTimeout(r, 10));

  const postBRes = await fetch(`${base}/api/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      siteName: 'site-b',
      pageUrl: 'https://example.com/b.html',
      kind: 'single',
      images: [path.join(outputRoot, 'site-b/b-html/composites/section-0-composite.png')],
      caption: 'b',
    }),
  });

  const [resultA, postedB] = await Promise.all([postA, postBRes.json()]);

  assert.equal(postBRes.status, 200);
  assert.equal(resultA.status, 'posted');
  assert.equal(resultA.igMediaId, 'media-a');
  assert.equal(postedB.status, 'posted');
  assert.equal(postedB.igMediaId, 'media-b');

  const onDisk = await readQueue(queueFilePath);
  assert.equal(onDisk.items.length, 2, 'both item A and the appended item B must survive on disk');
  const diskA = onDisk.items.find((i) => i.id === itemA.id);
  const diskB = onDisk.items.find((i) => i.id === postedB.id);
  assert.ok(diskA, 'item A must not have been lost');
  assert.ok(diskB, 'item B (appended while A was mid-flight) must not have been lost');
  assert.equal(diskA.status, 'posted');
  assert.equal(diskB.status, 'posted');
});
