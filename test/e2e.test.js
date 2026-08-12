import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'site');

test('end-to-end: run fixture site through HTTP API, all viewports and composites present', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'e2e-test-'));
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
    body: JSON.stringify({ localFolder: fixtureDir, mode: 'auto', siteName: 'e2e-fixture' }),
  });
  const { runId } = await runRes.json();

  const progressRes = await fetch(`${base}/api/progress/${runId}`);
  const text = await progressRes.text();
  assert.match(text, /manifest-ready/);

  const manifestMatch = text.match(/data: (\{"type":"manifest-ready".*\})\n\n/);
  assert.ok(manifestMatch, 'manifest-ready event should be present');
  const { manifest } = JSON.parse(manifestMatch[1]);

  assert.equal(manifest.pages.length, 3);
  for (const page of manifest.pages) {
    for (const section of page.sections) {
      assert.ok(section.composite);
      const viewportCount = Object.keys(section.viewports).length;
      assert.equal(viewportCount, 4, `${page.url} / ${section.slug} should have all 4 viewports`);
    }
  }

  const zipRes = await fetch(`${base}/api/download/${runId}`);
  assert.equal(zipRes.status, 200);
  const buf = Buffer.from(await zipRes.arrayBuffer());
  assert.ok(buf.length > 0);
  assert.equal(buf.slice(0, 2).toString(), 'PK');
});
