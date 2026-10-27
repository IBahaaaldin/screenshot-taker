// src/pageReady.js
//
// Getting a modern site to hold still long enough to photograph it.
//
// A capture that fires as soon as `load` resolves catches the site mid-
// performance. On a real run against designerspuzzle.com every single image in
// the export was ruined by one of four things:
//
//   1. An intro splash — a fixed, full-viewport logo animation that plays for
//      ~2.5s and then removes itself. Several sections came back as nothing but
//      the logo on white.
//   2. A blocking modal — a geo/currency dialog ("Where are you shopping
//      from?") that opens on first visit, sits in the middle of the screen and
//      blurs everything behind it. It landed in all 4 viewports of all 18
//      pages.
//   3. Scroll-reveal animations — content that starts at `opacity: 0;
//      translateY(24px)` and animates in when an IntersectionObserver sees it.
//      Captures landed mid-transition (opacity 0.33, 0.66...) or, for anything
//      the scroll pass skipped past too quickly, at opacity 0 — blank sections.
//   4. Sticky page chrome — a `position: sticky` header that follows the
//      scroll and so got painted across the top of every section capture,
//      clipping each section's own heading.
//
// The functions here are written as standalone function bodies (no imports, no
// closures, ES5-ish syntax) because they are `toString()`d into two different
// destinations: `page.evaluate` for the capture path, and an inline <script>
// for the proxied pages behind the live preview. Keeping one source of truth
// is what makes the preview an honest indication of what the export contains.
//
// The capture path and the preview path deliberately do NOT do the same work.
// A screenshot wants every animation over and done with; a live preview and a
// recorded video want the animations to still play, because the motion is the
// point. So the splash and modal handling is shared, and only the capture path
// force-settles the rest.

// How long to let an intro splash play out on its own before deciding it is
// stuck and hiding it. Real splashes run 1-3s.
const SPLASH_TIMEOUT_MS = 6000;
const SPLASH_POLL_MS = 200;

// ---------------------------------------------------------------------------
// Splash / preloader
// ---------------------------------------------------------------------------

// Returns a description of the intro overlay currently covering the page, or
// null. "Covering" means fixed, opaque enough to hide content, and spanning
// most of the viewport. A modal is excluded by the control check: a splash has
// nothing to click, which is exactly what makes it a splash and not a dialog.
export const FIND_SPLASH_FN = function findSplashOverlay() {
  var vw = window.innerWidth;
  var vh = window.innerHeight;
  if (!vw || !vh) return null;
  var main = document.querySelector('main') || document.body;

  var all = document.querySelectorAll('body *');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (el.getAttribute('data-st-splash-hidden')) continue;
    var cs;
    try {
      cs = getComputedStyle(el);
    } catch (err) {
      continue;
    }
    if (cs.position !== 'fixed') continue;
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (parseFloat(cs.opacity) < 0.05) continue;

    var rect = el.getBoundingClientRect();
    if (rect.width < vw * 0.9 || rect.height < vh * 0.9) continue;
    // A wrapper around the page's own content is layout, not an overlay.
    if (el !== main && el.contains(main)) continue;

    // Anything offering a choice is a dialog, and dialogs are dismissed rather
    // than waited out.
    var controls = el.querySelectorAll('button, a[href], [role="button"], input, select');
    if (controls.length > 0) continue;

    return {
      tag: el.tagName,
      cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').slice(0, 120),
      z: cs.zIndex,
    };
  }
  return null;
};

// Last resort when a splash never removes itself (an animation library that
// waits for an event the headless run never fires, say).
export const HIDE_SPLASH_FN = function hideSplashOverlay() {
  var found = (function () {
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var main = document.querySelector('main') || document.body;
    var all = document.querySelectorAll('body *');
    var hits = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var cs;
      try {
        cs = getComputedStyle(el);
      } catch (err) {
        continue;
      }
      if (cs.position !== 'fixed') continue;
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (parseFloat(cs.opacity) < 0.05) continue;
      var rect = el.getBoundingClientRect();
      if (rect.width < vw * 0.9 || rect.height < vh * 0.9) continue;
      if (el !== main && el.contains(main)) continue;
      if (el.querySelectorAll('button, a[href], [role="button"], input, select').length > 0) continue;
      hits.push(el);
    }
    return hits;
  })();

  for (var i = 0; i < found.length; i++) {
    found[i].setAttribute('data-st-splash-hidden', '1');
    found[i].style.setProperty('display', 'none', 'important');
  }
  return found.length;
};

