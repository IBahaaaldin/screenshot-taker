import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCaptionRouter } from '../src/routes/caption.js';

async function startTestApp() {
  const app = express();
  app.use('/api', createCaptionRouter());
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

test('GET /api/caption/draft returns a single-section caption', async (t) => {
  const { server, base } = await startTestApp();
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const res = await fetch(
    `${base}/api/caption/draft?${new URLSearchParams({
      siteName: 'baba-ganoush',
      pageUrl: 'https://example.com/',
      kind: 'single',
      slug: 'hero',
    })}`
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.caption, /Hero/);
  assert.match(body.caption, /Baba Ganoush/);
});

test('GET /api/caption/draft returns a carousel caption mentioning the slide count', async (t) => {
  const { server, base } = await startTestApp();
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const res = await fetch(
    `${base}/api/caption/draft?${new URLSearchParams({
      siteName: 'screenshot-taker',
      pageUrl: 'https://ibahaaaldin.github.io/screenshot-taker/',
      kind: 'carousel',
      slideCount: '6',
    })}`
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.caption, /6 slides/);
});

test('GET /api/caption/draft rejects a missing siteName or pageUrl', async (t) => {
  const { server, base } = await startTestApp();
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const res = await fetch(`${base}/api/caption/draft?${new URLSearchParams({ kind: 'single', slug: 'hero' })}`);
  assert.equal(res.status, 400);
});

test('GET /api/caption/draft rejects a single-kind request missing slug', async (t) => {
  const { server, base } = await startTestApp();
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const res = await fetch(
    `${base}/api/caption/draft?${new URLSearchParams({ siteName: 'a', pageUrl: 'https://example.com/', kind: 'single' })}`
  );
  assert.equal(res.status, 400);
});

test('GET /api/caption/draft rejects a carousel request with an invalid slideCount', async (t) => {
  const { server, base } = await startTestApp();
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const res = await fetch(
    `${base}/api/caption/draft?${new URLSearchParams({
      siteName: 'a',
      pageUrl: 'https://example.com/',
      kind: 'carousel',
      slideCount: '0',
    })}`
  );
  assert.equal(res.status, 400);
});
