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

test('crawlSite respects maxPages cap', async () => {
  const server = await startLocalServer(fixtureDir);
  try {
    const pages = await crawlSite(`${server.url}/index.html`, { maxPages: 1 });
    assert.equal(pages.length, 1);
  } finally {
    await server.close();
  }
});

test('dedupeTemplatePages keeps shallow pages (depth <= 2) untouched', () => {
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
