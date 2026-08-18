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

// public/index.html loads preview.js and app.js as two plain classic
// <script> tags, not modules — their top-level `const`/`let` declarations
// share one global scope. A name collision between them (e.g. both
// declaring `const form`) throws a SyntaxError that silently kills BOTH
// scripts on page load, with no server-side test able to catch it, since
// nothing else actually loads the two files together in one page context.
// This guards against that class of bug recurring.
test('index.html loads preview.js and app.js together with no script errors', async (t) => {
  const outputRoot = await fs.mkdtemp(os.tmpdir() + '/frontend-scripts-test-');
  const app = createApp({ outputRoot });
  const server = app.listen(0);
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  // Point the live-preview auto-load at the local fixture site instead of
  // its real hardcoded default (a live external URL) — deterministic, and
  // doesn't depend on network access or a third-party site being up.
  const fixtureServer = await startLocalServer(fixtureDir);

  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await fixtureServer.close();
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const fixtureUrl = `${fixtureServer.url}/index.html`;
  await page.goto(`${base}/index.html?url=${encodeURIComponent(fixtureUrl)}`, { waitUntil: 'load' });

  // The 4 preview iframes are deliberately sandboxed without
  // allow-same-origin (see src/previewProxy.js), so a real target site's
  // own scripts touching localStorage/sessionStorage inside them throw a
  // SecurityError — Playwright surfaces that as a pageerror even though
  // it's an expected, harmless side effect of the sandboxing choice, not a
  // bug in our own scripts. Only fail on errors outside that known class —
  // in particular, a `<identifier> has already been declared` SyntaxError
  // is exactly what a preview.js/app.js top-level name collision produces,
  // and silently kills both scripts with no other test able to catch it.
  const unexpectedErrors = pageErrors.filter(
    (msg) => !/sandboxed|allow-same-origin/i.test(msg)
  );
  assert.deepEqual(unexpectedErrors, [], 'page must load with no uncaught script errors (excluding expected sandboxed-iframe storage access errors)');

  // Confirm both scripts actually executed (not just "no error thrown") by
  // checking a function each of them defines at top level.
  const globals = await page.evaluate(() => ({
    previewJsLoaded: typeof loadAll === 'function',
    appJsLoaded: typeof updateSourceFields === 'function',
  }));
  assert.equal(globals.previewJsLoaded, true, 'preview.js should have executed (loadAll defined)');
  assert.equal(globals.appJsLoaded, true, 'app.js should have executed (updateSourceFields defined)');
});

// The device frames are content-box, so each bezel's border and its aluminium
// ring draw OUTSIDE the layout box. The stand and the laptop base are
// positioned as percentages of the stage, from the layout box — so unless they
// also clear that outer thickness they overlap the device they attach to. They
// did: the monitor's stand started 15px inside its own bottom bezel and the
// laptop's base cut 9px into the lid.
test('the desktop stand and laptop base meet their devices flush, not overlapping', async (t) => {
  const outputRoot = await fs.mkdtemp(os.tmpdir() + '/frame-joints-test-');
  const app = createApp({ outputRoot });
  const server = app.listen(0);
  const { port } = server.address();
  const fixtureServer = await startLocalServer(fixtureDir);

  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await fixtureServer.close();
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(
    `http://127.0.0.1:${port}/index.html?url=${encodeURIComponent(`${fixtureServer.url}/index.html`)}`,
    { waitUntil: 'load' }
  );

  const joints = await page.evaluate(() => {
    // A box-shadow never contributes to getBoundingClientRect, but the
    // aluminium enclosure ring IS drawn with one — so the visible bottom edge
    // of a device is its rect bottom plus that ring's spread.
    const visualBottom = (sel) => {
      const el = document.querySelector(sel);
      const ring = /(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/.exec(
        getComputedStyle(el).boxShadow
      );
      return el.getBoundingClientRect().bottom + (ring ? parseFloat(ring[4]) : 0);
    };
    const top = (sel) => document.querySelector(sel).getBoundingClientRect().top;
    return {
      desktopToNeck: top('.preview-frame-desktop-neck') - visualBottom('.preview-frame-desktop'),
      neckToFoot: top('.preview-frame-desktop-foot') - visualBottom('.preview-frame-desktop-neck'),
      laptopToDeck: top('.preview-frame-deck') - visualBottom('.preview-frame-laptop'),
    };
  });

  // A negative gap is the actual bug: the part is drawn on top of the device.
  // Small positive slack is unavoidable — browsers round border widths to whole
  // pixels while these offsets are continuous percentages — but it has to stay
  // well under a pixel or two or it reads as a seam.
  for (const [name, gap] of Object.entries(joints)) {
    assert.ok(gap >= -0.5, `${name} overlaps the device by ${(-gap).toFixed(2)}px`);
    assert.ok(gap <= 2.5, `${name} leaves a visible ${gap.toFixed(2)}px seam`);
  }
});
