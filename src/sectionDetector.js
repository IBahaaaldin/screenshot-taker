// src/sectionDetector.js
export async function detectSections(page, mode, selectors = []) {
  if (mode === 'selectors') {
    return detectBySelectors(page, selectors);
  }
  if (mode === 'full-page') {
    return [await detectFullPage(page)];
  }
  // mode === 'auto'
  const boxes = await page.evaluate(() => {
    const skip = new Set(['SCRIPT', 'STYLE', 'LINK', 'NOSCRIPT', 'META']);
    let roots = Array.from(document.body.children).filter((el) => !skip.has(el.tagName));
    if (roots.length === 1 && roots[0].children.length > 1) {
      roots = Array.from(roots[0].children).filter((el) => !skip.has(el.tagName));
    }
    return roots
      .map((el) => el.getBoundingClientRect())
      .map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }))
      .filter((r) => r.width > 50 && r.height > 50);
  });

  if (boxes.length === 0) {
    return [await detectFullPage(page)];
  }

  return boxes.map((box, i) => ({ slug: `section-${i}`, ...box }));
}

async function detectBySelectors(page, selectors) {
  const results = [];
  for (const selector of selectors) {
    const box = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, selector);
    if (box) {
      results.push({ slug: slugify(selector), ...box });
    }
  }
  return results;
}

async function detectFullPage(page) {
  const size = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));
  return { slug: 'section-0', x: 0, y: 0, width: size.width, height: size.height };
}

function slugify(selector) {
  return selector
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}
