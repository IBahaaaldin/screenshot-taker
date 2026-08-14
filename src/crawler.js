import { chromium } from 'playwright';

export async function crawlSite(startUrl, { maxPages = 50 } = {}) {
  const origin = new URL(startUrl).origin;
  const visited = new Set();
  const queue = [normalize(startUrl)];
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    while (queue.length > 0 && visited.size < maxPages) {
      const url = queue.shift();
      if (visited.has(url)) continue;
      visited.add(url);

      await page.goto(url, { waitUntil: 'load' }).catch((err) => {
        console.error(`[crawler] failed to load ${url}: ${err.message}`);
      });
      const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));

      for (const href of hrefs) {
        if (!href) continue;
        let absolute;
        try {
          absolute = new URL(href, url).href;
        } catch {
          continue;
        }
        if (new URL(absolute).origin !== origin) continue;
        const clean = normalize(absolute);
        if (!visited.has(clean) && !queue.includes(clean)) {
          queue.push(clean);
        }
      }
    }
    await page.close();
  } finally {
    await browser.close();
  }
  return dedupeTemplatePages(Array.from(visited).slice(0, maxPages));
}

function normalize(url) {
  const u = new URL(url);
  u.hash = '';
  return u.href;
}

// Sites with product/blog/category listings can have hundreds of near-
// identical detail pages (same template, different slug) — e.g.
// /products/liquid-detergent, /products/dish-wash, /products/bleach.
// Capturing every single one wastes time and clutters the gallery with
// duplicates. Pages nested 3+ levels deep are grouped by their parent
// path, keeping only the first one found per group. Shallow pages
// (depth <= 2, e.g. /about, /products) are never deduped — those are
// distinct top-level or listing pages, not templated detail pages.
export function dedupeTemplatePages(urls) {
  const seen = new Set();
  const kept = [];
  for (const url of urls) {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    if (segments.length < 3) {
      kept.push(url);
      continue;
    }
    const key = segments.slice(0, -1).join('/');
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(url);
  }
  return kept;
}
