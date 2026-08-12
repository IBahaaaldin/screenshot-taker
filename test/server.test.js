import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'site');

test('POST /api/run then GET /api/progress/:runId streams to run-done, manifest available', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'server-test-'));
  const app = createApp({ outputRoot });
  const server = app.listen(0);
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const runRes = await fetch(`${base}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ localFolder: fixtureDir, mode: 'auto', siteName: 'fixture-site' }),
  });
  assert.equal(runRes.status, 200);
  const { runId } = await runRes.json();
  assert.ok(runId);

  const progressRes = await fetch(`${base}/api/progress/${runId}`);
  assert.equal(progressRes.status, 200);
  const text = await progressRes.text();
  assert.match(text, /run-done/);
  assert.match(text, /manifest-ready/);

  const downloadRes = await fetch(`${base}/api/download/${runId}`);
  assert.equal(downloadRes.status, 200);
  assert.equal(downloadRes.headers.get('content-type'), 'application/zip');
});

test('GET /api/download/:runId on an in-progress run returns 409, not a crash', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'server-test-'));
  const app = createApp({ outputRoot });
  const server = app.listen(0);
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const runRes = await fetch(`${base}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ localFolder: fixtureDir, mode: 'auto', siteName: 'fixture-site' }),
  });
  assert.equal(runRes.status, 200);
  const { runId } = await runRes.json();
  assert.ok(runId);

  // Hit download immediately, before the run has finished.
  const downloadRes = await fetch(`${base}/api/download/${runId}`);
  assert.equal(downloadRes.status, 409);
  const body = await downloadRes.json();
  assert.match(body.error, /not.*finish/i);

  // Server process must still be alive and responsive after the guarded failure.
  const progressRes = await fetch(`${base}/api/progress/${runId}`);
  assert.equal(progressRes.status, 200);
  const text = await progressRes.text();
  assert.match(text, /run-done/);
});

test('POST /api/run rejects a siteName containing path traversal', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'server-test-'));
  const app = createApp({ outputRoot });
  const server = app.listen(0);
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const runRes = await fetch(`${base}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      localFolder: fixtureDir,
      mode: 'auto',
      siteName: '../../../../etc/evil',
    }),
  });
  assert.equal(runRes.status, 400);
  const body = await runRes.json();
  assert.match(body.error, /siteName/i);
});

test('POST /api/run rejects siteName ".." (would delete outputRoot\'s parent)', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'server-test-'));
  const app = createApp({ outputRoot });
  const server = app.listen(0);
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  // Sentinel file placed in outputRoot's parent directory, one level above
  // outputRoot. If siteName: '..' were allowed through, runPipeline would
  // resolve siteOutputDir to outputRoot's parent and recursively delete it,
  // wiping this sentinel out.
  const parentDir = path.dirname(outputRoot);
  const sentinel = path.join(parentDir, `sentinel-${path.basename(outputRoot)}.txt`);
  await fs.writeFile(sentinel, 'must survive');

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
    await fs.rm(sentinel, { force: true });
  });

  const runRes = await fetch(`${base}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      localFolder: fixtureDir,
      mode: 'auto',
      siteName: '..',
    }),
  });
  assert.equal(runRes.status, 400);
  const body = await runRes.json();
  assert.match(body.error, /siteName/i);

  // Give any (incorrectly) fired background run a moment to do damage, then
  // confirm the sentinel and outputRoot are untouched.
  await new Promise((resolve) => setTimeout(resolve, 200));
  const sentinelContent = await fs.readFile(sentinel, 'utf8');
  assert.equal(sentinelContent, 'must survive');
  const outputRootStat = await fs.stat(outputRoot);
  assert.ok(outputRootStat.isDirectory());
});

test('POST /api/run rejects siteName "." (would wipe outputRoot)', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'server-test-'));
  const marker = path.join(outputRoot, 'preexisting-site-marker.txt');
  await fs.writeFile(marker, 'must survive');

  const app = createApp({ outputRoot });
  const server = app.listen(0);
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const runRes = await fetch(`${base}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      localFolder: fixtureDir,
      mode: 'auto',
      siteName: '.',
    }),
  });
  assert.equal(runRes.status, 400);
  const body = await runRes.json();
  assert.match(body.error, /siteName/i);

  await new Promise((resolve) => setTimeout(resolve, 200));
  const markerContent = await fs.readFile(marker, 'utf8');
  assert.equal(markerContent, 'must survive');
});

test('POST /api/run rejects an invalid mode value', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'server-test-'));
  const app = createApp({ outputRoot });
  const server = app.listen(0);
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const runRes = await fetch(`${base}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      localFolder: fixtureDir,
      mode: 'delete-everything',
      siteName: 'fixture-site',
    }),
  });
  assert.equal(runRes.status, 400);
  const body = await runRes.json();
  assert.match(body.error, /mode/i);
});

test('a failed run terminates the SSE stream with a terminal event instead of hanging', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'server-test-'));
  const app = createApp({ outputRoot });
  const server = app.listen(0);
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const runRes = await fetch(`${base}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      localFolder: path.join(fixtureDir, 'does-not-exist'),
      mode: 'auto',
      siteName: 'broken-run',
    }),
  });
  assert.equal(runRes.status, 200);
  const { runId } = await runRes.json();
  assert.ok(runId);

  // The fetch (and .text()) must resolve on its own once the run fails --
  // it must not hang waiting for a reconnect-worthy stream close.
  const progressRes = await fetch(`${base}/api/progress/${runId}`);
  assert.equal(progressRes.status, 200);
  const text = await progressRes.text();
  assert.match(text, /manifest-ready/);
  assert.match(text, /"manifest":null/);
});