// ---------------------------------------------------------------------------
// Blocking modals
// ---------------------------------------------------------------------------

// Hides modal dialogs — geo/currency pickers, newsletter popups, age gates,
// app-download interstitials — along with the scrim that dims and blurs the
// page behind them, and undoes the scroll lock they install.
//
// Hidden, not clicked: clicking "Confirm" on a currency dialog picks a currency
// on the site owner's behalf and changes what every later capture shows, and
// clicking a newsletter "close" can count as an impression. Hiding is
// side-effect free and language-independent.
export const DISMISS_MODALS_FN = function dismissBlockingModals() {
  var vw = window.innerWidth;
  var vh = window.innerHeight;
  var viewportArea = vw * vh;
  var main = document.querySelector('main') || document.body;
  var dismissed = [];

  function label(el) {
    var cls = el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className;
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + String(cls).trim().split(/\s+/)[0] : '');
  }

  function hide(el, why) {
    if (!el || el.nodeType !== 1) return false;
    if (el.getAttribute('data-st-modal-hidden')) return false;
    // Blanking the page would be a worse outcome than leaving the modal in.
    if (el !== main && el.contains(main)) return false;
    if (el === document.body || el === document.documentElement) return false;
    el.setAttribute('data-st-modal-hidden', '1');
    el.style.setProperty('display', 'none', 'important');
    dismissed.push(why + ': ' + label(el));
    return true;
  }

  // An element counts as an overlay if it is fixed itself, or is painted by a
  // fixed ancestor — libraries commonly render `<div class="fixed inset-0">`
  // wrapping an absolutely-positioned panel and scrim.
  function fixedHost(el) {
    var node = el;
    var depth = 0;
    while (node && node !== document.body && depth < 12) {
      var cs;
      try {
        cs = getComputedStyle(node);
      } catch (err) {
        return null;
      }
      if (cs.position === 'fixed') return node;
      node = node.parentElement;
      depth++;
    }
    return null;
  }

  function visible(el) {
    var cs;
    try {
      cs = getComputedStyle(el);
    } catch (err) {
      return false;
    }
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (parseFloat(cs.opacity) < 0.05) return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 40 && rect.height > 40;
  }

  // Pass 1: elements that say outright that they are a modal. `aria-modal`
  // and `role="dialog"` are set by every mainstream dialog implementation
  // (Radix, Headless UI, MUI, Bootstrap) because screen readers need them.
  var declared = document.querySelectorAll(
    '[aria-modal="true"], [role="dialog"], [role="alertdialog"], dialog[open], .modal.show, .modal.in'
  );
  for (var i = 0; i < declared.length; i++) {
    var el = declared[i];
    if (!visible(el)) continue;
    var host = fixedHost(el);
    // A non-fixed dialog is inline content (an expanded panel, an embedded
    // form) — it scrolls with the page and does not block anything.
    if (!host) continue;
    hide(host, 'dialog');
  }

  // Pass 2: undeclared popups. A fixed layer that covers most of the viewport
  // and carries a dismiss control is a popup whatever it calls itself.
  var DISMISS_TEXT = /close|dismiss|no thanks|not now|maybe later|continue|confirm|accept|got it|skip|×|✕/i;
  var all = document.querySelectorAll('body *');
  for (var k = 0; k < all.length; k++) {
    var cand = all[k];
    var cs2;
    try {
      cs2 = getComputedStyle(cand);
    } catch (err) {
      continue;
    }
    if (cs2.position !== 'fixed') continue;
    if (!visible(cand)) continue;
    if (cand.getAttribute('data-st-modal-hidden')) continue;

    var r = cand.getBoundingClientRect();
    if (r.width * r.height < viewportArea * 0.5) continue;
    if (cand !== main && cand.contains(main)) continue;

    var controls = cand.querySelectorAll('button, a[href], [role="button"], input[type="button"], input[type="submit"]');
    var hasDismiss = false;
    for (var c = 0; c < controls.length; c++) {
      var text = controls[c].innerText || controls[c].value || controls[c].getAttribute('aria-label') || '';
      if (DISMISS_TEXT.test(text)) {
        hasDismiss = true;
        break;
      }
    }
    if (!hasDismiss) continue;
    hide(cand, 'popup');
  }

  // Pass 3: orphan scrims. Some sites render the dim/blur layer as a sibling of
  // the dialog rather than a child, so hiding the dialog leaves the page dimmed
  // and blurred with nothing on top of it — which looks like a rendering bug in
  // the export. A full-viewport fixed layer that is see-through, blurs what is
  // behind it, and holds no text of its own is never content.
  var scrims = document.querySelectorAll('body *');
  for (var s = 0; s < scrims.length; s++) {
    var sc = scrims[s];
    if (sc.getAttribute('data-st-modal-hidden')) continue;
    var cs3;
    try {
      cs3 = getComputedStyle(sc);
    } catch (err) {
      continue;
    }
    if (cs3.position !== 'fixed') continue;
    if (cs3.display === 'none' || cs3.visibility === 'hidden') continue;
    var sr = sc.getBoundingClientRect();
    if (sr.width < vw * 0.9 || sr.height < vh * 0.9) continue;
    if (sc !== main && sc.contains(main)) continue;
    if ((sc.innerText || '').trim().length > 0) continue;

    var blurs = /blur\(/.test(cs3.backdropFilter || '') || /blur\(/.test(cs3.filter || '');
    var alpha = /rgba?\([^)]*?,\s*([\d.]+)\s*\)$/.exec(cs3.backgroundColor || '');
    var translucent = alpha ? parseFloat(alpha[1]) > 0.02 && parseFloat(alpha[1]) < 0.98 : false;
    // Requiring a blur or a translucent wash keeps this away from the
    // full-bleed fixed background images some sites park behind their content.
    if (!blurs && !translucent) continue;
    // Only when something was actually dismissed — otherwise a decorative
    // fixed grain/vignette layer would be stripped from every capture.
    if (dismissed.length === 0) continue;
    hide(sc, 'scrim');
  }

  // A modal locks the page behind it. Left in place, the scroll lock stops the
  // capture pass from scrolling at all, so no scroll-reveal ever fires and the
  // whole page below the fold exports blank.
  if (dismissed.length > 0) {
    var targets = [document.documentElement, document.body];
    for (var t = 0; t < targets.length; t++) {
      var node = targets[t];
      var ncs;
      try {
        ncs = getComputedStyle(node);
      } catch (err) {
        continue;
      }
      if (ncs.overflow === 'hidden' || ncs.overflowY === 'hidden') {
        node.style.setProperty('overflow', 'visible', 'important');
      }
      // The other common lock: `body { position: fixed; top: -<scrollY>px }`.
      if (ncs.position === 'fixed') {
        node.style.setProperty('position', 'static', 'important');
        node.style.setProperty('top', 'auto', 'important');
      }
    }
  }

  return dismissed;
};

