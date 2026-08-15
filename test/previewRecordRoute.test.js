import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { startLocalServer } from '../src/localServer.js';
import { createPreviewRouter } from '../src/routes/preview.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'site');

test('POST /api/preview/record records a video and serves it from /output', async (t) => {
  const fixtureServer = await startLocalServer(fixtureDir);
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'screenshot-taker-test-'));

  const app = express();
  app.use(express.json());
  app.use('/api', createPreviewRouter({ outputRoot }));
  app.use('/output', express.static(outputRoot));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await fixtureServer.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const res = await fetch(`${base}/api/preview/record`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `${fixtureServer.url}/index.html` }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.downloadUrl, /^\/output\/recordings\/[a-f0-9-]+\.mp4$/);
  assert.ok(body.durationMs >= 4000);

  const videoRes = await fetch(`${base}${body.downloadUrl}`);
  assert.equal(videoRes.status, 200);
  assert.match(videoRes.headers.get('content-type') || '', /video\/mp4/);
});

test('POST /api/preview/record rejects a missing url', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'screenshot-taker-test-'));
  const app = express();
  app.use(express.json());
  app.use('/api', createPreviewRouter({ outputRoot }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const res = await fetch(`${base}/api/preview/record`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});
