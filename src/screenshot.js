// src/screenshot.js
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { VIEWPORTS } from './viewports.js';
import { detectSections } from './sectionDetector.js';
import { hideCookieBanners } from './cookieBanner.js';
import { measureSectionBox, prepareForCapture, revealParked } from './pageReady.js';

const INITIAL_VIEWPORT_HEIGHT = 1000;
// Locator screenshots scroll the section into view themselves, which is the
// moment a scroll-reveal fires. Animation durations are already zeroed by the
// settle pass, so this only has to cover the observer callback and one paint.
const SECTION_SETTLE_MS = 120;
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
    // Before detection, so a fixed consent banner or a modal is never mistaken
    // for a section of its own — and so that detection measures the page at the
    // height it settles at, not the collapsed height it has while every
    // scroll-reveal is still parked at opacity 0.
    await hideCookieBanners(page);
    await prepareForCapture(page);
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

    await hideCookieBanners(page);
    // Sticky/fixed chrome is hidden for section captures only. A section
    // screenshot is the section's own box, and a sticky header parked on top of
    // it belongs to neither. A full-page capture is a different deliverable —
    // there the header is genuinely part of the picture, painted once at the
    // top, so it stays.
    const sectionMode = sections.some((section) => section.selector !== null);
    await prepareForCapture(page, { hideChrome: sectionMode });
    await hideCookieBanners(page);

    const written = [];
    try {
      for (const section of sections) {
        const filePath = path.join(viewportDir, `${section.slug}.png`);
        try {
          let clip = null;
          if (section.selector !== null) {
            // Scroll it in and let its own reveal fire before photographing it,
            // rather than letting the locator screenshot scroll and shoot in the
            // same tick.
            await scrollSectionIntoView(page, section.selector);
            await page.waitForTimeout(SECTION_SETTLE_MS);
            clip = await measureSectionBox(page, section.selector);
          }

          const shoot = () => {
            if (section.selector === null) {
              return page.screenshot({ path: filePath, fullPage: true });
            }
            if (clip) {
              // The section has something hanging over its edge on purpose, so
              // photograph the grown box instead. `fullPage` here is what makes
              // the clip document-relative rather than viewport-relative, so it
              // works for a section further down the page than one screen.
              return page.screenshot({ path: filePath, fullPage: true, clip });
            }
            // Locator screenshots scroll the element into view and capture
            // its full bounding box in one shot, so they aren't fooled by
            // viewport-relative CSS (e.g. `min-height: 100vh`) that would
            // otherwise change as the viewport resizes. A short explicit
            // timeout keeps a hidden/zero-size selector match (e.g. a
            // deliberately-targeted modal or accordion panel) a fast,
            // contained failure instead of waiting out Playwright's ~30s
            // default actionability timeout per section per viewport.
            return page.locator(section.selector).screenshot({ path: filePath, timeout: 5000 });
          };

          await shoot();
          if (await isNearSolidColor(filePath)) {
            // A near-uniform capture usually means a reveal that never fired —
            // the element is still at opacity 0 over its own background. Force
            // it before spending the retry.
            await revealParked(page);
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

async function scrollSectionIntoView(page, selector) {
  try {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) el.scrollIntoView({ block: 'center', behavior: 'auto' });
    }, selector);
  } catch {
    // Best-effort. If the selector is gone the locator screenshot below
    // reports it properly.
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
