import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalServer } from '../src/localServer.js';
import { crawlSite } from '../src/crawler.js';

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
