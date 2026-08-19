import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startLocalServer } from '../src/localServer.js';
import { hideCookieBanners } from '../src/cookieBanner.js';
import { rewritePageHtml } from '../src/previewProxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'site');

// A consent banner is page chrome that otherwise lands in every capture — on a
// real run it sat across the bottom of all four device screens in every post.
test('hides a consent banner and a vendor widget before capture', async (t) => {
  const server = await startLocalServer(fixtureDir);
  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await server.close();
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${server.url}/cookie-banner.html`, { waitUntil: 'load' });

  const visible = (sel) =>
    page.evaluate((s) => {
      const el = document.querySelector(s);
      return el ? getComputedStyle(el).display !== 'none' : false;
    }, sel);

  assert.equal(await visible('#cookie-bar'), true, 'banner should start visible');
  assert.equal(await visible('.cc-window'), true, 'vendor widget should start visible');

  const hidden = await hideCookieBanners(page);

  assert.equal(await visible('#cookie-bar'), false, 'the consent banner should be hidden');
  assert.equal(await visible('.cc-window'), false, 'the vendor widget should be hidden');
  assert.ok(hidden.length >= 2, `should report what it hid, got ${JSON.stringify(hidden)}`);
});

// The guard that matters: a sticky nav linking to a /cookies policy page hits
// the "mentions cookies" test on its own. Requiring a dismiss control too keeps
// the site's navigation — and its real content — intact.
test('leaves a sticky nav that merely links to a cookies page alone', async (t) => {
  const server = await startLocalServer(fixtureDir);
  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await server.close();
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${server.url}/cookie-banner.html`, { waitUntil: 'load' });
  await hideCookieBanners(page);

  const state = await page.evaluate(() => ({
    header: getComputedStyle(document.querySelector('header')).display,
    cookiesLink: !!document.querySelector('a[href="/cookies"]'),
    hero: getComputedStyle(document.querySelector('#hero')).display,
    features: getComputedStyle(document.querySelector('#features')).display,
  }));

  assert.notEqual(state.header, 'none', 'the sticky nav must survive');
  assert.ok(state.cookiesLink, 'the /cookies link must survive');
  assert.notEqual(state.hero, 'none', 'content sections must survive');
  assert.notEqual(state.features, 'none', 'content sections must survive');
});

test('never hides an element that wraps the page content', async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  // A full-viewport fixed wrapper containing <main> — cookie words and a
  // dismiss control inside must not blank the whole capture.
  await page.setContent(`<!doctype html><html><body style="margin:0">
    <div style="position:fixed;inset:0">
      <main><section style="height:900px">Real content</section></main>
      <p>cookie consent</p><button>Accept</button>
    </div>
  </body></html>`);
  await hideCookieBanners(page);
  const mainVisible = await page.evaluate(
    () => getComputedStyle(document.querySelector('main')).display !== 'none'
      && document.querySelector('main').getBoundingClientRect().height > 100
  );
  assert.ok(mainVisible, 'page content must never be hidden');
});

test('the live preview injects the same banner hiding, so it matches the export', async () => {
  const out = await rewritePageHtml('<html><body><p>hi</p></body></html>', 'https://example.com/');
  assert.match(out, /hideCookieBanners/);
});
