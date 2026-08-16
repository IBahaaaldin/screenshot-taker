import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import ffmpegPath from 'ffmpeg-static';

const execFileAsync = promisify(execFile);

// Matches #preview-stage's actual box (public/style.css: max-width 1400px,
// height 900px) so that, in recording mode (?record=1, which hides all page
// chrome — see public/style.css `body.recording-mode`), the stage fills the
// recorded viewport instead of being clipped or leaving empty margins.
export const STAGE_VIEWPORT = { width: 1400, height: 900 };
const SETTLE_WAIT_MS = 2500;
const SCROLL_SPEED_PX_PER_MS = 0.5;
const MIN_DURATION_MS = 4000;
const MAX_DURATION_MS = 15000;
const SCROLL_TICK_MS = 100;
const FFMPEG_TIMEOUT_MS = 30000;

// electron-builder packs node_modules into app.asar, but child_process
// cannot exec a binary from inside an asar archive. electron-builder's
// asarUnpack (see package.json's build.asarUnpack) extracts matching files
// to an `app.asar.unpacked` sibling directory at the same relative path, so
// rewriting the `app.asar` path segment to `app.asar.unpacked` recovers the
// real on-disk location of the unpacked ffmpeg binary. This is a no-op when
// running from source (npm start), where the path never contains `app.asar`.
export function resolveFfmpegPath(rawPath) {
  if (rawPath && rawPath.includes('app.asar')) {
    return rawPath.replace('app.asar', 'app.asar.unpacked');
  }
  return rawPath;
}

const resolvedFfmpegPath = resolveFfmpegPath(ffmpegPath);

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
      const previewUrl = `${previewBaseUrl}/index.html?url=${encodeURIComponent(url)}&record=1`;
      await page.goto(previewUrl, { waitUntil: 'load', timeout: 20000 });
      await page.waitForSelector('#preview-stage:not([hidden])', { timeout: 15000 });
      await page.waitForTimeout(SETTLE_WAIT_MS);

      // Cheap regression guard: confirm all 4 device frames are actually
      // fully visible within the recorded viewport before we spend time
      // driving the scroll and encoding. If recording-mode chrome-hiding
      // ever regresses (e.g. a CSS rule stops matching), fail loudly here
      // instead of silently producing a video with cut-off/missing frames.
      const viewportSize = page.viewportSize();
      const outOfBounds = await page.evaluate(({ width, height }) => {
        const selectors = [
          '.preview-frame-desktop',
          '.preview-frame-laptop',
          '.preview-frame-tablet',
          '.preview-frame-mobile',
        ];
        return selectors
          .map((selector) => {
            const el = document.querySelector(selector);
            if (!el) return { selector, reason: 'missing' };
            const rect = el.getBoundingClientRect();
            const fits =
              rect.left >= 0 && rect.top >= 0 && rect.right <= width && rect.bottom <= height;
            return fits ? null : { selector, reason: 'out-of-bounds', rect };
          })
          .filter(Boolean);
      }, viewportSize);
      if (outOfBounds.length > 0) {
        throw new Error(
          `Device frame(s) not fully within the recorded viewport (${viewportSize.width}x${viewportSize.height}): ` +
            outOfBounds.map((o) => `${o.selector} (${o.reason})`).join(', ')
        );
      }

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
      await execFileAsync(
        resolvedFfmpegPath,
        [
          '-y',
          '-i', webmPath,
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart',
          mp4Path,
        ],
        { timeout: FFMPEG_TIMEOUT_MS }
      );
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
