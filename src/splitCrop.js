import path from 'node:path';
import sharp from 'sharp';

export async function splitLeftRight(compositeImagePath, outputDir, cutPercent = 50) {
  const clamped = Math.max(10, Math.min(90, cutPercent));
  const { width, height } = await sharp(compositeImagePath).metadata();
  const cutX = Math.max(1, Math.min(width - 1, Math.round((width * clamped) / 100)));

  const stem = path.basename(compositeImagePath, path.extname(compositeImagePath));
  const leftPath = path.join(outputDir, `${stem}.left.png`);
  const rightPath = path.join(outputDir, `${stem}.right.png`);

  await sharp(compositeImagePath)
    .extract({ left: 0, top: 0, width: cutX, height })
    .toFile(leftPath);

  await sharp(compositeImagePath)
    .extract({ left: cutX, top: 0, width: width - cutX, height })
    .toFile(rightPath);

  return { left: leftPath, right: rightPath };
}