// ---------------------------------------------------------------------------
// Animation settling (capture path only)
// ---------------------------------------------------------------------------

// Brings the page to the state a human sees after they have scrolled through it
// once and everything has finished moving.
//
// Order matters. Zeroing the durations FIRST is what makes the rest cheap: the
// scroll pass still fires every IntersectionObserver, but each reveal lands on
// its end state instantly instead of over 600ms, so nothing can be caught
// mid-transition no matter how fast the pass moves.
export const SETTLE_ANIMATIONS_FN = async function settleAnimations() {
  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  var STYLE_ID = '__st-settle-style';
  if (!document.getElementById(STYLE_ID)) {
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '*,*::before,*::after{' +
      'transition-duration:0s !important;transition-delay:0s !important;' +
      'animation-duration:0s !important;animation-delay:0s !important;' +
      '}' +
      'html,body{scroll-behavior:auto !important}';
    (document.head || document.documentElement).appendChild(style);
  }

  // Walk the page. `scrollHeight` is re-read each step because revealing
  // content (and loading lazy images) grows the document as we go.
  var step = Math.max(200, Math.round(window.innerHeight * 0.6));
  var guard = 0;
  for (var y = 0; y < document.documentElement.scrollHeight && guard < 500; y += step) {
    window.scrollTo(0, y);
    await sleep(50);
    guard++;
  }
  window.scrollTo(0, document.documentElement.scrollHeight);
  await sleep(150);
  // Back up again: some sites reveal on upward scroll too, and it returns
  // scroll-linked chrome (shrinking headers, progress bars) to its top state.
  for (var up = document.documentElement.scrollHeight; up > 0 && guard < 1000; up -= step) {
    window.scrollTo(0, up);
    await sleep(20);
    guard++;
  }
  window.scrollTo(0, 0);
  await sleep(100);

  // Lazy images that entered the DOM during the walk still need to decode, or
  // sections come back with grey placeholder boxes.
  var pending = Array.prototype.slice.call(document.images).filter(function (img) {
    return !img.complete;
  });
  await Promise.all(
    pending.slice(0, 200).map(function (img) {
      return new Promise(function (resolve) {
        var done = function () {
          resolve();
        };
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
        setTimeout(done, 3000);
      });
    })
  );

  // Snap whatever is still running to its end state. Infinite animations
  // (spinners, marquees, ticker rows) have no end state, so they are paused
  // instead — a paused spinner photographs cleanly, a running one can land
  // half-way through a rotation on one device and not the others.
  var finished = 0;
  var pausedCount = 0;
  if (document.getAnimations) {
    var anims = document.getAnimations();
    for (var a = 0; a < anims.length; a++) {
      var anim = anims[a];
      try {
        var timing = anim.effect && anim.effect.getTiming ? anim.effect.getTiming() : null;
        if (timing && timing.iterations === Infinity) {
          anim.pause();
          pausedCount++;
          continue;
        }
        anim.finish();
        finished++;
      } catch (err) {
        try {
          anim.pause();
          pausedCount++;
        } catch (err2) {
          /* an animation we cannot touch is not worth failing the capture over */
        }
      }
    }
  }

  return { finished: finished, paused: pausedCount };
};

