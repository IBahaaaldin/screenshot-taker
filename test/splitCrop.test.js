import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { splitTopBottom } from '../src/splitCrop.js';

async function makeTestImage(dir, width, height) {
  const imgPath = path.join(dir, 'source-composite.png');
  await sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toFile(imgPath);
  return imgPath;
}

test('splitTopBottom crops a composite into top and bottom halves at the default 50%', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'split-crop-test-'));
  try {
    const source = await makeTestImage(dir, 400, 300);
    const result = await splitTopBottom(source, dir);

    assert.equal(result.top, path.join(dir, 'source-composite.top.png'));
    assert.equal(result.bottom, path.join(dir, 'source-composite.bottom.png'));

    const topMeta = await sharp(result.top).metadata();
    const bottomMeta = await sharp(result.bottom).metadata();

    assert.equal(topMeta.width, 400);
    assert.equal(topMeta.height, 150);
    assert.equal(bottomMeta.width, 400);
    assert.equal(bottomMeta.height, 150);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('splitTopBottom respects a custom cutPercent', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'split-crop-test-'));
  try {
    const source = await makeTestImage(dir, 200, 400);
    const result = await splitTopBottom(source, dir, 25);

    const topMeta = await sharp(result.top).metadata();
    const bottomMeta = await sharp(result.bottom).metadata();

    assert.equal(topMeta.height, 100);
    assert.equal(bottomMeta.height, 300);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('splitTopBottom clamps cutPercent to the 10-90 range', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'split-crop-test-'));
  try {
    const source = await makeTestImage(dir, 100, 1000);

    const tooLow = await splitTopBottom(source, dir, 0);
    const tooLowMeta = await sharp(tooLow.top).metadata();
    assert.equal(tooLowMeta.height, 100); // clamped to 10%

    const tooHigh = await splitTopBottom(source, dir, 150);
    const tooHighMeta = await sharp(tooHigh.top).metadata();
    assert.equal(tooHighMeta.height, 900); // clamped to 90%
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
