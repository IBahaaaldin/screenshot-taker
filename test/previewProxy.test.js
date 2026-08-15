import test from 'node:test';
import assert from 'node:assert/strict';
import { rewritePageHtml, rewriteCssUrls } from '../src/previewProxy.js';

test('rewritePageHtml rewrites relative href/src to /api/preview/asset', async () => {
  const html = `<html><head><link rel="stylesheet" href="/styles.css"></head>
<body><img src="images/hero.png"><a href="/about.html">About</a></body></html>`;
  const out = await rewritePageHtml(html, 'https://example.com/index.html');
  assert.match(out, /href="\/api\/preview\/asset\?url=https%3A%2F%2Fexample\.com%2Fstyles\.css"/);
  assert.match(out, /src="\/api\/preview\/asset\?url=https%3A%2F%2Fexample\.com%2Fimages%2Fhero\.png"/);
  assert.match(out, /href="\/api\/preview\/asset\?url=https%3A%2F%2Fexample\.com%2Fabout\.html"/);
});

test('rewritePageHtml leaves anchor/mailto/javascript links untouched', async () => {
  const html = `<a href="#top">Top</a><a href="mailto:a@b.com">Mail</a><a href="javascript:void(0)">JS</a>`;
  const out = await rewritePageHtml(html, 'https://example.com/index.html');
  assert.match(out, /href="#top"/);
  assert.match(out, /href="mailto:a@b\.com"/);
  assert.match(out, /href="javascript:void\(0\)"/);
});

test('rewritePageHtml injects the sync-bridge script before </body>', async () => {
  const html = `<html><body><p>hi</p></body></html>`;
  const out = await rewritePageHtml(html, 'https://example.com/');
  assert.match(out, /preview-nav[\s\S]*preview-scroll[\s\S]*<\/body>/);
});

test('rewriteCssUrls rewrites unquoted, single-, and double-quoted url()', () => {
  const css = `a{background:url(/bg.png)} b{background:url('bg2.png')} c{background:url("https://cdn.example.com/x.png")}`;
  const out = rewriteCssUrls(css, 'https://example.com/styles/main.css');
  assert.match(out, /url\(\/api\/preview\/asset\?url=https%3A%2F%2Fexample\.com%2Fbg\.png\)/);
  assert.match(out, /url\(\/api\/preview\/asset\?url=https%3A%2F%2Fexample\.com%2Fstyles%2Fbg2\.png\)/);
  assert.match(out, /url\(\/api\/preview\/asset\?url=https%3A%2F%2Fcdn\.example\.com%2Fx\.png\)/);
});
