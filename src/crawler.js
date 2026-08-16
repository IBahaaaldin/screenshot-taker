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
      // A page can navigate again right after 'load' (a client-side
      // redirect, an analytics-triggered reload, etc.), destroying the
      // execution context mid-eval. That must not abort the whole crawl —
      // just skip link discovery for this one page and keep going.
      const hrefs = await page
        .$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')))
        .catch((err) => {
          console.error(`[crawler] failed to extract links from ${url}: ${err.message}`);
          return [];
        });

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
// /products/liquid-detergent, /products/dish-wash, /products/bleach, or
// (shallower, but the same shape) /customers/openai, /customers/ramp,
// /changelog/2026-08-13-team-initiatives. Capturing every single one
// wastes time and clutters the gallery with duplicates. Pages nested 2+
// levels deep are grouped by their parent path, keeping only the first
// one found per group. Only depth-1 pages (e.g. /about, /products, the
// listing page itself) are never deduped — those are each other's
// siblings under an empty/shared parent key and must stay distinct.
export function dedupeTemplatePages(urls) {
  const seen = new Set();
  const kept = [];
  for (const url of urls) {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    if (segments.length < 2) {
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
