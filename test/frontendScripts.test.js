import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createApp } from '../src/server.js';
import { startLocalServer } from '../src/localServer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'site');

// public/index.html loads preview.js and app.js as two plain classic
// <script> tags, not modules — their top-level `const`/`let` declarations
// share one global scope. A name collision between them (e.g. both
// declaring `const form`) throws a SyntaxError that silently kills BOTH
// scripts on page load, with no server-side test able to catch it, since
// nothing else actually loads the two files together in one page context.
// This guards against that class of bug recurring.
test('index.html loads preview.js and app.js together with no script errors', async (t) => {
  const outputRoot = await fs.mkdtemp(os.tmpdir() + '/frontend-scripts-test-');
  const app = createApp({ outputRoot });
  const server = app.listen(0);
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  // Point the live-preview auto-load at the local fixture site instead of
  // its real hardcoded default (a live external URL) — deterministic, and
  // doesn't depend on network access or a third-party site being up.
  const fixtureServer = await startLocalServer(fixtureDir);

  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await fixtureServer.close();
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const fixtureUrl = `${fixtureServer.url}/index.html`;
  await page.goto(`${base}/index.html?url=${encodeURIComponent(fixtureUrl)}`, { waitUntil: 'load' });

  // The 4 preview iframes are deliberately sandboxed without
  // allow-same-origin (see src/previewProxy.js), so a real target site's
  // own scripts touching localStorage/sessionStorage inside them throw a
  // SecurityError — Playwright surfaces that as a pageerror even though
  // it's an expected, harmless side effect of the sandboxing choice, not a
  // bug in our own scripts. Only fail on errors outside that known class —
  // in particular, a `<identifier> has already been declared` SyntaxError
  // is exactly what a preview.js/app.js top-level name collision produces,
  // and silently kills both scripts with no other test able to catch it.
  const unexpectedErrors = pageErrors.filter(
    (msg) => !/sandboxed|allow-same-origin/i.test(msg)
  );
  assert.deepEqual(unexpectedErrors, [], 'page must load with no uncaught script errors (excluding expected sandboxed-iframe storage access errors)');

  // Confirm both scripts actually executed (not just "no error thrown") by
  // checking a function each of them defines at top level.
  const globals = await page.evaluate(() => ({
    previewJsLoaded: typeof loadAll === 'function',
    appJsLoaded: typeof updateSourceFields === 'function',
  }));
  assert.equal(globals.previewJsLoaded, true, 'preview.js should have executed (loadAll defined)');
  assert.equal(globals.appJsLoaded, true, 'app.js should have executed (updateSourceFields defined)');
});

