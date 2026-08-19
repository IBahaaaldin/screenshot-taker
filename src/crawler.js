import { chromium } from 'playwright';

// Links to files that aren't web pages. Following these produced genuinely
// broken output: a linked PDF got "captured" as a page (Chromium renders it in
// its own PDF viewer), and resolving a relative link against that PDF's URL
// invented a doubled path (/cv/cv/file.pdf) that 404'd and was then captured
// as a page of its own — a mockup of a "404" error screen.
const NON_PAGE_EXTENSIONS = new Set([
  '.pdf', '.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.bz2',
  '.dmg', '.pkg', '.exe', '.msi', '.deb', '.rpm', '.apk',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.csv', '.rtf',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif', '.ico', '.bmp', '.tiff',
  '.mp4', '.webm', '.mov', '.avi', '.mkv', '.mp3', '.wav', '.ogg', '.flac', '.m4a',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.json', '.xml', '.rss', '.atom', '.txt', '.md', '.yaml', '.yml',
]);

export function isLikelyPageUrl(url) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  const lastSegment = pathname.split('/').pop() || '';
  const dot = lastSegment.lastIndexOf('.');
  if (dot <= 0) return true; // no extension — treat as a page (/about, /, /docs/)
  return !NON_PAGE_EXTENSIONS.has(lastSegment.slice(dot).toLowerCase());
}

export async function crawlSite(startUrl, { maxPages = 50 } = {}) {
  const origin = new URL(startUrl).origin;
  const visited = new Set();
  // Only pages that actually loaded as HTML end up here. `visited` still
  // records everything tried, so a bad URL is never retried.
  const pages = [];
  const queue = [normalize(startUrl)];
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    while (queue.length > 0 && visited.size < maxPages) {
      const url = queue.shift();
      if (visited.has(url)) continue;
      visited.add(url);

      let response = null;
      try {
        response = await page.goto(url, { waitUntil: 'load' });
      } catch (err) {
        console.error(`[crawler] failed to load ${url}: ${err.message}`);
      }

      // Only exclude when we positively know the page is not usable — a null
      // response (e.g. a same-document navigation) is not evidence of failure.
      if (response) {
        const status = response.status();
        if (status >= 400) {
          console.error(`[crawler] skipping ${url}: HTTP ${status}`);
          continue;
        }
        const contentType = response.headers()['content-type'] || '';
        if (contentType && !/html/i.test(contentType)) {
          console.error(`[crawler] skipping ${url}: not HTML (${contentType.split(';')[0]})`);
          continue;
        }
      }

      pages.push(url);
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
        if (!isLikelyPageUrl(absolute)) continue;
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
  return dedupeTemplatePages(pages.slice(0, maxPages));
}

function normalize(url) {
  const u = new URL(url);
  u.hash = '';
  return u.href;
}

// A leading locale segment — /en, /en-US, /fr/... — is routing, not structure.
// Counting it as a path level made every top-level page on a localized site
// look like a template detail page: /en/about, /en/products, /en/contact and
// /en/certifications all reduced to the parent key "en" and collapsed into a
// single kept page. On a real site that meant 18 pages found and only 3 kept.
const LOCALE_SEGMENT_RE = /^[a-z]{2}(-[a-z0-9]{2,4})?$/i;

function structuralSegments(pathname) {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length > 1 && LOCALE_SEGMENT_RE.test(segments[0])) {
    return segments.slice(1);
  }
  return segments;
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
    const segments = structuralSegments(new URL(url).pathname);
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
