import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalServer } from '../src/localServer.js';
import { crawlSite, dedupeTemplatePages } from '../src/crawler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'site');

test('crawlSite discovers all same-domain pages from the fixture site', async () => {
  const server = await startLocalServer(fixtureDir);
  try {
    const pages = await crawlSite(`${server.url}/index.html`);
    const names = pages.map((u) => new URL(u).pathname).sort();
    assert.deepEqual(names, ['/about.html', '/contact.html', '/index.html']);
  } finally {
    await server.close();
  }
});

test('crawlSite does not abort the whole crawl when one page\'s link extraction fails', async () => {
  const server = await startLocalServer(fixtureDir);
  try {
    // crawler-flaky.html's own link extraction always throws (simulating a
    // real site whose execution context gets destroyed mid-eval), but it's
    // still reached and visited, and the sibling page linked from the same
    // start page is still discovered — the crawl must not abort entirely.
    const pages = await crawlSite(`${server.url}/crawler-start.html`);
    const names = pages.map((u) => new URL(u).pathname).sort();
    // about.html itself links onward to contact.html/index.html, so those
    // are reached too — the key assertion is crawler-flaky.html appears
    // (visited despite its own extraction failure) and the crawl didn't
    // abort before discovering everything reachable around it.
    assert.deepEqual(names, [
      '/about.html',
      '/contact.html',
      '/crawler-flaky.html',
      '/crawler-start.html',
      '/index.html',
    ]);
  } finally {
    await server.close();
  }
});

test('crawlSite respects maxPages cap', async () => {
  const server = await startLocalServer(fixtureDir);
  try {
    const pages = await crawlSite(`${server.url}/index.html`, { maxPages: 1 });
    assert.equal(pages.length, 1);
  } finally {
    await server.close();
  }
});

test('dedupeTemplatePages keeps shallow pages (depth <= 1) untouched', () => {
  const urls = [
    'https://example.com/',
    'https://example.com/about',
    'https://example.com/products',
    'https://example.com/contact',
  ];
  assert.deepEqual(dedupeTemplatePages(urls), urls);
});

test('dedupeTemplatePages keeps only the first page per parent-path group at depth 3+', () => {
  const urls = [
    'https://example.com/en/products/liquid-detergent',
    'https://example.com/en/products/dish-wash',
    'https://example.com/en/products/bleach',
    'https://example.com/en/categories/laundry',
    'https://example.com/en/categories/kitchen',
  ];
  assert.deepEqual(dedupeTemplatePages(urls), [
    'https://example.com/en/products/liquid-detergent',
    'https://example.com/en/categories/laundry',
  ]);
});

test('dedupeTemplatePages does not collapse distinct listing pages with their own detail pages', () => {
  const urls = [
    'https://example.com/en/products',
    'https://example.com/en/products/liquid-detergent',
    'https://example.com/en/products/dish-wash',
  ];
  assert.deepEqual(dedupeTemplatePages(urls), [
    'https://example.com/en/products',
    'https://example.com/en/products/liquid-detergent',
  ]);
});

test('dedupeTemplatePages keeps only the first page per parent-path group at depth 2 (e.g. /customers/<name>)', () => {
  const urls = [
    'https://linear.app/customers/openai',
    'https://linear.app/customers/ramp',
    'https://linear.app/customers/opendoor',
    'https://linear.app/changelog/2026-08-13-team-initiatives',
    'https://linear.app/changelog/2026-07-30-coding-sessions-on-mobile',
  ];
  assert.deepEqual(dedupeTemplatePages(urls), [
    'https://linear.app/customers/openai',
    'https://linear.app/changelog/2026-08-13-team-initiatives',
  ]);
});

test('dedupeTemplatePages does not collapse distinct depth-1 pages sharing an empty parent', () => {
  const urls = [
    'https://linear.app/customers',
    'https://linear.app/changelog',
    'https://linear.app/docs',
    'https://linear.app/login',
  ];
  assert.deepEqual(dedupeTemplatePages(urls), urls);
});

// A real crawl of the portfolio produced mockups of a PDF and of a "404" error
// screen: the linked CV .pdf was followed (Chromium renders it in its own
// viewer), and a relative link resolved against that PDF's URL invented a
// doubled path that 404'd and got captured too.
test('crawlSite skips links to files that are not web pages', async (t) => {
  const server = await startLocalServer(fixtureDir);
  t.after(() => server.close());

  const pages = await crawlSite(`${server.url}/crawler-badlinks.html`, { maxPages: 20 });

  for (const ext of ['.pdf', '.png', '.json', '.zip']) {
    assert.ok(
      !pages.some((u) => u.endsWith(ext)),
      `crawl must not include ${ext} links, got: ${pages.join(', ')}`
    );
  }
  assert.ok(
    pages.some((u) => u.endsWith('/crawler-badlinks-real.html')),
    `the genuine HTML link should still be crawled, got: ${pages.join(', ')}`
  );
});

test('crawlSite drops pages that respond 404 instead of capturing the error page', async (t) => {
  const server = await startLocalServer(fixtureDir);
  t.after(() => server.close());

  const pages = await crawlSite(`${server.url}/crawler-badlinks.html`, { maxPages: 20 });

  assert.ok(
    !pages.some((u) => u.includes('definitely-missing-page')),
    `a 404 must not be returned as a page, got: ${pages.join(', ')}`
  );
});

test('crawlSite still returns the start page when it loads fine', async (t) => {
  const server = await startLocalServer(fixtureDir);
  t.after(() => server.close());

  const pages = await crawlSite(`${server.url}/crawler-badlinks.html`, { maxPages: 20 });
  assert.ok(
    pages.some((u) => u.endsWith('/crawler-badlinks.html')),
    `the start page should be included, got: ${pages.join(', ')}`
  );
});
