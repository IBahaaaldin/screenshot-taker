import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import ffmpegPath from 'ffmpeg-static';

const execFileAsync = promisify(execFile);

const STAGE_VIEWPORT = { width: 1450, height: 960 };
const SETTLE_WAIT_MS = 2500;
const SCROLL_SPEED_PX_PER_MS = 0.5;
const MIN_DURATION_MS = 4000;
const MAX_DURATION_MS = 15000;
const SCROLL_TICK_MS = 100;

export async function recordSitePreview({ url, previewBaseUrl, outputDir }) {
  const videoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'screenshot-taker-video-'));
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: STAGE_VIEWPORT,
      recordVideo: { dir: videoDir, size: STAGE_VIEWPORT },
    });
    const page = await context.newPage();
    try {
      const previewUrl = `${previewBaseUrl}/preview.html?url=${encodeURIComponent(url)}`;
      await page.goto(previewUrl, { waitUntil: 'load', timeout: 20000 });
      await page.waitForSelector('#preview-stage:not([hidden])', { timeout: 15000 });
      await page.waitForTimeout(SETTLE_WAIT_MS);

      const desktopHandle = await page.$('#preview-iframe-desktop');
      const desktopFrame = desktopHandle ? await desktopHandle.contentFrame() : null;

      let scrollDistance = 0;
      if (desktopFrame) {
        try {
          scrollDistance = await desktopFrame.evaluate(
            () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
          );
        } catch {
          scrollDistance = 0;
        }
      }

      const durationMs = Math.min(
        MAX_DURATION_MS,
        Math.max(MIN_DURATION_MS, scrollDistance / SCROLL_SPEED_PX_PER_MS)
      );

      if (scrollDistance > 0 && desktopHandle) {
        const box = await desktopHandle.boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          const ticks = Math.max(1, Math.round(durationMs / SCROLL_TICK_MS));
          const deltaPerTick = scrollDistance / ticks;
          for (let i = 0; i < ticks; i++) {
            await page.mouse.wheel(0, deltaPerTick);
            await page.waitForTimeout(SCROLL_TICK_MS);
          }
        } else {
          await page.waitForTimeout(durationMs);
        }
      } else {
        await page.waitForTimeout(durationMs);
      }

      const video = page.video();
      await page.close();
      await context.close();
      const webmPath = video ? await video.path() : null;
      if (!webmPath) {
        throw new Error('Playwright did not produce a video recording');
      }

      await fs.mkdir(outputDir, { recursive: true });
      const mp4Path = path.join(outputDir, `${path.basename(webmPath, path.extname(webmPath))}.mp4`);
      await execFileAsync(ffmpegPath, [
        '-y',
        '-i', webmPath,
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        mp4Path,
      ]);
      await fs.rm(webmPath, { force: true });

      return { mp4Path, durationMs };
    } finally {
      if (!page.isClosed()) await page.close().catch(() => {});
    }
  } finally {
    await browser.close();
    await fs.rm(videoDir, { recursive: true, force: true });
  }
}
