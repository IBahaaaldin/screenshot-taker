import path from 'node:path';
import { chromium } from 'playwright';
import { crawlSite } from './crawler.js';
import { captureAllViewports } from './screenshot.js';
import { buildComposite } from './composite.js';
import { writeManifest } from './manifest.js';

export async function runPipeline(
  { startUrl, mode, selectors = [], siteName, outputRoot, maxPages = 50 },
  onProgress = () => {}
) {
  const siteOutputDir = path.join(outputRoot, siteName);
  const browser = await chromium.launch();
  const manifest = { site: siteName, generatedAt: new Date().toISOString(), pages: [] };

  try {
    onProgress({ type: 'crawl-start', message: `Crawling ${startUrl}` });
    const pageUrls = await crawlSite(startUrl, { maxPages });

    for (const pageUrl of pageUrls) {
      onProgress({ type: 'page-start', message: `Processing ${pageUrl}` });

      const pageSlug = pageSlugFor(pageUrl);
      const pageOutputDir = path.join(siteOutputDir, pageSlug);
      const viewportResults = await captureAllViewports(browser, pageUrl, {
        mode,
        selectors,
        outputDir: pageOutputDir,
      });

      const sections = await buildCompositesForPage(browser, pageOutputDir, viewportResults, onProgress);
      manifest.pages.push({ url: pageUrl, sections });

      onProgress({ type: 'page-done', message: `Finished ${pageUrl}` });
    }
  } finally {
    await browser.close();
  }

  await writeManifest(siteOutputDir, manifest);
  onProgress({ type: 'run-done', message: 'Run complete' });
  return manifest;
}

async function buildCompositesForPage(browser, pageOutputDir, viewportResults, onProgress) {
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
    if (Object.keys(imagesByViewport).length > 0) {
      const outputPath = path.join(pageOutputDir, 'composites', `${slug}-composite.png`);
      compositePath = await buildComposite(browser, imagesByViewport, outputPath);
      onProgress({ type: 'composite-done', message: `Composite ready: ${slug}` });
    }

    sections.push({ slug, viewports: imagesByViewport, composite: compositePath });
  }

  return sections;
}

function pageSlugFor(pageUrl) {
  const { pathname } = new URL(pageUrl);
  const base = pathname.replace(/^\/+|\/+$/g, '') || 'index';
  return base.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase() || 'index';
}
