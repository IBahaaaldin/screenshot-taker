import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { startLocalServer } from '../src/localServer.js';
import { runPipeline } from '../src/pipeline.js';
import { readManifest } from '../src/manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'site');

test('runPipeline crawls, shoots, composites, and writes a manifest for the fixture site', async () => {
  const server = await startLocalServer(fixtureDir);
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pipeline-test-'));
  const events = [];
  try {
    const manifest = await runPipeline(
      {
        startUrl: `${server.url}/index.html`,
        mode: 'auto',
        selectors: [],
        siteName: 'fixture-site',
        outputRoot,
        maxPages: 10,
      },
      (event) => events.push(event.type)
    );

    assert.equal(manifest.site, 'fixture-site');
    assert.equal(manifest.pages.length, 3);

    const home = manifest.pages.find((p) => p.url.endsWith('/index.html'));
    assert.equal(home.sections.length, 2);
    for (const section of home.sections) {
      assert.ok(section.composite, 'every section should have a composite path');
      const stat = await fs.stat(section.composite);
      assert.ok(stat.size > 0);
    }

    const onDisk = await readManifest(path.join(outputRoot, 'fixture-site'));
    assert.deepEqual(onDisk, manifest);

    assert.ok(events.includes('crawl-start'));
    assert.ok(events.includes('run-done'));
  } finally {
    await server.close();
    await fs.rm(outputRoot, { recursive: true, force: true });
  }
});