// Forces elements still sitting in a scroll-reveal *start* state to their end
// state.
//
// The test is deliberately narrow. Low opacity alone is not evidence of a
// stalled reveal: hover scrims (`absolute inset-0 bg-gradient-to-t opacity-0
// transition`) sit at opacity 0 permanently by design, and there is one over
// every card on a listings page — forcing those on paints a dark wash across
// the whole grid. A real reveal is displaced as well as faded (the usual
// `opacity: 0; translateY(24px)`), or it carries a library's marker attribute.
// Requiring displacement-or-marker is what separates the two.
export const REVEAL_PARKED_FN = function revealParkedElements() {
  var REVEAL_HOOK = /(^|[\s_-])(aos|reveal|animate|animated|wow|fade|slide|inview|in-view|appear|scroll-?anim)/i;
  var IDENTITY = /^matrix\(1,\s*0,\s*0,\s*1,\s*0,\s*0\)$/;
  var revealed = 0;

  var all = document.querySelectorAll('body *');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var cs;
    try {
      cs = getComputedStyle(el);
    } catch (err) {
      continue;
    }
    if (cs.display === 'none') continue;

    var rect = el.getBoundingClientRect();
    if (rect.width < 24 || rect.height < 24) continue;

    var opacity = parseFloat(cs.opacity);
    var isHidden = cs.visibility === 'hidden';
    var faded = opacity < 0.99 || isHidden;
    if (!faded) continue;

    var transform = cs.transform || 'none';
    var displaced = transform !== 'none' && !IDENTITY.test(transform);

    var className = el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className;
    var marked =
      el.hasAttribute('data-aos') ||
      el.hasAttribute('data-animate') ||
      el.hasAttribute('data-scroll') ||
      el.hasAttribute('data-reveal') ||
      REVEAL_HOOK.test(String(className || ''));

    if (!displaced && !marked) continue;

    el.style.setProperty('opacity', '1', 'important');
    el.style.setProperty('transform', 'none', 'important');
    el.style.setProperty('visibility', 'visible', 'important');
    // Reveals sometimes blur in as well. Only blur is cleared — wiping `filter`
    // wholesale would drop the drop-shadows sites use on product cutouts.
    if (/blur\(/.test(cs.filter || '')) {
      el.style.setProperty('filter', 'none', 'important');
    }
    el.setAttribute('data-st-revealed', '1');
    revealed++;
  }
  return revealed;
};

// ---------------------------------------------------------------------------
// Page chrome (capture path, section mode only)
// ---------------------------------------------------------------------------

