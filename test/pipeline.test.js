import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { startLocalServer } from '../src/localServer.js';
import { runPipeline, buildCompositesForPage } from '../src/pipeline.js';
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
    for (const section of home.sections) {
      assert.ok(section.splitCrop, 'every section with a composite should have a splitCrop');
      const leftStat = await fs.stat(section.splitCrop.left);
      const rightStat = await fs.stat(section.splitCrop.right);
      assert.ok(leftStat.size > 0);
      assert.ok(rightStat.size > 0);
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

test('runPipeline clears stale output from a previous run of the same siteName', async () => {
  const server = await startLocalServer(fixtureDir);
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pipeline-rerun-test-'));
  try {
    await runPipeline(
      {
        startUrl: `${server.url}/index.html`,
        mode: 'auto',
        selectors: [],
        siteName: 'fixture-site',
        outputRoot,
        maxPages: 10,
      },
      () => {}
    );

    const siteOutputDir = path.join(outputRoot, 'fixture-site');
    const strayFile = path.join(siteOutputDir, 'stray-leftover.txt');
    await fs.writeFile(strayFile, 'leftover from a previous run');
    assert.ok(await fileExists(strayFile));

    await runPipeline(
      {
        startUrl: `${server.url}/index.html`,
        mode: 'auto',
        selectors: [],
        siteName: 'fixture-site',
        outputRoot,
        maxPages: 10,
      },
      () => {}
    );

    assert.equal(await fileExists(strayFile), false, 'stray file from prior run should be gone');
  } finally {
    await server.close();
    await fs.rm(outputRoot, { recursive: true, force: true });
  }
});

test('runPipeline refuses to operate outside outputRoot even if siteName escapes it', async () => {
  // This calls runPipeline directly, bypassing the route-level siteName
  // validation in src/routes/run.js, to prove the pipeline's own containment
  // check is what actually stops the deletion -- not just the route guard.
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'pipeline-containment-'));
  const outputRoot = path.join(parent, 'output-root');
  await fs.mkdir(outputRoot, { recursive: true });

  // A sentinel file sitting next to outputRoot (i.e. in outputRoot's parent),
  // which is exactly where siteName: '../escape' would resolve to.
  const sentinel = path.join(parent, 'escape');
  await fs.mkdir(sentinel, { recursive: true });
  const sentinelFile = path.join(sentinel, 'must-survive.txt');
  await fs.writeFile(sentinelFile, 'must survive');

  try {
    await assert.rejects(
      () =>
        runPipeline(
          {
            startUrl: 'http://127.0.0.1:1/index.html', // never reached; rm happens first
            mode: 'auto',
            selectors: [],
            siteName: '../escape',
            outputRoot,
            maxPages: 10,
          },
          () => {}
        ),
      /outside outputRoot|outputRoot/i
    );

    // The sentinel directory/file must still exist -- the pipeline must not
    // have deleted anything outside outputRoot.
    assert.ok(await fileExists(sentinelFile), 'sentinel outside outputRoot must survive');
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

async function fileExists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

test('runPipeline captures a page whose scripts throw on document.documentElement access', async () => {
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

    // crash.html makes `document.documentElement` throw on access. The old
    // capture implementation probed document.documentElement.scrollHeight
    // outside any try/catch, so this used to propagate out of runPipeline
    // and abort the whole run. Capture no longer touches documentElement
    // in the main path (locator screenshots handle scrolling themselves),
    // and the one remaining best-effort touch (the scroll-reveal trigger)
    // catches its own errors — so this page now succeeds like any other.
    // The per-page try/catch in runPipeline stays in place as defense in
    // depth against failures this fixture can no longer trigger (e.g. a
    // filesystem error while writing a page's output).
    assert.equal(manifest.site, 'failure-site');
    assert.equal(manifest.pages.length, 3, 'all three pages should succeed');

    const urls = manifest.pages.map((p) => p.url);
    assert.ok(urls.some((u) => u.endsWith('/index.html')));
    assert.ok(urls.some((u) => u.endsWith('/good.html')));
    assert.ok(urls.some((u) => u.endsWith('/crash.html')));

    for (const page of manifest.pages) {
      assert.ok(page.sections.length > 0, `${page.url} should have captured at least one section`);
      for (const section of page.sections) {
        assert.ok(section.composite, `${page.url} / ${section.slug} should have a composite`);
        const stat = await fs.stat(section.composite);
        assert.ok(stat.size > 0);
      }
    }

    const types = events.map((e) => e.type);
    assert.ok(types.includes('run-done'));
    assert.ok(!types.includes('page-error'), 'no page should have failed');

    const onDisk = await readManifest(path.join(outputRoot, 'failure-site'));
    assert.deepEqual(onDisk, manifest);
  } finally {
    await server.close();
    await fs.rm(outputRoot, { recursive: true, force: true });
  }
});

// NOTE: the task brief for this change called for a `runPipeline`-level test
// against `failureFixtureDir` asserting a section with `composite === null`
// (mirroring an existing test using that fixture for "sections that fail
// every viewport"). That premise doesn't hold against the current codebase:
// no such existing test/assertion was found in this file, and running the
// pipeline against `failureFixtureDir` directly (verified empirically) shows
// every section it produces has a non-null composite. This is also true by
// construction: in `buildCompositesForPage`, a slug only ever enters the
// section set if it's present in `viewportResults`, and the very same
// `viewportResults` array is then used to look up that slug's per-viewport
// images -- so `imagesByViewport` can never come back empty for a slug that
// made it into the set. `composite`/`splitCrop` staying null is therefore
// purely defensive code, unreachable through any real fixture today. The
// test below exercises that defensive branch directly against
// `buildCompositesForPage`, rather than asserting a manifest shape the
// pipeline cannot currently produce.
test('buildCompositesForPage sets composite and splitCrop to null when a section has no matching viewport image', async () => {
  // A getter that returns a populated sections array on its first read (when
  // buildCompositesForPage collects the slug set) and an empty array on its
  // second read (when it looks up per-viewport images for that slug),
  // simulating the only input shape that can actually trigger the null
  // branch, since a single static viewportResults array cannot.
  let reads = 0;
  const ghostEntry = {
    viewport: 'desktop',
    get sections() {
      reads += 1;
      return reads === 1 ? [{ slug: 'ghost-section', path: '/tmp/ghost-section.png' }] : [];
    },
  };

  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pipeline-nullcomposite-test-'));
  try {
    const sections = await buildCompositesForPage(null, outputDir, [ghostEntry], () => {});
    assert.equal(sections.length, 1);
    assert.equal(sections[0].slug, 'ghost-section');
    assert.deepEqual(sections[0].viewports, {});
    assert.equal(sections[0].composite, null);
    assert.equal(sections[0].splitCrop, null);
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});
