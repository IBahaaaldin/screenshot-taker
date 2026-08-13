import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'site');

test('end-to-end: run the pipeline, then post a resulting composite to Instagram (faked)', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ig-e2e-test-'));
  const postSingleImageCalls = [];
  const postQueueDeps = {
    startTunnelFn: async () => ({ url: 'https://fake.loca.lt', close: async () => {} }),
    postSingleImageFn: async (args) => {
      postSingleImageCalls.push(args);
      return 'media-e2e-1';
    },
  };
  const app = createApp({ outputRoot, postQueueDeps });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const originalUserId = process.env.IG_BUSINESS_ACCOUNT_ID;
  const originalToken = process.env.IG_ACCESS_TOKEN;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
    if (originalUserId === undefined) delete process.env.IG_BUSINESS_ACCOUNT_ID;
    else process.env.IG_BUSINESS_ACCOUNT_ID = originalUserId;
    if (originalToken === undefined) delete process.env.IG_ACCESS_TOKEN;
    else process.env.IG_ACCESS_TOKEN = originalToken;
  });

  process.env.IG_BUSINESS_ACCOUNT_ID = 'IGUSER';
  process.env.IG_ACCESS_TOKEN = 'TOKEN';

  const runRes = await fetch(`${base}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ localFolder: fixtureDir, mode: 'auto', siteName: 'ig-e2e-fixture' }),
  });
  const { runId } = await runRes.json();

  const progressRes = await fetch(`${base}/api/progress/${runId}`);
  const text = await progressRes.text();
  const manifestMatch = text.match(/data: (\{"type":"manifest-ready".*\})\n\n/);
  const { manifest } = JSON.parse(manifestMatch[1]);

  const firstSection = manifest.pages[0].sections[0];
  assert.ok(firstSection.composite);

  const queueRes = await fetch(`${base}/api/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      siteName: manifest.site,
      pageUrl: manifest.pages[0].url,
      kind: 'single',
      images: [firstSection.composite],
      caption: 'end-to-end test caption',
    }),
  });
  assert.equal(queueRes.status, 200);
  const posted = await queueRes.json();
  assert.equal(posted.status, 'posted');
  assert.equal(posted.igMediaId, 'media-e2e-1');

  assert.equal(postSingleImageCalls.length, 1);
  assert.equal(postSingleImageCalls[0].caption, 'end-to-end test caption');
  assert.ok(postSingleImageCalls[0].imageUrl.startsWith('https://fake.loca.lt/output/'));

  const listRes = await fetch(`${base}/api/queue`);
  const { items } = await listRes.json();
  assert.equal(items.length, 1);
  assert.equal(items[0].status, 'posted');
});
