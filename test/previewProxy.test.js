import test from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { rewritePageHtml, rewriteCssUrls } from '../src/previewProxy.js';

test('rewritePageHtml rewrites relative href/src to /api/preview/asset', async () => {
  const html = `<html><head><link rel="stylesheet" href="/styles.css"></head>
<body><img src="images/hero.png"><a href="/about.html">About</a></body></html>`;
  const out = await rewritePageHtml(html, 'https://example.com/index.html');
  assert.match(out, /href="\/api\/preview\/asset\?url=https%3A%2F%2Fexample\.com%2Fstyles\.css"/);
  assert.match(out, /src="\/api\/preview\/asset\?url=https%3A%2F%2Fexample\.com%2Fimages%2Fhero\.png"/);
  assert.match(out, /href="\/api\/preview\/asset\?url=https%3A%2F%2Fexample\.com%2Fabout\.html"/);
});

test('rewritePageHtml stashes the original absolute URL on rewritten anchors', async () => {
  const html = `<a href="/about.html">About</a>`;
  const out = await rewritePageHtml(html, 'https://example.com/index.html');
  assert.match(out, /href="\/api\/preview\/asset\?url=https%3A%2F%2Fexample\.com%2Fabout\.html"/);
  assert.match(out, /data-preview-original-href="https:\/\/example\.com\/about\.html"/);
  const $ = cheerio.load(out);
  const a = $('a');
  assert.equal(a.attr('data-preview-original-href'), 'https://example.com/about.html');
});

test('rewritePageHtml leaves anchor/mailto/javascript links untouched', async () => {
  const html = `<a href="#top">Top</a><a href="mailto:a@b.com">Mail</a><a href="javascript:void(0)">JS</a>`;
  const out = await rewritePageHtml(html, 'https://example.com/index.html');
  assert.match(out, /href="#top"/);
  assert.match(out, /href="mailto:a@b\.com"/);
  assert.match(out, /href="javascript:void\(0\)"/);
});

test('rewritePageHtml injects the nav bridge script before </body>', async () => {
  const html = `<html><body><p>hi</p></body></html>`;
  const out = await rewritePageHtml(html, 'https://example.com/');
  assert.match(out, /preview-nav[\s\S]*<\/body>/);
});

test('rewritePageHtml does not relay scroll — each device scrolls on its own', async () => {
  const html = `<html><body><p>hi</p></body></html>`;
  const out = await rewritePageHtml(html, 'https://example.com/');
  // The injected bridge must not post or apply cross-device scroll messages.
  assert.doesNotMatch(out, /postMessage\(\s*\{\s*type:\s*'preview-scroll'/);
  assert.doesNotMatch(out, /'preview-scroll-to'/);
});

test('rewriteCssUrls rewrites unquoted, single-, and double-quoted url()', () => {
  const css = `a{background:url(/bg.png)} b{background:url('bg2.png')} c{background:url("https://cdn.example.com/x.png")}`;
  const out = rewriteCssUrls(css, 'https://example.com/styles/main.css');
  assert.match(out, /url\(\/api\/preview\/asset\?url=https%3A%2F%2Fexample\.com%2Fbg\.png\)/);
  assert.match(out, /url\(\/api\/preview\/asset\?url=https%3A%2F%2Fexample\.com%2Fstyles%2Fbg2\.png\)/);
  assert.match(out, /url\(\/api\/preview\/asset\?url=https%3A%2F%2Fcdn\.example\.com%2Fx\.png\)/);
});

test('rewritePageHtml hides scrollbars inside the device frames', async () => {
  const html = `<html><head></head><body><p>hi</p></body></html>`;
  const out = await rewritePageHtml(html, 'https://example.com/');
  assert.match(out, /scrollbar-width:\s*none/);
  assert.match(out, /::-webkit-scrollbar/);
});

// A device iframe that navigated to the app's own origin rendered Screenshot
// Taker inside its own device frames. Links the site's JS adds after proxying
// resolve against the app, so the bridge must recover the real target from the
// proxied href's `url` param and refuse same-origin navigation outright.
test('rewritePageHtml nav bridge recovers the real target and refuses same-origin navigation', async () => {
  const html = `<html><body><a href="/page.html">Next</a></body></html>`;
  const out = await rewritePageHtml(html, 'https://example.com/');
  assert.match(out, /url=\(\[\^&\]\+\)|url=\(/, 'bridge should parse the url query param out of proxied hrefs');
  assert.match(out, /origin === location\.origin/, 'bridge should refuse to navigate to its own origin');
});