// Hides fixed and sticky chrome — headers, floating CTAs, chat bubbles, back-
// to-top buttons — for the duration of a section capture.
//
// A section screenshot is taken by scrolling that section into view and
// photographing its box. Sticky chrome follows the scroll, so it lands across
// the top of every section, clipping that section's own heading. It is not part
// of any section's box; it is simply parked on top of it.
//
// `visibility` rather than `display`: hiding a sticky header with
// `display: none` pulls it out of flow, which shifts every section below it and
// changes the geometry the detected selectors were measured against.
export const HIDE_PAGE_CHROME_FN = function hidePageChrome(keepSelectors) {
  var main = document.querySelector('main') || document.body;
  var hidden = [];

  // The sections about to be captured, so none of them can be hidden as
  // chrome. Sites do make a section itself `position: sticky` for scroll
  // effects, and hiding one would export it blank — a worse failure than the
  // overlap this function exists to prevent.
  var keep = [];
  var selectors = keepSelectors || [];
  for (var s = 0; s < selectors.length; s++) {
    try {
      var match = document.querySelector(selectors[s]);
      if (match) keep.push(match);
    } catch (err) {
      /* a selector that no longer resolves simply protects nothing */
    }
  }
  function isProtected(el) {
    for (var k = 0; k < keep.length; k++) {
      if (el === keep[k] || el.contains(keep[k]) || keep[k].contains(el)) return true;
    }
    return false;
  }

  var all = document.querySelectorAll('body *');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (el.getAttribute('data-st-chrome-hidden')) continue;
    var cs;
    try {
      cs = getComputedStyle(el);
    } catch (err) {
      continue;
    }
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;

    var rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) continue;
    if (el !== main && el.contains(main)) continue;
    // Chrome is small by nature — a nav bar, a floating button, a chat bubble.
    // Something filling most of the screen is a pinned layout panel, and
    // blanking it would lose real content.
    if (rect.height > window.innerHeight * 0.7 && rect.width > window.innerWidth * 0.7) continue;
    if (isProtected(el)) continue;

    el.setAttribute('data-st-chrome-hidden', '1');
    el.style.setProperty('visibility', 'hidden', 'important');
    hidden.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''));
  }
  return hidden;
};

// ---------------------------------------------------------------------------
// Section geometry
// ---------------------------------------------------------------------------

// How far outside its own box a section is allowed to reach before the capture
// stops following it. Straddling decorations are small by nature — a badge, a
// notch, a card lifted onto the seam. A descendant reaching further than this is
// a full-bleed background or a dropdown, and chasing it would swallow the
// neighbouring sections.
const OVERFLOW_MARGIN_PX = 120;

// Returns the box to photograph for a section, in document coordinates:
// the section's own border box, grown to cover any child that deliberately
// hangs over its edge.
//
// A locator screenshot clips at the border box exactly, which slices anything
// designed to straddle the seam between two sections — the round "scroll on"
// badge pinned to `-bottom-8`, an overlapping card, a ribbon. The result is a
// half-cut circle sitting on the bottom edge of the export, which reads as a
// broken screenshot rather than a design.
export const MEASURE_SECTION_BOX_FN = function measureSectionBox(args) {
  var selector = args.selector;
  var margin = args.margin;
  var el = document.querySelector(selector);
  if (!el) return null;

  var base = el.getBoundingClientRect();
  if (!base.width || !base.height) return null;

  var top = base.top;
  var bottom = base.bottom;
  var left = base.left;
  var right = base.right;

  var kids = el.querySelectorAll('*');
  for (var i = 0; i < kids.length; i++) {
    var kid = kids[i];
    var cs;
    try {
      cs = getComputedStyle(kid);
    } catch (err) {
      continue;
    }
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (parseFloat(cs.opacity) < 0.05) continue;
    // Fixed children are chrome pinned to the viewport, not part of the
    // section, and their position has nothing to do with where the section is.
    if (cs.position === 'fixed') continue;

    var r = kid.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.top < top && r.top >= base.top - margin) top = r.top;
    if (r.bottom > bottom && r.bottom <= base.bottom + margin) bottom = r.bottom;
    if (r.left < left && r.left >= base.left - margin) left = r.left;
    if (r.right > right && r.right <= base.right + margin) right = r.right;
  }

  var grew = top < base.top - 0.5 || bottom > base.bottom + 0.5 || left < base.left - 0.5 || right > base.right + 0.5;
  if (!grew) return null;

  var docLeft = Math.max(0, Math.floor(left + window.scrollX));
  var docTop = Math.max(0, Math.floor(top + window.scrollY));
  var maxWidth = Math.max(document.documentElement.scrollWidth, window.innerWidth);
  var maxHeight = Math.max(document.documentElement.scrollHeight, window.innerHeight);

  return {
    x: docLeft,
    y: docTop,
    width: Math.min(Math.ceil(right - left), maxWidth - docLeft),
    height: Math.min(Math.ceil(bottom - top), maxHeight - docTop),
  };
};

