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

// Loads the live preview against a local fixture tall enough to scroll, and
// waits for all four device iframes to be ready.
//
// The iframes are sandboxed without allow-same-origin, so contentDocument is
// inaccessible from the top-level page's own JS (it reads as cross-origin) —
// everything here goes through Playwright's frame API, which uses CDP and
// isn't subject to that restriction.
async function openPreview(t, browser) {
  const outputRoot = await fs.mkdtemp(os.tmpdir() + '/preview-scroll-test-');
  const app = createApp({ outputRoot });
  const server = app.listen(0);
  const { port } = server.address();
  const fixtureServer = await startLocalServer(fixtureDir);

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fixtureServer.close();
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const fixtureUrl = `${fixtureServer.url}/tall.html`;
  await page.goto(
    `http://127.0.0.1:${port}/index.html?url=${encodeURIComponent(fixtureUrl)}`,
    { waitUntil: 'load' }
  );

  for (const key of DEVICES) {
    const frame = await (await page.$(`#preview-iframe-${key}`)).contentFrame();
    await frame.waitForLoadState('load');
    await frame.waitForFunction(() => document.body && document.body.scrollHeight > 100);
  }

  const scrollYOf = async (key) => {
    const frame = await (await page.$(`#preview-iframe-${key}`)).contentFrame();
    return frame.evaluate(() => window.scrollY);
  };

  // Centre of the device's own screen area, scrolled into view first so the
  // wheel lands on the iframe and not on empty space below the fold.
  const centerOf = async (key) => {
    const handle = await page.$(`.preview-frame-${key}`);
    await handle.scrollIntoViewIfNeeded();
    const box = await handle.boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  return { page, scrollYOf, centerOf };
}

test('real mouse wheel over each device bezel scrolls that device', async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());

  const { page, scrollYOf, centerOf } = await openPreview(t, browser);

  for (const key of DEVICES) {
    // Reload between devices so a stuck-focus bug in one can't be masked by
    // another device's residual scroll state.
    await page.reload({ waitUntil: 'load' });
    for (const k of DEVICES) {
      const frame = await (await page.$(`#preview-iframe-${k}`)).contentFrame();
      await frame.waitForLoadState('load');
      await frame.waitForFunction(() => document.body && document.body.scrollHeight > 100);
    }

    const { x, y } = await centerOf(key);
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(300);

    const scrolled = await scrollYOf(key);
    assert.ok(
      scrolled > 0,
      `wheel input over the ${key} bezel should scroll the ${key} iframe (got scrollY=${scrolled})`
    );
  }
});

// Each device is meant to scroll on its own, so you can hold the phone on one
// section while looking at another on the desktop. This guards against
// cross-device scroll relaying being reintroduced.
test('scrolling one device leaves the other three where they were', async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());

  const { page, scrollYOf, centerOf } = await openPreview(t, browser);

  for (const key of DEVICES) {
    assert.equal(await scrollYOf(key), 0, `${key} should start unscrolled`);
  }

  const { x, y } = await centerOf('desktop');
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, 300);
  // Comfortably longer than any sync relay would have taken to land.
  await page.waitForTimeout(600);

  assert.ok(
    (await scrollYOf('desktop')) > 0,
    'the device under the cursor should have scrolled'
  );

  for (const key of DEVICES.filter((k) => k !== 'desktop')) {
    assert.equal(
      await scrollYOf(key),
      0,
      `${key} should NOT have moved — each device scrolls independently`
    );
  }
});

// The device iframes are sandboxed without allow-same-origin, so they get an
// opaque origin — and in an opaque origin merely READING window.localStorage
// throws. Sites routinely read a stored theme during init; that exception
// aborted the rest of the init script, leaving every scroll-reveal element at
// opacity 0. The preview looked like it "wasn't loading the full site":
// headings visible, all content below them blank, on all four devices.
test('site scripts that read localStorage still initialise inside the device frames', async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());

  const outputRoot = await fs.mkdtemp(os.tmpdir() + '/preview-storage-test-');
  const app = createApp({ outputRoot });
  const server = app.listen(0);
  const { port } = server.address();
  const fixtureServer = await startLocalServer(fixtureDir);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fixtureServer.close();
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const target = `${fixtureServer.url}/storage-reveal.html`;
  await page.goto(`http://127.0.0.1:${port}/index.html?url=${encodeURIComponent(target)}`, {
    waitUntil: 'load',
  });

  for (const key of DEVICES) {
    const frame = await (await page.$(`#preview-iframe-${key}`)).contentFrame();
    await frame.waitForLoadState('load');
    const opacity = await frame.evaluate(
      () => getComputedStyle(document.getElementById('card')).opacity
    );
    assert.equal(
      opacity,
      '1',
      `${key}: the fixture's init script must have completed and revealed its content (opacity ${opacity})`
    );
  }

  const storageErrors = pageErrors.filter((m) => /localStorage|sessionStorage|allow-same-origin/i.test(m));
  assert.deepEqual(storageErrors, [], 'no storage SecurityErrors should reach the site scripts');
});
