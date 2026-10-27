import test from 'node:test';

// Must exceed PARKED_IN_VIEW_GRACE_MS in src/pageReady.js.
const PARKED_GRACE_WAIT_MS = 1700;
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startLocalServer } from '../src/localServer.js';
import {
  dismissModals,
  hidePageChrome,
  RESCUE_PARKED_IN_VIEW_FN,
  measureSectionBox,
  prepareForCapture,
  waitForSplash,
} from '../src/pageReady.js';
import { rewritePageHtml } from '../src/previewProxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'site');

async function openAnimatedFixture(t) {
  const server = await startLocalServer(fixtureDir);
  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await server.close();
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${server.url}/animated.html`, { waitUntil: 'load' });
  return page;
}

const styleOf = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      transform: cs.transform,
      overflow: cs.overflow,
    };
  }, selector);

// The splash is what turned several sections of a real export into nothing but
// the site's logo on white.
test('waits for an intro splash to clear before the page is treated as ready', async (t) => {
  const page = await openAnimatedFixture(t);

  assert.ok(await page.$('#splash'), 'the splash should still be up right after load');

  const result = await waitForSplash(page);

  assert.equal(result.sawSplash, true, 'should have noticed the splash');
  assert.equal(result.hidden, false, 'a splash that clears itself should not need hiding');
  assert.equal(await page.$('#splash'), null, 'the splash should be gone by the time it returns');
});

// The geo dialog landed in all four viewports of all eighteen pages of a real
// run, blurring every one of them.
test('hides a blocking modal, its scrim, and the scroll lock it installed', async (t) => {
  const page = await openAnimatedFixture(t);
  await waitForSplash(page);

  assert.equal((await styleOf(page, '#geo-modal')).display, 'grid', 'modal starts visible');
  assert.equal((await styleOf(page, 'body')).overflow, 'hidden', 'modal locks scrolling');

  const dismissed = await dismissModals(page);

  assert.ok(dismissed.length > 0, `should report what it dismissed, got ${JSON.stringify(dismissed)}`);
  assert.equal((await styleOf(page, '#geo-modal')).display, 'none', 'the modal should be hidden');
  assert.notEqual(
    (await styleOf(page, 'body')).overflow,
    'hidden',
    'the scroll lock should be released — otherwise nothing below the fold can be captured'
  );
});

// Landing mid-transition is what produced sections at opacity 0.33 and 0.66,
// and captures that came back blank.
test('settling leaves scroll-reveal content fully revealed and still', async (t) => {
  const page = await openAnimatedFixture(t);

  const before = await styleOf(page, '#revealed');
  assert.equal(before.opacity, '0', 'the reveal starts parked at opacity 0');

  await prepareForCapture(page);

  const after = await styleOf(page, '#revealed');
  assert.equal(after.opacity, '1', 'the reveal should have finished, not been caught part-way');
  assert.equal(after.transform, 'none', 'and should have landed at its final position');
});

// A hover scrim sits at opacity 0 permanently and on purpose. Forcing every
// faded element on would paint a dark wash over every card in a listings grid.
test('force-revealing a stalled element leaves a hover scrim alone', async (t) => {
  const page = await openAnimatedFixture(t);

  const settled = await prepareForCapture(page);
  assert.ok(settled.revealed >= 1, 'the element no observer ever fires for should be forced on');

  assert.equal((await styleOf(page, '#stuck')).opacity, '1', 'the stalled section should be visible');
  assert.equal(
    (await styleOf(page, '.hover-scrim')).opacity,
    '0',
    'the hover scrim should stay at opacity 0 — it is not a stalled reveal'
  );
});

// A sticky header follows the scroll, so it was painted across the top of every
// section capture, clipping each section's own heading.
test('hides sticky page chrome without reflowing the sections below it', async (t) => {
  const page = await openAnimatedFixture(t);
  await prepareForCapture(page);

  const heroTopBefore = await page.evaluate(
    () => document.querySelector('#hero').getBoundingClientRect().top + window.scrollY
  );

  const hidden = await hidePageChrome(page);

  assert.ok(hidden.length > 0, 'should report the chrome it hid');
  const header = await styleOf(page, '#site-header');
  assert.equal(header.visibility, 'hidden', 'the sticky header should be hidden');
  assert.notEqual(
    header.display,
    'none',
    'and hidden by visibility, so it keeps its space and nothing below it shifts'
  );

  const heroTopAfter = await page.evaluate(
    () => document.querySelector('#hero').getBoundingClientRect().top + window.scrollY
  );
  assert.equal(heroTopAfter, heroTopBefore, 'section geometry must not move');
});

// Some sites make a section itself sticky for a scroll effect. Hiding one as
// chrome would export it blank — a worse failure than the overlap.
test('never hides a section that is itself sticky', async (t) => {
  const page = await openAnimatedFixture(t);
  await prepareForCapture(page);

  await hidePageChrome(page, { keepSelectors: ['#site-header'] });

  assert.equal(
    (await styleOf(page, '#site-header')).visibility,
    'visible',
    'an element named as a section must survive chrome hiding'
  );
});

// A locator screenshot clips at the border box exactly, which slices the round
// badge a designer pinned to the seam between two sections in half.
test('grows the capture box to cover a decoration that hangs over the section edge', async (t) => {
  const page = await openAnimatedFixture(t);
  await prepareForCapture(page);

  const box = await measureSectionBox(page, '#hero');
  assert.ok(box, 'the hero overflows, so it should get a clip box');

  const heroBottom = await page.evaluate(() => {
    const r = document.querySelector('#hero').getBoundingClientRect();
    return r.bottom + window.scrollY;
  });
  assert.ok(
    box.y + box.height > heroBottom,
    `the box should reach past the hero's own bottom edge (${box.y + box.height} vs ${heroBottom})`
  );

  // A section with nothing hanging over its edge gets no clip box, so the
  // cheaper locator screenshot is used.
  assert.equal(await measureSectionBox(page, '#cards'), null);
});

