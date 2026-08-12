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
    server.close();
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
