import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { chromium } from 'playwright';
import { startLocalServer } from '../src/localServer.js';
import { createPreviewRouter } from '../src/routes/preview.js';
import { recordSitePreview, resolveFfmpegPath, STAGE_VIEWPORT } from '../src/screenRecorder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'site');

test('recordSitePreview produces a nonzero-size MP4 with a valid ftyp header', async (t) => {
  const fixtureServer = await startLocalServer(fixtureDir);
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'screenshot-taker-test-'));

  // A minimal app serving index.html/preview.js/style.css plus the
  // preview proxy routes, so recordSitePreview has a real page to visit.
  const app = express();
  app.use('/api', createPreviewRouter({ outputRoot }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const previewBaseUrl = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await fixtureServer.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const recordDir = await fs.mkdtemp(path.join(os.tmpdir(), 'screenshot-taker-record-'));
  t.after(() => fs.rm(recordDir, { recursive: true, force: true }));

  const { mp4Path, durationMs } = await recordSitePreview({
    url: `${fixtureServer.url}/index.html`,
    previewBaseUrl,
    outputDir: recordDir,
  });

  assert.ok(durationMs >= 4000, 'duration floors at 4000ms for a short fixture page');

  const stat = await fs.stat(mp4Path);
  assert.ok(stat.size > 0, 'mp4 file has nonzero size');

  const fd = await fs.open(mp4Path, 'r');
  const buffer = Buffer.alloc(12);
  await fd.read(buffer, 0, 12, 0);
  await fd.close();
  // MP4 files carry an 'ftyp' box; its 4-byte type tag sits at offset 4.
  assert.equal(buffer.toString('ascii', 4, 8), 'ftyp', 'output starts with a valid MP4 ftyp box');
});

test('recording mode (?record=1) keeps all 4 device frames fully within the stage viewport', async (t) => {
  const fixtureServer = await startLocalServer(fixtureDir);
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'screenshot-taker-test-'));

  const app = express();
  app.use('/api', createPreviewRouter({ outputRoot }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const previewBaseUrl = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await fixtureServer.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const context = await browser.newContext({ viewport: STAGE_VIEWPORT });
  const page = await context.newPage();
  const previewUrl = `${previewBaseUrl}/index.html?url=${encodeURIComponent(`${fixtureServer.url}/index.html`)}&record=1`;
  await page.goto(previewUrl, { waitUntil: 'load', timeout: 20000 });
  await page.waitForSelector('#preview-stage:not([hidden])', { timeout: 15000 });

  // This mirrors the regression guard added to recordSitePreview() in
  // src/screenRecorder.js: all 4 device frames must be fully within the
  // viewport once recording-mode chrome (nav/hero/card) is hidden.
  const rects = await page.evaluate((viewport) => {
    const selectors = [
      '.preview-frame-desktop',
      '.preview-frame-laptop',
      '.preview-frame-tablet',
      '.preview-frame-mobile',
    ];
    return selectors.map((selector) => {
      const el = document.querySelector(selector);
      const rect = el.getBoundingClientRect();
      return {
        selector,
        found: Boolean(el),
        fits:
          rect.left >= 0 && rect.top >= 0 && rect.right <= viewport.width && rect.bottom <= viewport.height,
        rect: { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom },
      };
    });
  }, STAGE_VIEWPORT);

  for (const r of rects) {
    assert.ok(r.found, `${r.selector} should exist`);
    assert.ok(
      r.fits,
      `${r.selector} should fit fully within the ${STAGE_VIEWPORT.width}x${STAGE_VIEWPORT.height} viewport, got ${JSON.stringify(r.rect)}`
    );
  }

  // Also confirm the page chrome (nav/hero/card) that used to eat up the
  // top of the viewport is actually hidden in recording mode.
  const chromeHidden = await page.evaluate(() => {
    const nav = document.querySelector('nav');
    const hero = document.querySelector('.hero');
    const card = document.querySelector('.card');
    return [nav, hero, card].every((el) => !el || getComputedStyle(el).display === 'none');
  });
  assert.ok(chromeHidden, 'nav/hero/card should be hidden when ?record=1 is set');

  await context.close();
});

test('resolveFfmpegPath rewrites an app.asar path segment to app.asar.unpacked', () => {
  const packaged =
    '/Applications/Screenshot Taker.app/Contents/Resources/app.asar/node_modules/ffmpeg-static/ffmpeg';
  assert.equal(
    resolveFfmpegPath(packaged),
    '/Applications/Screenshot Taker.app/Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg'
  );

  const unpackaged = '/Users/dev/screenshot-taker/node_modules/ffmpeg-static/ffmpeg';
  assert.equal(resolveFfmpegPath(unpackaged), unpackaged, 'leaves non-asar paths untouched');
});