// ---------------------------------------------------------------------------
// Playwright-side helpers
// ---------------------------------------------------------------------------

// Waits out an intro splash, then hides it if it overstays. Returns what
// happened so callers can log it.
export async function waitForSplash(page, { timeoutMs = SPLASH_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  let sawSplash = false;
  try {
    while (Date.now() < deadline) {
      const splash = await page.evaluate(FIND_SPLASH_FN);
      if (!splash) return { sawSplash, hidden: false };
      sawSplash = true;
      await page.waitForTimeout(SPLASH_POLL_MS);
    }
    const hiddenCount = await page.evaluate(HIDE_SPLASH_FN);
    return { sawSplash, hidden: hiddenCount > 0 };
  } catch (err) {
    console.error(`[pageReady] splash wait failed: ${err.message}`);
    return { sawSplash, hidden: false };
  }
}

export async function dismissModals(page) {
  try {
    return await page.evaluate(DISMISS_MODALS_FN);
  } catch (err) {
    console.error(`[pageReady] could not dismiss modals: ${err.message}`);
    return [];
  }
}

// Two evaluates rather than one: `page.evaluate` serializes the single function
// it is handed and nothing else, so a helper called from inside the settle
// function would be undefined by the time it ran in the page.
export async function settleAnimations(page) {
  try {
    const settled = await page.evaluate(SETTLE_ANIMATIONS_FN);
    const revealed = await page.evaluate(REVEAL_PARKED_FN);
    return { ...settled, revealed };
  } catch (err) {
    // A page that navigates away mid-evaluate lands here. The capture that
    // follows will report the real problem.
    console.error(`[pageReady] could not settle animations: ${err.message}`);
    return { finished: 0, paused: 0, revealed: 0 };
  }
}

export async function revealParked(page) {
  try {
    return await page.evaluate(REVEAL_PARKED_FN);
  } catch {
    return 0;
  }
}

// Returns a document-coordinate clip box when the section overflows its own
// border box, or null when a plain locator screenshot is already correct.
export async function measureSectionBox(page, selector, { margin = OVERFLOW_MARGIN_PX } = {}) {
  try {
    return await page.evaluate(MEASURE_SECTION_BOX_FN, { selector, margin });
  } catch {
    return null;
  }
}

export async function hidePageChrome(page, { keepSelectors = [] } = {}) {
  try {
    return await page.evaluate(HIDE_PAGE_CHROME_FN, keepSelectors);
  } catch (err) {
    console.error(`[pageReady] could not hide page chrome: ${err.message}`);
    return [];
  }
}

// Everything a page needs before it can be photographed, in the order that
// makes each step cheap for the next: let the splash finish (it covers the
// content the modal check needs to see), clear the modal (its scroll lock would
// stop the settle pass scrolling), then settle.
export async function prepareForCapture(page, { hideChrome = false, keepSelectors = [] } = {}) {
  await waitForSplash(page);
  await dismissModals(page);
  const settled = await settleAnimations(page);
  // A modal can open on a timer — "subscribe" popups routinely wait 5-10s,
  // which is long enough to arrive during the settle pass rather than before
  // it. One more sweep costs a few milliseconds.
  await dismissModals(page);
  if (hideChrome) await hidePageChrome(page, { keepSelectors });
  return settled;
}

// How long an element may sit in the viewport still parked in its scroll-reveal
// start state before the preview stops waiting and shows it. A reveal that is
// actually going to run has started well inside this window — the transitions
// themselves are typically 300-800ms — so real motion is never cut short.
const PARKED_IN_VIEW_GRACE_MS = 1400;
// Above this, an element is faint on purpose rather than waiting to appear.
const PARKED_OPACITY_MAX = 0.05;

// The rescue the live preview and the recorded video need.
//
// The capture path force-settles everything, but a preview keeps its animations
// because the motion is the point. That only works while the site's own
// IntersectionObserver actually fires. Proxied through the app it does not
// always: measured against designerspuzzle.com, scrolling the real site to 75%
// left 7 elements parked at `opacity: 0`, and the same scroll through the proxy
// left 17 — enough that the largest device frame showed a bare header over
// white for the last third of every recording.
//
// So this watches only what is on screen, and only rescues an element that has
// been both visible and parked for longer than any real reveal takes. An
// element mid-transition is left alone; one the observer forgot is shown.
export const RESCUE_PARKED_IN_VIEW_FN = function rescueParkedInView() {
  if (!window.__stParkedSince) window.__stParkedSince = new WeakMap();
  var seen = window.__stParkedSince;
  var now = Date.now();
  var rescued = 0;

  var all = document.querySelectorAll('body *');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var cs;
    try {
      cs = getComputedStyle(el);
    } catch (err) {
      continue;
    }
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;

    var rect = el.getBoundingClientRect();
    var onScreen = rect.bottom > 0 && rect.top < window.innerHeight && rect.height >= 40;
    if (!onScreen) {
      seen.delete(el);
      continue;
    }

    var opacity = parseFloat(cs.opacity);
    var transform = cs.transform;
    var moved = transform && transform !== 'none' && !/^matrix\(1, 0, 0, 1, 0, 0\)$/.test(transform);

    // A looping keyframe animation is the site working as intended, not a
    // reveal that stalled. Decorative blurred blobs drift on a permanent
    // animation while sitting at a deliberately faint opacity — forcing those
    // to 1 lit two of them up like spotlights in the preview, colours the
    // exported screenshots (correctly) never had.
    if (cs.animationName && cs.animationName !== 'none') {
      seen.delete(el);
      continue;
    }

    // Opacity alone is not the test, and "less than fully opaque" is too loose.
    // A hover scrim sits at opacity 0 by design and forcing it on paints a dark
    // wash over every card; a decorative layer sits at 0.08 by design and is
    // meant to stay there. A reveal that has not fired is at (or within a
    // rounding error of) zero AND displaced — the pairing is what identifies
    // it.
    if (!(opacity < 0.05 && moved)) {
      seen.delete(el);
      continue;
    }

    var since = seen.get(el);
    if (since === undefined) {
      seen.set(el, now);
      continue;
    }
    if (now - since < 1400) continue;

    el.style.setProperty('opacity', '1', 'important');
    el.style.setProperty('transform', 'none', 'important');
    seen.delete(el);
    rescued++;
  }
  return rescued;
};

