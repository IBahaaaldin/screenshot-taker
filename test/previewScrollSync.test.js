import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createApp } from '../src/server.js';
import { startLocalServer } from '../src/localServer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'site');

const DEVICES = ['desktop', 'laptop', 'tablet', 'mobile'];

test('scrolling one device frame in the live preview scrolls all four in sync', async (t) => {
  const outputRoot = await fs.mkdtemp(os.tmpdir() + '/preview-scroll-test-');
  const app = createApp({ outputRoot });
  const server = app.listen(0);
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const fixtureServer = await startLocalServer(fixtureDir);

  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await fixtureServer.close();
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const fixtureUrl = `${fixtureServer.url}/tall.html`;
  await page.goto(`${base}/index.html?url=${encodeURIComponent(fixtureUrl)}`, { waitUntil: 'load' });

  // Wait for every device iframe to finish loading the proxied fixture page.
  // The iframes are sandboxed without allow-same-origin, so contentDocument
  // is inaccessible from the top-level page's own JS context (always null,
  // cross-origin) — go through Playwright's frame API instead, which uses
  // CDP and isn't subject to that same-origin restriction.
  for (const key of DEVICES) {
    const handle = await page.$(`#preview-iframe-${key}`);
    const frame = await handle.contentFrame();
    await frame.waitForLoadState('load');
    await frame.waitForFunction(() => document.body && document.body.scrollHeight > 100);
  }

  const scrollYOf = async (key) => {
    const handle = await page.$(`#preview-iframe-${key}`);
    const frame = await handle.contentFrame();
    return frame.evaluate(() => window.scrollY);
  };

  // Scroll position is synced as a fraction of each device's own scrollable
  // range, since the four viewport widths give the same site four different
  // content heights (see src/previewProxy.js).
  const fractionOf = async (key) => {
    const handle = await page.$(`#preview-iframe-${key}`);
    const frame = await handle.contentFrame();
    return frame.evaluate(() => {
      const range = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      return window.scrollY / range;
    });
  };

  // Sanity: everything starts at scrollTop 0.
  for (const key of DEVICES) {
    assert.equal(await scrollYOf(key), 0, `${key} should start unscrolled`);
  }

  // Scroll the desktop frame's own content window directly (bypassing OS-level
  // wheel hit-testing, which is what the packaged app relies on and is the
  // suspected point of failure) and confirm it moves.
  const desktopHandle = await page.$('#preview-iframe-desktop');
  const desktopFrame = await desktopHandle.contentFrame();
  await desktopFrame.evaluate(() => window.scrollTo(0, 300));

  // Give the postMessage sync bridge a moment to propagate to the other three.
  await page.waitForTimeout(500);

  assert.ok(
    (await scrollYOf('desktop')) > 250,
    `desktop should have moved to the scrollY we set directly, got ${await scrollYOf('desktop')}`
  );

  // Every other device should have landed on the same relative position in
  // the page. They are CSS-zoomed, so a programmatic scroll snaps to the
  // zoomed document's own pixel grid and lands a hair off — compare the
  // fraction with a small tolerance rather than demanding exactness.
  const sourceFraction = await fractionOf('desktop');
  assert.ok(sourceFraction > 0, 'the source device should report a non-zero scroll fraction');

  for (const key of DEVICES.filter((k) => k !== 'desktop')) {
    const fraction = await fractionOf(key);
    assert.ok(
      Math.abs(fraction - sourceFraction) < 0.02,
      `${key} should sync to the source device's scroll fraction (${sourceFraction.toFixed(4)}), got ${fraction.toFixed(4)}`
    );
  }
});

test('real mouse wheel over each device bezel scrolls that device (OS-level hit-test check)', async (t) => {
  const outputRoot = await fs.mkdtemp(os.tmpdir() + '/preview-scroll-wheel-test-');
  const app = createApp({ outputRoot });
  const server = app.listen(0);
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const fixtureServer = await startLocalServer(fixtureDir);

  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await fixtureServer.close();
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const fixtureUrl = `${fixtureServer.url}/tall.html`;
  await page.goto(`${base}/index.html?url=${encodeURIComponent(fixtureUrl)}`, { waitUntil: 'load' });

  for (const key of DEVICES) {
    const handle = await page.$(`#preview-iframe-${key}`);
    const frame = await handle.contentFrame();
    await frame.waitForLoadState('load');
    await frame.waitForFunction(() => document.body && document.body.scrollHeight > 100);
  }

  const scrollYOf = async (key) => {
    const handle = await page.$(`#preview-iframe-${key}`);
    const frame = await handle.contentFrame();
    return frame.evaluate(() => window.scrollY);
  };

  const centerOf = async (key) => {
    const handle = await page.$(`.preview-frame-${key}`);
    await handle.scrollIntoViewIfNeeded();
    const box = await handle.boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  // Test each device in isolation: reload between devices so a stuck-focus
  // bug in one device can't be masked by residual scroll state from another.
  for (const key of DEVICES) {
    await page.reload({ waitUntil: 'load' });
    for (const k of DEVICES) {
      const handle = await page.$(`#preview-iframe-${k}`);
      const frame = await handle.contentFrame();
      await frame.waitForLoadState('load');
      await frame.waitForFunction(() => document.body && document.body.scrollHeight > 100);
    }

    const { x, y } = await centerOf(key);
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(300);

    const y0 = await scrollYOf(key);
    assert.ok(y0 > 0, `real wheel input centered on the ${key} bezel should scroll the ${key} iframe (got scrollY=${y0})`);
  }
});
