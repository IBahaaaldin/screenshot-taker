// src/sectionDetector.js
//
// Returns { slug, selector } per section. `selector` is a CSS path Playwright
// can locate and screenshot directly (page.locator(selector).screenshot()),
// which scrolls the element into view and captures its full bounding box in
// one shot — no manual viewport/clip math, so it isn't fooled by
// viewport-relative CSS (e.g. `min-height: 100vh`) growing every time we
// resize to try to fit the whole page in one shot.
// `selector: null` is a sentinel meaning "capture the full page" (fullPage
// screenshot), used by 'full-page' mode and the auto-detect fallback.
export async function detectSections(page, mode, selectors = []) {
  if (mode === 'selectors') {
    return detectBySelectors(page, selectors);
  }
  if (mode === 'full-page') {
    return [{ slug: 'section-0', selector: null }];
  }
  // mode === 'auto'
  const cssPaths = await page.evaluate(() => {
    const skip = new Set(['SCRIPT', 'STYLE', 'LINK', 'NOSCRIPT', 'META']);
    let roots = Array.from(document.body.children).filter((el) => !skip.has(el.tagName));
    if (roots.length === 1 && roots[0].children.length > 1) {
      roots = Array.from(roots[0].children).filter((el) => !skip.has(el.tagName));
    }

    function cssPath(el) {
      const segments = [];
      let node = el;
      while (node && node !== document.body && node.parentElement) {
        const index = Array.prototype.indexOf.call(node.parentElement.children, node) + 1;
        segments.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
        node = node.parentElement;
      }
      return `body > ${segments.join(' > ')}`;
    }

    return roots
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 50 && r.height > 50;
      })
      .map((el) => cssPath(el));
  });

  if (cssPaths.length === 0) {
    console.warn('[sectionDetector] No sections auto-detected, falling back to full-page mode');
    return [{ slug: 'section-0', selector: null }];
  }

  return cssPaths.map((selector, i) => ({ slug: `section-${i}`, selector }));
}

async function detectBySelectors(page, selectors) {
  const results = [];
  const seenSlugs = new Set();
  for (const selector of selectors) {
    const exists = await page.evaluate((sel) => Boolean(document.querySelector(sel)), selector);
    if (exists) {
      let slug = slugify(selector);
      if (seenSlugs.has(slug)) {
        const base = slug;
        let n = 2;
        while (seenSlugs.has(`${base}-${n}`)) {
          n += 1;
        }
        slug = `${base}-${n}`;
      }
      seenSlugs.add(slug);
      results.push({ slug, selector });
    }
  }
  return results;
}

function slugify(selector) {
  return selector
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}
