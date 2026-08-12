// src/screenshot.js
import fs from 'node:fs/promises';
import path from 'node:path';
import { VIEWPORTS } from './viewports.js';
import { detectSections } from './sectionDetector.js';

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
    await page.setViewportSize({ width: viewport.width, height: 800 });
    const loaded = await gotoWithRetry(page, pageUrl);
    if (!loaded) {
      return [];
    }

    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: viewport.width, height: Math.max(scrollHeight, 800) });

    const sections = await detectSections(page, mode, selectors);
    const written = [];
    for (const section of sections) {
      const filePath = path.join(viewportDir, `${section.slug}.png`);
      await page.screenshot({
        path: filePath,
        clip: {
          x: Math.max(section.x, 0),
          y: Math.max(section.y, 0),
          width: Math.max(section.width, 1),
          height: Math.max(section.height, 1),
        },
      });
      written.push({ slug: section.slug, path: filePath });
    }
    return written;
  } finally {
    await page.close();
  }
}

async function gotoWithRetry(page, pageUrl) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 15000 });
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