// The preview and the recorded video keep their animations: the motion is what
// they exist to show. They still need the splash out of the way (it hides the
// site for the first seconds of every recording) and the modal gone (it blocks
// the whole page for all of it).
export const PREVIEW_PAGE_READY_SCRIPT = `<script>
(function () {
  var findSplash = ${FIND_SPLASH_FN.toString()};
  var hideSplash = ${HIDE_SPLASH_FN.toString()};
  var dismissModals = ${DISMISS_MODALS_FN.toString()};
  var rescueParked = ${RESCUE_PARKED_IN_VIEW_FN.toString()};

  function sweep() {
    try { dismissModals(); } catch (err) {}
  }

  // Dialogs mount after hydration, and some are on a timer, so keep checking
  // for a while rather than once.
  sweep();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sweep);
  }
  var ticks = 0;
  var timer = setInterval(function () {
    sweep();
    // Give a splash its own run first; only step in once it has clearly
    // outstayed a normal intro.
    if (ticks * 250 > ${SPLASH_TIMEOUT_MS}) {
      try { if (findSplash()) hideSplash(); } catch (err) {}
    }
    if (++ticks > 80) clearInterval(timer);
  }, 250);

  // Runs for the life of the page, not just the opening seconds: a reveal can
  // stall anywhere the scroll reaches, including well into a recording.
  setInterval(function () {
    try { rescueParked(); } catch (err) {}
  }, 400);
})();
</script>`;
