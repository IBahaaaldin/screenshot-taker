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
  return Array.from(visited).slice(0, maxPages);
}

function normalize(url) {
  const u = new URL(url);
  u.hash = '';
  return u.href;
}
