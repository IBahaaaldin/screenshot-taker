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
const failureFixtureDir = path.join(__dirname, 'fixtures', 'site-with-failure');

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

test('runPipeline contains a single page failure and still writes a manifest for the surviving pages', async () => {
  const server = await startLocalServer(failureFixtureDir);
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pipeline-failure-test-'));
  const events = [];
  try {
    const manifest = await runPipeline(
      {
        startUrl: `${server.url}/index.html`,
        mode: 'auto',
        selectors: [],
        siteName: 'failure-site',
        outputRoot,
        maxPages: 10,
      },
      (event) => events.push(event)
    );

    // crash.html throws while probing scroll height for every viewport, which
    // used to propagate out of runPipeline entirely and abort the whole run.
    assert.equal(manifest.site, 'failure-site');
    assert.equal(manifest.pages.length, 2, 'only the two healthy pages should make it into the manifest');

    const urls = manifest.pages.map((p) => p.url);
    assert.ok(urls.some((u) => u.endsWith('/index.html')));
    assert.ok(urls.some((u) => u.endsWith('/good.html')));
    assert.ok(!urls.some((u) => u.endsWith('/crash.html')), 'the failed page should be omitted, not crash the run');

    const good = manifest.pages.find((p) => p.url.endsWith('/good.html'));
    assert.equal(good.sections.length, 1);
    assert.ok(good.sections[0].composite);
    const stat = await fs.stat(good.sections[0].composite);
    assert.ok(stat.size > 0);

    // The run must still resolve normally and reach run-done, plus surface a
    // page-error event for the page that failed.
    const types = events.map((e) => e.type);
    assert.ok(types.includes('run-done'));
    assert.ok(types.includes('page-error'), 'a page-error event should be emitted for the crashed page');
    const errorEvent = events.find((e) => e.type === 'page-error');
    assert.ok(errorEvent.message.includes('crash.html'));

    const onDisk = await readManifest(path.join(outputRoot, 'failure-site'));
    assert.deepEqual(onDisk, manifest);
  } finally {
    await server.close();
    await fs.rm(outputRoot, { recursive: true, force: true });
  }
});
