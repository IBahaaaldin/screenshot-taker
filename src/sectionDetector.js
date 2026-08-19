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
    const kids = (el) => Array.from(el.children).filter((c) => !skip.has(c.tagName));

    // A section has to be tall enough to be worth a post. A site's <nav> is
    // typically 60-80px; real content sections run 300-900px. 150px clears
    // navs and utility bars without touching real sections.
    const MIN_SECTION_HEIGHT = 150;
    // Above this, an element is a page wrapper rather than one section, so we
    // look inside it for the real sections. Framework sites (Next/Nuxt/etc.)
    // wrap everything in <main>, sometimes several divs deep — on a real site
    // that made "section-0" a single 15,422px capture of the whole page, of
    // which only the top ~7% was visible in the device frame.
    const WRAPPER_HEIGHT = 2500;
    const MAX_DEPTH = 6;

    const tall = (el) => el.getBoundingClientRect().height;
    const isSection = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 50 && r.height >= MIN_SECTION_HEIGHT;
    };

    // Replace any wrapper with the sections inside it, repeatedly. A wrapper is
    // only opened when doing so actually yields more than one section —
    // otherwise a tall single section would be shredded into its own contents.
    function expand(elements, depth) {
      if (depth >= MAX_DEPTH) return elements;
      const out = [];
      let changed = false;
      for (const el of elements) {
        const children = kids(el).filter(isSection);
        if (tall(el) > WRAPPER_HEIGHT && children.length > 1) {
          out.push(...children);
          changed = true;
        } else if (tall(el) > WRAPPER_HEIGHT && children.length === 1) {
          // A lone wrapper child (e.g. <main> > <div>) — descend through it
          // without treating it as a section boundary.
          out.push(children[0]);
          changed = true;
        } else {
          out.push(el);
        }
      }
      return changed ? expand(out, depth + 1) : out;
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

    const roots = Array.from(document.body.children).filter((el) => !skip.has(el.tagName));
    return expand(roots.filter(isSection), 0).map((el) => cssPath(el));
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
