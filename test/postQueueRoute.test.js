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
