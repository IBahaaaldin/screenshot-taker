import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
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

test('captureAllViewports does not abort the whole run when one viewport fails during section detection', async () => {
  const server = await startLocalServer(fixtureDir);
  const browser = await chromium.launch();
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shot-test-flaky-'));
  try {
    // flaky.html throws inside detectSections' page.evaluate call, but only
    // at the tablet viewport width (768px) — see the fixture for details.
    const result = await captureAllViewports(browser, `${server.url}/flaky.html`, {
      mode: 'auto',
      selectors: [],
      outputDir,
    });

    // All four viewports still produce a result — the run was not aborted.
    assert.equal(result.length, 4);

    const tablet = result.find((r) => r.viewport === 'tablet');
    assert.ok(tablet, 'tablet result should be present');
    assert.deepEqual(tablet.sections, [], 'failing viewport should return no sections, not throw');

    for (const viewport of ['desktop', 'laptop', 'mobile']) {
      const entry = result.find((r) => r.viewport === viewport);
      assert.ok(entry.sections.length > 0, `${viewport} should still capture sections`);
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
