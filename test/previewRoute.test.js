import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalServer } from '../src/localServer.js';
import { createPreviewRouter } from '../src/routes/preview.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'site');

async function withApp(fn) {
  const app = express();
  app.use('/api', createPreviewRouter());
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /api/preview/page proxies and rewrites a real page', async () => {
  const fixtureServer = await startLocalServer(fixtureDir);
  try {
    await withApp(async (base) => {
      const target = `${fixtureServer.url}/index.html`;
      const res = await fetch(`${base}/api/preview/page?url=${encodeURIComponent(target)}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-frame-options'), null);
      assert.equal(res.headers.get('content-security-policy'), null);
      const body = await res.text();
      assert.match(body, /\/api\/preview\/asset\?url=/);
      assert.match(body, /preview-nav/);
    });
  } finally {
    await fixtureServer.close();
  }
});

test('GET /api/preview/page rejects a missing url param', async () => {
  await withApp(async (base) => {
    const res = await fetch(`${base}/api/preview/page`);
    assert.equal(res.status, 400);
  });
});

test('GET /api/preview/page rejects a non-http(s) url', async () => {
  await withApp(async (base) => {
    const res = await fetch(`${base}/api/preview/page?url=${encodeURIComponent('file:///etc/passwd')}`);
    assert.equal(res.status, 400);
  });
});

test('GET /api/preview/asset proxies a CSS file with rewritten url()', async () => {
  const fixtureServer = await startLocalServer(fixtureDir);
  try {
    await withApp(async (base) => {
      const target = `${fixtureServer.url}/about.html`;
      const res = await fetch(`${base}/api/preview/asset?url=${encodeURIComponent(target)}`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') || '', /text\/html/);
    });
  } finally {
    await fixtureServer.close();
  }
});
