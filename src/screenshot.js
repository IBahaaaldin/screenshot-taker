// src/screenshot.js
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { VIEWPORTS } from './viewports.js';
import { detectSections } from './sectionDetector.js';
import { hideCookieBanners } from './cookieBanner.js';

const INITIAL_VIEWPORT_HEIGHT = 1000;
// A screenshot taken mid-transition (e.g. a hero carousel slide still
// fading in) often lands as a near-uniform color — very low per-channel
// stdev. One retry after a short wait catches the common case cheaply.
const BLANK_STDEV_THRESHOLD = 4;
const BLANK_RETRY_WAIT_MS = 500;

export async function captureAllViewports(browser, pageUrl, { mode, selectors = [], outputDir }) {
  const results = [];

  // Detect the sections ONCE and reuse the same selectors for every device.
  //
  // Detection used to run per viewport, which meant "section-3" was only the
  // same part of the page on all four devices by coincidence. Any element that
  // fell below the size filter at one breakpoint (or was display:none there)
  // shifted every later index on that device alone — and the composite would
  // then show four devices displaying four DIFFERENT sections, with nothing to
  // flag it. Detecting once makes section-N the same DOM element everywhere,
  // by construction.
  const plan = await planSections(browser, pageUrl, mode, selectors);

  for (const viewport of VIEWPORTS) {
    const viewportDir = path.join(outputDir, viewport.name);
    await fs.mkdir(viewportDir, { recursive: true });

    const sections = await captureOneViewport(browser, pageUrl, viewport, plan, viewportDir);
    results.push({ viewport: viewport.name, sections });
  }

  return results;
}

// Runs detection at the widest viewport, where a responsive layout shows the
// most structure — narrow breakpoints often collapse or hide whole blocks.
async function planSections(browser, pageUrl, mode, selectors) {
  const widest = VIEWPORTS.reduce((a, b) => (b.width > a.width ? b : a));
  const page = await browser.newPage();
  try {
    await page.setViewportSize({ width: widest.width, height: INITIAL_VIEWPORT_HEIGHT });
    const loaded = await gotoWithRetry(page, pageUrl);
    if (!loaded) return [];
    await triggerScrollRevealAnimations(page);
    // Before detection, so a fixed consent banner is never mistaken for a
    // section of its own.
    await hideCookieBanners(page);
    return await detectSections(page, mode, selectors);
  } catch (err) {
    console.error(`[screenshot] failed to detect sections for ${pageUrl}: ${err.message}`);
    return [];
  } finally {
    await page.close();
  }
}

async function captureOneViewport(browser, pageUrl, viewport, sections, viewportDir) {
  const page = await browser.newPage();
  try {
    await page.setViewportSize({ width: viewport.width, height: INITIAL_VIEWPORT_HEIGHT });
    const loaded = await gotoWithRetry(page, pageUrl);
    if (!loaded) {
      return [];
    }

    await triggerScrollRevealAnimations(page);
    await hideCookieBanners(page);

    const written = [];
    try {
      for (const section of sections) {
        const filePath = path.join(viewportDir, `${section.slug}.png`);
        try {
          const shoot = () =>
            section.selector === null
              ? page.screenshot({ path: filePath, fullPage: true })
              : // Locator screenshots scroll the element into view and capture
                // its full bounding box in one shot, so they aren't fooled by
                // viewport-relative CSS (e.g. `min-height: 100vh`) that would
                // otherwise change as the viewport resizes. A short explicit
                // timeout keeps a hidden/zero-size selector match (e.g. a
                // deliberately-targeted modal or accordion panel) a fast,
                // contained failure instead of waiting out Playwright's ~30s
                // default actionability timeout per section per viewport.
                page.locator(section.selector).screenshot({ path: filePath, timeout: 5000 });

          await shoot();
          if (await isNearSolidColor(filePath)) {
            await page.waitForTimeout(BLANK_RETRY_WAIT_MS);
            await shoot();
          }
          written.push({ slug: section.slug, path: filePath });
        } catch (err) {
          console.error(`[screenshot] failed to capture section "${section.slug}" for ${pageUrl} at ${viewport.name}: ${err.message}`);
        }
      }
    } catch (err) {
      console.error(`[screenshot] failed to capture sections for ${pageUrl} at ${viewport.name}: ${err.message}`);
    }
    return written;
  } finally {
    await page.close();
  }
}

async function triggerScrollRevealAnimations(page) {
  try {
    await page.evaluate(async () => {
      const step = Math.max(window.innerHeight, 200);
      const maxHeight = document.documentElement.scrollHeight;
      for (let y = 0; y < maxHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      window.scrollTo(0, maxHeight);
      await new Promise((resolve) => setTimeout(resolve, 60));
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(300);
  } catch {
    // Best-effort — if the page can't be scrolled (e.g. it navigated away
    // mid-evaluate), section detection/screenshot will surface the real error.
  }
}

async function gotoWithRetry(page, pageUrl) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(pageUrl, { waitUntil: 'load', timeout: 15000 });
      return true;
    } catch (err) {
      if (attempt === 1) {
        console.error(`[screenshot] failed to load ${pageUrl}: ${err.message}`);
        return false;
      }
    }
  }
  return false;
}

async function isNearSolidColor(filePath) {
  try {
    const { channels } = await sharp(filePath).stats();
    return channels.every((channel) => channel.stdev < BLANK_STDEV_THRESHOLD);
  } catch {
    // If we can't even read the stats back, don't block on a retry —
    // the file write itself already succeeded or the outer catch handles it.
    return false;
  }
}
