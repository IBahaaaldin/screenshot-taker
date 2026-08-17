// test/composite.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import sharp from 'sharp';
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
        // Sample a point well inside the desktop monitor's screen area, and
        // a point well inside the mobile phone's screen area. Coordinates
        // are derived from src/composite.js's LAYOUT constants (desktop:
        // x490 y130 w820 h461; mobile: x460 y580 w184 h400) — each point
        // sits safely inside that device's screen and outside every other
        // device's bounding box in the overlapping hero-mockup layout. Only
        // desktop/mobile images are provided in this test, so laptop/tablet
        // frames don't render at all — no need to dodge their bounds too.
        const sample = (x, y) => {
          const d = ctx.getImageData(x, y, 1, 1).data;
          return [d[0], d[1], d[2]];
        };
        return {
          desktopArea: sample(700, 300),
          mobileArea: sample(552, 780),
        };
      }, compositeDataUrl);

      // Bezel/background colors from src/composite.js's stylesheet — none of
      // these should appear at a sample point that's genuinely inside a
      // device's screen area.
      const nonContentColors = [
        [28, 28, 30], // #1c1c1e desktop bezel
        [30, 30, 32], // #1e1e20 laptop/tablet/mobile bezel
        [5, 5, 5], // #050505 canvas background
      ];
      const isBezel = (rgb) =>
        nonContentColors.some(
          (c) => Math.abs(rgb[0] - c[0]) < 5 && Math.abs(rgb[1] - c[1]) < 5 && Math.abs(rgb[2] - c[2]) < 5
        );

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

// A section screenshot's height is whatever that section happens to be, so it
// rarely matches the device screen's aspect ratio. The composite must scale it
// to the screen's WIDTH and clip any overflow — never scale by height and crop
// the sides, which magnifies the page and slices words in half. That was a
// real regression from object-fit:cover.
test('buildComposite fits a wide, short capture to the screen width without cropping its sides', async () => {
  const browser = await chromium.launch();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'composite-fit-'));
  try {
    // 1920x480 is far wider than the desktop screen's 16:9. object-fit:cover
    // would scale by height (the axis needing more) and show only the middle
    // ~44% of the width. Narrow markers pinned to the extreme left and right
    // edges are the thing that survives a width fit and is destroyed by a
    // height fit — a simple two-halves image can't tell the two apart, since
    // both halves remain partly visible either way.
    const EDGE = 40;
    const wide = path.join(tmp, 'wide.png');
    const marker = (color) =>
      sharp({ create: { width: EDGE, height: 480, channels: 3, background: color } }).png().toBuffer();
    await sharp({ create: { width: 1920, height: 480, channels: 3, background: { r: 250, g: 250, b: 250 } } })
      .composite([
        { input: await marker({ r: 255, g: 0, b: 0 }), left: 0, top: 0 },
        { input: await marker({ r: 0, g: 0, b: 255 }), left: 1920 - EDGE, top: 0 },
      ])
      .png()
      .toFile(wide);

    const out = path.join(tmp, 'composite.png');
    await buildComposite(browser, { desktop: wide }, out);

    // Desktop screen spans x 508..1328, y 148..609 (LAYOUT x490 y130 w820
    // h461, plus the 18px bezel). At a correct width fit the capture renders
    // 820x205 at the top of the screen, so sample inside that band.
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const at = (x, y) => {
      const i = (y * info.width + x) * info.channels;
      return { r: data[i], g: data[i + 1], b: data[i + 2] };
    };
    const nearLeft = at(514, 198);
    const nearRight = at(1322, 198);

    assert.ok(
      nearLeft.r > 200 && nearLeft.b < 60,
      `the capture's far-left edge must remain visible (no side cropping), got ${JSON.stringify(nearLeft)}`
    );
    assert.ok(
      nearRight.b > 200 && nearRight.r < 60,
      `the capture's far-right edge must remain visible (no side cropping), got ${JSON.stringify(nearRight)}`
    );
  } finally {
    await browser.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
