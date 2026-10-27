import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import ffmpegPath from 'ffmpeg-static';
import { FIND_SPLASH_FN } from './pageReady.js';

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
// Finer ticks at the same speed. At 100ms the page jumped ~50px per frame,
// which is faster than a scroll-reveal transition can run, so elements popped
// in fully-formed instead of animating — the site's motion design never made it
// into the recording. Halving the tick keeps the same pace and duration while
// giving the reveals frames to play across.
const SCROLL_TICK_MS = 50;
// An intro splash covers the site for its first seconds, and the four device
// frames do not get through it together — the desktop one renders at 1920px, so
// it asks for the largest image variants and lags the phone beside it by
// several seconds. Recording through that opens every video on a logo animation
// over a blank white monitor, so the recording waits for all four instead.
// Capped, because a splash that never leaves must not hang the run — the
// preview page hides it on its own timer in that case.
const FRAME_READY_WAIT_MS = 20000;
const FRAME_READY_POLL_MS = 250;
// A frame has to look splash-free for this long before it counts as ready. One
// clean look is not enough: the four frames do not finish loading together, and
// checking the slowest one before its splash had even mounted read as "no
// splash, go" — so the recording opened on the intro animation the check exists
// to skip, with the largest frame a blank white monitor for six seconds.
const FRAME_QUIET_MS = 1500;
// The earliest point in the raw capture the trim is allowed to cut to.
//
// The readiness checks above watch the DOM, and the DOM is ahead of the video.
// Each device frame renders at its real device width (the desktop one at
// 1920px) and is then CSS-scaled down to fit the stage, so Chromium has to
// rasterise a far larger surface than the frame actually shows, and the video
// stream carries only what has been rasterised. Measuring the recorded frames
// directly, the desktop monitor stayed blank white for ~6s after navigation
// while a page.screenshot() taken at 3s already showed the hero — the DOM
// cannot report this, because by every DOM measure the frame was ready.
//
// So the trim point is also held to a floor measured from navigation. It costs
// wall-clock on the run and nothing in the output, which is the right trade for
// not opening every video on a blank screen.
const MIN_PREROLL_MS = 8000;
// Playwright starts recording the moment the page exists, so everything before
// the scroll — four iframes fetching a site through the proxy, then the intro
// splash playing out — lands at the head of the file as a static shot of four
// empty devices. On a slow site that was 20 of the video's 33 seconds. The
// finished video is cut back to just before the scroll starts, keeping this
// much lead-in so it doesn't open mid-movement.
const VIDEO_LEAD_IN_MS = 600;
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

// The proxied page inside each frame clears blocking modals itself (see
// src/pageReady.js). A splash is left to finish on its own, so the recording
// polls the desktop frame until it has.
// Resolves once every device frame is showing the site itself: past its intro
// splash, with the images that are actually on screen decoded. Only the visible
// images are waited for — the rest are lazy-loaded and arrive as the recording
// scrolls past them, which is the point.
//
// Every frame is watched, not just the desktop one. They load at different
// speeds, and the recording is only worth starting once the slowest has caught
// up.
async function waitForFramesToSettle(page) {
  const deadline = Date.now() + FRAME_READY_WAIT_MS;
  const frames = [];
  for (const name of ['desktop', 'laptop', 'tablet', 'mobile']) {
    const handle = await page.$(`#preview-iframe-${name}`);
    const frame = handle ? await handle.contentFrame() : null;
    if (frame) frames.push({ frame, quietSince: null });
  }

  while (Date.now() < deadline) {
    let allReady = true;
    for (const entry of frames) {
      let state;
      try {
        const splash = await entry.frame.evaluate(FIND_SPLASH_FN);
        const painted = await entry.frame.evaluate(() => {
          var images = document.images;
          for (var i = 0; i < images.length; i++) {
            var img = images[i];
            var rect = img.getBoundingClientRect();
            var onScreen =
              rect.bottom > 0 && rect.top < window.innerHeight && rect.width > 1 && rect.height > 1;
            if (!onScreen) continue;
            if (!img.complete || img.naturalWidth === 0) return false;
          }
          return true;
        });
        state = !splash && painted;
      } catch {
        // A frame that navigated out from under us can't hold up the others.
        state = true;
      }

      if (!state) {
        entry.quietSince = null;
        allReady = false;
        continue;
      }
      if (entry.quietSince === null) entry.quietSince = Date.now();
      if (Date.now() - entry.quietSince < FRAME_QUIET_MS) allReady = false;
    }
    if (allReady) return;
    await page.waitForTimeout(FRAME_READY_POLL_MS);
  }
}

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
      const recordingStartedAt = Date.now();
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

      await waitForFramesToSettle(page);
      const prerollRemaining = MIN_PREROLL_MS - (Date.now() - recordingStartedAt);
      if (prerollRemaining > 0) await page.waitForTimeout(prerollRemaining);

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

      const trimMs = Math.max(0, Date.now() - recordingStartedAt - VIDEO_LEAD_IN_MS);

      if (scrollDistance > 0 && desktopHandle) {
        const box = await desktopHandle.boundingBox();
        if (box) {
          // Each device frame is CSS-zoomed down to fit the stage (see
          // public/preview.js scaleFramesToFit), and a wheel delta is measured
          // in the stage's pixels while scrollDistance is measured in the
          // frame's own document pixels. Feeding one straight into the other
          // scrolled the desktop frame by delta/zoom — roughly three times the
          // intended speed. It hit the footer a third of the way through the
          // video and sat there, and on the way it moved so fast that the
          // site's scroll-reveal animations never had time to play, which read
          // as a blank white monitor next to three working devices.
          const zoom = await page.evaluate(() => {
            const iframe = document.querySelector('#preview-iframe-desktop');
            const value = iframe ? parseFloat(iframe.style.zoom) : NaN;
            return Number.isFinite(value) && value > 0 ? value : 1;
          });
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          const ticks = Math.max(1, Math.round(durationMs / SCROLL_TICK_MS));
          const deltaPerTick = (scrollDistance / ticks) * zoom;
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
          // Before -i so ffmpeg seeks rather than decoding and discarding the
          // frames it is about to throw away.
          '-ss', (trimMs / 1000).toFixed(3),
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
