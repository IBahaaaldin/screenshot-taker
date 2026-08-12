// src/screenshot.js
import fs from 'node:fs/promises';
import path from 'node:path';
import { VIEWPORTS } from './viewports.js';
import { detectSections } from './sectionDetector.js';

const INITIAL_VIEWPORT_HEIGHT = 1000;

export async function captureAllViewports(browser, pageUrl, { mode, selectors = [], outputDir }) {
  const results = [];

  for (const viewport of VIEWPORTS) {
    const viewportDir = path.join(outputDir, viewport.name);
    await fs.mkdir(viewportDir, { recursive: true });

    const sections = await captureOneViewport(browser, pageUrl, viewport, mode, selectors, viewportDir);
    results.push({ viewport: viewport.name, sections });
  }

  return results;
}

async function captureOneViewport(browser, pageUrl, viewport, mode, selectors, viewportDir) {
  const page = await browser.newPage();
  try {
    await page.setViewportSize({ width: viewport.width, height: INITIAL_VIEWPORT_HEIGHT });
    const loaded = await gotoWithRetry(page, pageUrl);
    if (!loaded) {
      return [];
    }

    await triggerScrollRevealAnimations(page);

    const written = [];
    try {
      const sections = await detectSections(page, mode, selectors);
      for (const section of sections) {
        const filePath = path.join(viewportDir, `${section.slug}.png`);
        try {
          if (section.selector === null) {
            await page.screenshot({ path: filePath, fullPage: true });
          } else {
            // Locator screenshots scroll the element into view and capture
            // its full bounding box in one shot, so they aren't fooled by
            // viewport-relative CSS (e.g. `min-height: 100vh`) that would
            // otherwise change as the viewport resizes. A short explicit
            // timeout keeps a hidden/zero-size selector match (e.g. a
            // deliberately-targeted modal or accordion panel) a fast,
            // contained failure instead of waiting out Playwright's ~30s
            // default actionability timeout per section per viewport.
            await page.locator(section.selector).screenshot({ path: filePath, timeout: 5000 });
          }
          written.push({ slug: section.slug, path: filePath });
        } catch (err) {
          console.error(`[screenshot] failed to capture section "${section.slug}" for ${pageUrl} at ${viewport.name}: ${err.message}`);
        }
      }
    } catch (err) {
      console.error(`[screenshot] failed to detect sections for ${pageUrl} at ${viewport.name}: ${err.message}`);
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
