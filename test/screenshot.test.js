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
