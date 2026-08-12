// test/composite.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { buildComposite } from '../src/composite.js';

async function makeSamplePng(dir, name, width, height, color) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(`<body style="margin:0;background:${color};width:${width}px;height:${height}px;"></body>`);
  const filePath = path.join(dir, name);
  await page.screenshot({ path: filePath });
  await browser.close();
  return filePath;
}

test('buildComposite renders a PNG containing all provided viewports', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'composite-test-'));
  const browser = await chromium.launch();
  try {
    const desktop = await makeSamplePng(tmp, 'desktop.png', 400, 200, 'red');
    const mobile = await makeSamplePng(tmp, 'mobile.png', 120, 240, 'blue');
    const outputPath = path.join(tmp, 'composite.png');

    const result = await buildComposite(browser, { desktop, mobile }, outputPath);

    assert.equal(result, outputPath);
    const stat = await fs.stat(outputPath);
    assert.ok(stat.size > 1000, 'composite PNG should be non-trivial in size');

    // Positively confirm the embedded source images actually rendered, not
    // just that a plausibly-sized file exists. A prior regression used
    // file:// <img src> URLs with page.setContent(), which Chromium refuses
    // to load (about:blank origin can't fetch file:// subresources), so every
    // composite silently rendered as a blank bezel. Load the composite back
    // and inspect pixels known to be inside each embedded image.
    const verifyPage = await browser.newPage();
    try {
      const compositeBuffer = await fs.readFile(outputPath);
      const compositeDataUrl = `data:image/png;base64,${compositeBuffer.toString('base64')}`;
      const pixels = await verifyPage.evaluate(async (src) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        // Sample a point well inside the first (desktop) frame's bezel area,
        // and a point well inside the second (mobile) frame's bezel area.
        // These coordinates are derived from the known canvas layout: two
        // frames centered with a 40px gap on a 2000x1200 canvas.
        const sample = (x, y) => {
          const d = ctx.getImageData(x, y, 1, 1).data;
          return [d[0], d[1], d[2]];
        };
        return {
          desktopArea: sample(700, 600),
          mobileArea: sample(1300, 600),
        };
      }, compositeDataUrl);

      const bezelColor = [17, 17, 17]; // #111
      const isBezel = (rgb) =>
        Math.abs(rgb[0] - bezelColor[0]) < 5 &&
        Math.abs(rgb[1] - bezelColor[1]) < 5 &&
        Math.abs(rgb[2] - bezelColor[2]) < 5;

      assert.ok(
        !isBezel(pixels.desktopArea),
        `desktop frame area should show the red source image, not the bare bezel background; got rgb(${pixels.desktopArea})`
      );
      assert.ok(
        !isBezel(pixels.mobileArea),
        `mobile frame area should show the blue source image, not the bare bezel background; got rgb(${pixels.mobileArea})`
      );
    } finally {
      await verifyPage.close();
    }
  } finally {
    await browser.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('buildComposite throws when given no images', async () => {
  const browser = await chromium.launch();
  try {
    await assert.rejects(() => buildComposite(browser, {}, '/tmp/should-not-write.png'));
  } finally {
    await browser.close();
  }
});
