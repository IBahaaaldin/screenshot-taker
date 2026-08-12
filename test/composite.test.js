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