// The capture path and the preview must agree about what the site looks like,
// so the same splash and modal handling is injected into proxied pages.
test('the proxied page carries the splash and modal handling', async (t) => {
  const html = await rewritePageHtml(
    '<html><head></head><body><div id="geo-modal" role="dialog" aria-modal="true"></div></body></html>',
    'https://example.com/'
  );

  assert.match(html, /dismissBlockingModals/, 'modal dismissal should be injected');
  assert.match(html, /findSplashOverlay/, 'splash handling should be injected');
});

// The live preview keeps a site's animations, so it needs a safety net only for
// reveals that never fire — not a licence to repaint the page. A decorative
// blob sits at a deliberately faint opacity while drifting on a permanent
// keyframe animation; an early version of the net matched on "not fully opaque
// and displaced" and forced two of them to full opacity, lighting up the
// preview in colours the exported screenshots (correctly) never had.
test('the preview rescue leaves a deliberately faint, animated decoration alone', async (t) => {
  const page = await openAnimatedFixture(t);
  await page.evaluate(RESCUE_PARKED_IN_VIEW_FN);
  await page.waitForTimeout(PARKED_GRACE_WAIT_MS);
  await page.evaluate(RESCUE_PARKED_IN_VIEW_FN);

  const orb = await styleOf(page, '.orb');
  assert.equal(orb.opacity, '0.08', 'a decoration faint by design must keep its own opacity');

  // The net still does its job on a reveal that genuinely never fired. It only
  // ever acts on what is on screen, so this has to be scrolled to first.
  await page.evaluate(() => document.querySelector('#stuck').scrollIntoView());
  await page.evaluate(RESCUE_PARKED_IN_VIEW_FN);
  await page.waitForTimeout(PARKED_GRACE_WAIT_MS);
  await page.evaluate(RESCUE_PARKED_IN_VIEW_FN);
  const stuck = await styleOf(page, '#stuck');
  assert.equal(stuck.opacity, '1', 'a reveal that never fired should still be rescued');
});
