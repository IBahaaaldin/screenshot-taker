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
