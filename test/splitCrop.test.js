import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { splitLeftRight } from '../src/splitCrop.js';

async function makeTestImage(dir, width, height) {
  const imgPath = path.join(dir, 'source-composite.png');
  await sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toFile(imgPath);
  return imgPath;
}

test('splitLeftRight crops a composite into left and right halves at the default 50%', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'split-crop-test-'));
  try {
    const source = await makeTestImage(dir, 400, 300);
    const result = await splitLeftRight(source, dir);

    assert.equal(result.left, path.join(dir, 'source-composite.left.png'));
    assert.equal(result.right, path.join(dir, 'source-composite.right.png'));

    const leftMeta = await sharp(result.left).metadata();
    const rightMeta = await sharp(result.right).metadata();

    assert.equal(leftMeta.width, 200);
    assert.equal(leftMeta.height, 300);
    assert.equal(rightMeta.width, 200);
    assert.equal(rightMeta.height, 300);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('splitLeftRight respects a custom cutPercent', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'split-crop-test-'));
  try {
    const source = await makeTestImage(dir, 400, 200);
    const result = await splitLeftRight(source, dir, 25);

    const leftMeta = await sharp(result.left).metadata();
    const rightMeta = await sharp(result.right).metadata();

    assert.equal(leftMeta.width, 100);
    assert.equal(rightMeta.width, 300);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('splitLeftRight clamps cutPercent to the 10-90 range', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'split-crop-test-'));
  try {
    const source = await makeTestImage(dir, 1000, 100);

    const tooLow = await splitLeftRight(source, dir, 0);
    const tooLowMeta = await sharp(tooLow.left).metadata();
    assert.equal(tooLowMeta.width, 100); // clamped to 10%

    const tooHigh = await splitLeftRight(source, dir, 150);
    const tooHighMeta = await sharp(tooHigh.left).metadata();
    assert.equal(tooHighMeta.width, 900); // clamped to 90%
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
