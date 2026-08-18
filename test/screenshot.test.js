import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { startLocalServer } from '../src/localServer.js';
import { captureAllViewports } from '../src/screenshot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'site');

test('captureAllViewports writes a PNG per section per viewport', async () => {
  const server = await startLocalServer(fixtureDir);
  const browser = await chromium.launch();
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shot-test-'));
  try {
    const result = await captureAllViewports(browser, `${server.url}/index.html`, {
      mode: 'auto',
      selectors: [],
      outputDir,
    });

    assert.equal(result.length, 4);
    const desktop = result.find((r) => r.viewport === 'desktop');
    assert.equal(desktop.sections.length, 2);

    for (const { viewport, sections } of result) {
      for (const { slug, path: filePath } of sections) {
        assert.equal(filePath, path.join(outputDir, viewport, `${slug}.png`));
        const stat = await fs.stat(filePath);
        assert.ok(stat.size > 0, `${filePath} should be non-empty`);
      }
    }
  } finally {
    await browser.close();
    await server.close();
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});

test('a page that breaks section detection at one viewport no longer desyncs the others', async () => {
  const server = await startLocalServer(fixtureDir);
  const browser = await chromium.launch();
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shot-test-flaky-'));
  try {
    // flaky.html sabotages getBoundingClientRect, but only at the tablet
    // viewport width (768px) — see the fixture. Detection used to run once per
    // viewport, so tablet alone would throw and come back with zero sections
    // while the other three captured two each: the same page yielding
    // different sections per device.
    //
    // Detection now runs once, at the widest viewport, and the resulting
    // selectors are reused everywhere — so a page that misbehaves at one
    // specific width can no longer produce that split.
    const result = await captureAllViewports(browser, `${server.url}/flaky.html`, {
      mode: 'auto',
      selectors: [],
      outputDir,
    });

    assert.equal(result.length, 4, 'all four viewports should still produce a result');

    const counts = result.map((r) => `${r.viewport}=${r.sections.length}`);
    assert.equal(
      new Set(result.map((r) => r.sections.length)).size,
      1,
      `every viewport should capture the same sections, got ${counts.join(' ')}`
    );

    for (const entry of result) {
      assert.ok(entry.sections.length > 0, `${entry.viewport} should capture sections`);
      for (const { path: filePath } of entry.sections) {
        const stat = await fs.stat(filePath);
        assert.ok(stat.size > 0, `${filePath} should be non-empty`);
      }
    }
  } finally {
    await browser.close();
    await server.close();
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});

test('a screenshot taken mid fade-in transition is retried and captures the settled content', async () => {
  const server = await startLocalServer(fixtureDir);
  const browser = await chromium.launch();
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shot-test-blank-'));
  try {
    // blank-transition.html's hero content fades in ~700ms after load, so
    // an immediate screenshot lands on the near-solid background color —
    // captureAllViewports should detect that and retry once, landing on
    // the settled (visibly varied) content instead.
    const result = await captureAllViewports(browser, `${server.url}/blank-transition.html`, {
      mode: 'full-page',
      selectors: [],
      outputDir,
    });

    const desktop = result.find((r) => r.viewport === 'desktop');
    assert.equal(desktop.sections.length, 1);
    const { channels } = await sharp(desktop.sections[0].path).stats();
    assert.ok(
      channels.some((channel) => channel.stdev >= 4),
      'retried screenshot should show visible pixel variance from the settled content, not a flat color'
    );
  } finally {
    await browser.close();
    await server.close();
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});

test('a hidden selector match fails fast instead of waiting out the default actionability timeout', async () => {
  const server = await startLocalServer(fixtureDir);
  const browser = await chromium.launch();
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shot-test-hidden-'));
  try {
    const start = Date.now();
    const result = await captureAllViewports(browser, `${server.url}/hidden-selector.html`, {
      mode: 'selectors',
      selectors: ['#visible', '#hidden'],
      outputDir,
    });
    const elapsedMs = Date.now() - start;

    // 4 viewports each waiting out the hidden element: ~5s timeout each
    // lands around 20-25s total; Playwright's default ~30s timeout would
    // land past 120s. The bound below is comfortably below the default-
    // timeout scenario while tolerant of slower machines.
    assert.ok(elapsedMs < 60000, `expected the short per-section timeout to apply, took ${elapsedMs}ms`);

    const desktop = result.find((r) => r.viewport === 'desktop');
    assert.deepEqual(
      desktop.sections.map((s) => s.slug),
      ['visible'],
      'only the visible section should be captured; the hidden one should be dropped, not hang'
    );
  } finally {
    await browser.close();
    await server.close();
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});

// Section detection used to run once per viewport, so "section-N" was only the
// same part of the page on all four devices by coincidence. This fixture has a
// block that is tall enough to count as a section on desktop but collapses
// below the threshold on mobile — under per-viewport detection mobile would
// find one fewer section and every later index would refer to different
// content there, producing a composite showing four different sections with
// nothing to flag it.
test('every viewport captures the same sections even when a block collapses at a breakpoint', async (t) => {
  const server = await startLocalServer(fixtureDir);
  const browser = await chromium.launch();
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'section-align-'));
  t.after(async () => {
    await browser.close();
    await server.close();
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  const results = await captureAllViewports(browser, `${server.url}/breakpoint-shift.html`, {
    mode: 'auto',
    outputDir,
  });

  const counts = results.map((r) => `${r.viewport}=${r.sections.length}`);
  const unique = new Set(results.map((r) => r.sections.length));
  assert.equal(unique.size, 1, `all viewports must capture the same section count, got ${counts.join(' ')}`);

  const slugsPerViewport = results.map((r) => r.sections.map((s) => s.slug).join(','));
  assert.equal(
    new Set(slugsPerViewport).size,
    1,
    `all viewports must capture the same section slugs, got ${slugsPerViewport.join(' | ')}`
  );
});
