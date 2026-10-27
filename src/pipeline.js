import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { crawlSite } from './crawler.js';
import { captureAllViewports } from './screenshot.js';
import { buildComposite } from './composite.js';
import { splitLeftRight } from './splitCrop.js';
import { writeManifest } from './manifest.js';

export async function runPipeline(
  { startUrl, mode, selectors = [], siteName, outputRoot, maxPages = 50 },
  onProgress = () => {}
) {
  const siteOutputDir = path.join(outputRoot, siteName);
  const resolvedOutputRoot = path.resolve(outputRoot);
  const resolvedSiteOutputDir = path.resolve(siteOutputDir);
  if (!resolvedSiteOutputDir.startsWith(resolvedOutputRoot + path.sep)) {
    throw new Error(
      `Refusing to operate outside outputRoot: ${resolvedSiteOutputDir} is not within ${resolvedOutputRoot}`
    );
  }
  await fs.rm(siteOutputDir, { recursive: true, force: true });
  const browser = await chromium.launch();
  const manifest = { site: siteName, generatedAt: new Date().toISOString(), pages: [] };

  try {
    onProgress({ type: 'crawl-start', message: `Crawling ${startUrl}` });
    const pageUrls = await crawlSite(startUrl, { maxPages });
    const takenSlugs = new Set();

    for (const pageUrl of pageUrls) {
      onProgress({ type: 'page-start', message: `Processing ${pageUrl}` });

      const pageSlug = uniqueSlug(pageSlugFor(pageUrl), takenSlugs);
      const pageOutputDir = path.join(siteOutputDir, pageSlug);

      try {
        const viewportResults = await captureAllViewports(browser, pageUrl, {
          mode,
          selectors,
          outputDir: pageOutputDir,
        });

        const sections = await buildCompositesForPage(browser, pageOutputDir, viewportResults, onProgress);
        manifest.pages.push({ url: pageUrl, sections });

        onProgress({ type: 'page-done', message: `Finished ${pageUrl}` });
      } catch (err) {
        console.error(`Failed to process page ${pageUrl}:`, err);
        onProgress({ type: 'page-error', message: `Failed to process ${pageUrl}: ${err.message}` });
      }
    }
  } finally {
    await browser.close();
  }

  await writeManifest(siteOutputDir, manifest);
  onProgress({ type: 'run-done', message: 'Run complete' });
  return manifest;
}

export async function buildCompositesForPage(browser, pageOutputDir, viewportResults, onProgress) {
  const slugs = new Set();
  for (const { sections } of viewportResults) {
    for (const { slug } of sections) slugs.add(slug);
  }

  const sections = [];
  for (const slug of slugs) {
    const imagesByViewport = {};
    for (const { viewport, sections: vSections } of viewportResults) {
      const match = vSections.find((s) => s.slug === slug);
      if (match) imagesByViewport[viewport] = match.path;
    }

    let compositePath = null;
    let splitCrop = null;
    if (Object.keys(imagesByViewport).length > 0) {
      // Full composites and split crops are two different deliverables (a
      // single-image post vs. a two-slide carousel) — keeping them in one
      // flat folder meant picking images for a carousel required skipping
      // over every full-size composite mixed in alongside the halves.
      const compositesDir = path.join(pageOutputDir, 'composites');
      const fullDir = path.join(compositesDir, 'full');
      const splitDir = path.join(compositesDir, 'split');
      const outputPath = path.join(fullDir, `${slug}-composite.png`);
      compositePath = await buildComposite(browser, imagesByViewport, outputPath);
      onProgress({ type: 'composite-done', message: `Composite ready: ${slug}` });

      try {
        splitCrop = await splitLeftRight(compositePath, splitDir);
        onProgress({ type: 'split-crop-done', message: `Split crop ready: ${slug}` });
      } catch (err) {
        onProgress({ type: 'split-crop-error', message: `Split crop failed for ${slug}: ${err.message}` });
      }
    }

    sections.push({ slug, viewports: imagesByViewport, composite: compositePath, splitCrop });
  }

  return sections;
}

// The query string is part of the slug, not dropped from it. A crawl commonly
// picks up both `/products` and `/products?cat=lighting` — genuinely different
// pages — and folding them onto one folder name meant the second capture
// overwrote the first, while the manifest still listed both pointing at the
// same files.
export function pageSlugFor(pageUrl) {
  const { pathname, search } = new URL(pageUrl);
  const base = `${pathname}${search}`.replace(/^\/+|\/+$/g, '') || 'index';
  return base.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'index';
}

// Two different URLs can still normalise to the same slug (every character
// that isn't a letter or digit collapses to a hyphen). Suffix the later ones
// rather than let them share a folder.
function uniqueSlug(slug, taken) {
  if (!taken.has(slug)) {
    taken.add(slug);
    return slug;
  }
  let n = 2;
  while (taken.has(`${slug}-${n}`)) n += 1;
  const unique = `${slug}-${n}`;
  taken.add(unique);
  return unique;
}
