import path from 'node:path';
import sharp from 'sharp';

export async function splitTopBottom(compositeImagePath, outputDir, cutPercent = 50) {
  const clamped = Math.max(10, Math.min(90, cutPercent));
  const { width, height } = await sharp(compositeImagePath).metadata();
  const cutY = Math.max(1, Math.min(height - 1, Math.round((height * clamped) / 100)));

  const stem = path.basename(compositeImagePath, path.extname(compositeImagePath));
  const topPath = path.join(outputDir, `${stem}.top.png`);
  const bottomPath = path.join(outputDir, `${stem}.bottom.png`);

  await sharp(compositeImagePath)
    .extract({ left: 0, top: 0, width, height: cutY })
    .toFile(topPath);

  await sharp(compositeImagePath)
    .extract({ left: 0, top: cutY, width, height: height - cutY })
    .toFile(bottomPath);

  return { top: topPath, bottom: bottomPath };
}