// The Record button used to send a module-level `currentPreviewUrl` variable
// that was only updated when the "Load preview" form was submitted. Typing a
// new URL into the field and clicking Record without submitting first —
// exactly what a user does — silently recorded whatever site was previously
// loaded (on first page load, the hardcoded default) instead of the URL
// actually in the box.
test('Record Video sends whatever URL is currently in the box, not the last loaded one', async (t) => {
  const outputRoot = await fs.mkdtemp(os.tmpdir() + '/record-url-test-');
  const app = createApp({ outputRoot });
  const server = app.listen(0);
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const fixtureServer = await startLocalServer(fixtureDir);

  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await fixtureServer.close();
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const page = await browser.newPage();
  const loadedUrl = `${fixtureServer.url}/index.html`;
  const typedUrl = `${fixtureServer.url}/about.html`;
  await page.goto(`${base}/index.html?url=${encodeURIComponent(loadedUrl)}`, { waitUntil: 'load' });

  // Simulate the exact user action: edit the field, but never click "Load
  // preview" — so any code path relying on the last-submitted URL sees the
  // stale one instead of this.
  await page.fill('#preview-url', typedUrl);

  const sentBody = await page.evaluate(async () => {
    let captured = null;
    const realFetch = window.fetch;
    window.fetch = async (url, opts) => {
      if (url === '/api/preview/record') {
        captured = JSON.parse(opts.body);
        // Avoid actually kicking off a real recording — resolve with a
        // shape the click handler can consume without throwing.
        return new Response(JSON.stringify({ downloadUrl: '/output/recordings/fake.mp4', durationMs: 4000 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return realFetch(url, opts);
    };
    document.getElementById('record-video-btn').click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    return captured;
  });

  assert.equal(sentBody?.url, typedUrl, 'Record should send the URL currently in the box, not the previously loaded one');
});

// The caption modal used to prefill from a client-side reimplementation of
// generateCaption that had drifted from the real one (no hook/hashtag
// variety, no siteName/heading collision guard). It now fetches from
// /api/caption/draft, the same generateCaption/generateCarouselCaption
// auto-posting uses — this confirms openCaptionModal actually calls that
// endpoint with the right kind/slug/slideCount rather than drafting locally.
test('openCaptionModal drafts from /api/caption/draft with the right params for single and carousel posts', async (t) => {
  const outputRoot = await fs.mkdtemp(os.tmpdir() + '/caption-draft-wiring-test-');
  const app = createApp({ outputRoot });
  const server = app.listen(0);
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const fixtureServer = await startLocalServer(fixtureDir);

  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await fixtureServer.close();
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const page = await browser.newPage();
  await page.goto(`${base}/index.html?url=${encodeURIComponent(`${fixtureServer.url}/index.html`)}`, { waitUntil: 'load' });

  const singleCall = await page.evaluate(async () => {
    let captured = null;
    const realFetch = window.fetch;
    window.fetch = async (url, opts) => {
      if (String(url).startsWith('/api/caption/draft')) {
        captured = url;
        return new Response(JSON.stringify({ caption: 'draft' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return realFetch(url, opts);
    };
    await openCaptionModal({ siteName: 'site', pageUrl: 'https://example.com/', kind: 'single', images: ['a.png'], slugForDraft: 'hero' });
    return captured;
  });
  const singleParams = new URL(singleCall, base).searchParams;
  assert.equal(singleParams.get('kind'), 'single');
  assert.equal(singleParams.get('slug'), 'hero');

  const carouselCall = await page.evaluate(async () => {
    let captured = null;
    const realFetch = window.fetch;
    window.fetch = async (url, opts) => {
      if (String(url).startsWith('/api/caption/draft')) {
        captured = url;
        return new Response(JSON.stringify({ caption: 'draft' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return realFetch(url, opts);
    };
    await openCaptionModal({ siteName: 'site', pageUrl: 'https://example.com/', kind: 'carousel', images: ['a.png', 'b.png'], slideCount: 2 });
    return captured;
  });
  const carouselParams = new URL(carouselCall, base).searchParams;
  assert.equal(carouselParams.get('kind'), 'carousel');
  assert.equal(carouselParams.get('slideCount'), '2');
});

// The device frames are content-box, so each bezel's border and its aluminium
// ring draw OUTSIDE the layout box. The stand and the laptop base are
// positioned as percentages of the stage, from the layout box — so unless they
// also clear that outer thickness they overlap the device they attach to. They
// did: the monitor's stand started 15px inside its own bottom bezel and the
// laptop's base cut 9px into the lid.
test('the desktop stand and laptop base meet their devices flush, not overlapping', async (t) => {
  const outputRoot = await fs.mkdtemp(os.tmpdir() + '/frame-joints-test-');
  const app = createApp({ outputRoot });
  const server = app.listen(0);
  const { port } = server.address();
  const fixtureServer = await startLocalServer(fixtureDir);

  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await fixtureServer.close();
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(
    `http://127.0.0.1:${port}/index.html?url=${encodeURIComponent(`${fixtureServer.url}/index.html`)}`,
    { waitUntil: 'load' }
  );

  const joints = await page.evaluate(() => {
    // A box-shadow never contributes to getBoundingClientRect, but the
    // aluminium enclosure ring IS drawn with one — so the visible bottom edge
    // of a device is its rect bottom plus that ring's spread.
    const visualBottom = (sel) => {
      const el = document.querySelector(sel);
      const ring = /(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/.exec(
        getComputedStyle(el).boxShadow
      );
      return el.getBoundingClientRect().bottom + (ring ? parseFloat(ring[4]) : 0);
    };
    const top = (sel) => document.querySelector(sel).getBoundingClientRect().top;
    return {
      desktopToNeck: top('.preview-frame-desktop-neck') - visualBottom('.preview-frame-desktop'),
      neckToFoot: top('.preview-frame-desktop-foot') - visualBottom('.preview-frame-desktop-neck'),
      laptopToDeck: top('.preview-frame-deck') - visualBottom('.preview-frame-laptop'),
    };
  });

  // A negative gap is the actual bug: the part is drawn on top of the device.
  // Small positive slack is unavoidable — browsers round border widths to whole
  // pixels while these offsets are continuous percentages — but it has to stay
  // well under a pixel or two or it reads as a seam.
  for (const [name, gap] of Object.entries(joints)) {
    assert.ok(gap >= -0.5, `${name} overlaps the device by ${(-gap).toFixed(2)}px`);
    assert.ok(gap <= 2.5, `${name} leaves a visible ${gap.toFixed(2)}px seam`);
  }
});

// A phone browser insets a page's CONTENT below the status bar, which is why a
// real Dynamic Island never lands on a site's own header. Two things went wrong
// here in turn: the preview first drew the island over a page that started at
// the top of the glass, putting a black pill through the logo of every site
// previewed; the fix for that reserved the strip by shrinking the iframe, which
// exposed the frame's own background above the page as a white band no real
// phone has. The inset belongs inside the page, where the site's own background
// paints it.
test('the phone insets the page inside itself, leaving no band above the site', async (t) => {
  const outputRoot = await fs.mkdtemp(os.tmpdir() + '/status-bar-test-');
  const app = createApp({ outputRoot });
  const server = app.listen(0);
  const { port } = server.address();
  const fixtureServer = await startLocalServer(fixtureDir);

  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await fixtureServer.close();
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(
    `http://127.0.0.1:${port}/index.html?url=${encodeURIComponent(`${fixtureServer.url}/index.html`)}`,
    { waitUntil: 'load' }
  );
  await page.waitForSelector('#preview-stage:not([hidden])', { timeout: 15000 });
  await page.waitForTimeout(2000);

  const layout = await page.evaluate(() => {
    const rect = (sel) => document.querySelector(sel).getBoundingClientRect();
    const frameEl = document.querySelector('.preview-frame-mobile');
    const mobileFrame = rect('.preview-frame-mobile');
    const mobilePage = rect('#preview-iframe-mobile');
    return {
      // Measured from the screen, not the frame's outer box: the frame's border
      // is the phone's bezel, which is meant to be there. What must not be
      // there is any of the frame's own background between bezel and page —
      // that is the white band. clientTop is exactly that border width.
      gapAbovePage: mobilePage.top - (mobileFrame.top + frameEl.clientTop),
      // Every device asks the proxy to inset only what its own status bar needs.
      mobileSrc: document.querySelector('#preview-iframe-mobile').src,
      desktopSrc: document.querySelector('#preview-iframe-desktop').src,
      // Nothing is inset from out here any more.
      mobileMargin: document.querySelector('#preview-iframe-mobile').style.marginTop || '',
    };
  });

  assert.ok(
    layout.gapAbovePage <= 1,
    `the frame shows a ${layout.gapAbovePage.toFixed(2)}px band above the page`
  );
  assert.equal(layout.mobileMargin, '', 'the phone must not be inset by shrinking its iframe');
  assert.match(layout.mobileSrc, /safeTop=59/, 'the phone should ask the proxy for its status bar');
  assert.doesNotMatch(layout.desktopSrc, /safeTop/, 'a device with no status bar asks for none');

  // The inset itself lands inside the page, and the island clears the content.
  const frame = page.frame({ url: (u) => u.href.includes('safeTop=59') });
  assert.ok(frame, 'the phone frame should be loaded through the proxy');
  const inPage = await frame.evaluate(() => ({
    bodyPadTop: getComputedStyle(document.body).paddingTop,
  }));
  assert.equal(inPage.bodyPadTop, '59px', "the page should inset its own content by the status bar");
});
