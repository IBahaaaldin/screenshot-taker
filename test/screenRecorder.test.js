import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { startLocalServer } from '../src/localServer.js';
import { createPreviewRouter } from '../src/routes/preview.js';
import { recordSitePreview } from '../src/screenRecorder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'site');

test('recordSitePreview produces a nonzero-size MP4 with a valid ftyp header', async (t) => {
  const fixtureServer = await startLocalServer(fixtureDir);
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'screenshot-taker-test-'));

  // A minimal app serving preview.html/preview.js/style.css plus the
  // preview proxy routes, so recordSitePreview has a real page to visit.
  const app = express();
  app.use('/api', createPreviewRouter({ outputRoot }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const previewBaseUrl = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await fixtureServer.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const recordDir = await fs.mkdtemp(path.join(os.tmpdir(), 'screenshot-taker-record-'));
  t.after(() => fs.rm(recordDir, { recursive: true, force: true }));

  const { mp4Path, durationMs } = await recordSitePreview({
    url: `${fixtureServer.url}/index.html`,
    previewBaseUrl,
    outputDir: recordDir,
  });

  assert.ok(durationMs >= 4000, 'duration floors at 4000ms for a short fixture page');

  const stat = await fs.stat(mp4Path);
  assert.ok(stat.size > 0, 'mp4 file has nonzero size');

  const fd = await fs.open(mp4Path, 'r');
  const buffer = Buffer.alloc(12);
  await fd.read(buffer, 0, 12, 0);
  await fd.close();
  // MP4 files carry an 'ftyp' box; its 4-byte type tag sits at offset 4.
  assert.equal(buffer.toString('ascii', 4, 8), 'ftyp', 'output starts with a valid MP4 ftyp box');
});
