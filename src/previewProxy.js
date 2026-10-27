import * as cheerio from 'cheerio';
import { HIDE_COOKIE_BANNERS_SCRIPT } from './cookieBanner.js';
import { PREVIEW_PAGE_READY_SCRIPT } from './pageReady.js';

// A visible scrollbar inside a device frame is a dead giveaway that it's an
// iframe, not a screen — and because the frames are CSS-zoomed, the bar renders
// comically thick. It also steals width from the layout being previewed, so the
// site inside reflows differently than it would on the real device. Scrolling
// itself is unaffected.
const HIDE_SCROLLBAR_STYLE = `<style>
  html { scrollbar-width: none; -ms-overflow-style: none; }
  html::-webkit-scrollbar, body::-webkit-scrollbar { width: 0; height: 0; }
</style>`;

// The device iframes are sandboxed WITHOUT allow-same-origin (deliberately —
// the proxied page is served from the app's own origin, so allowing same-origin
// would let an arbitrary third-party site script the app itself). That gives
// the document an opaque origin, and in an opaque origin merely *reading*
// window.localStorage throws a SecurityError.
//
// That one throw was breaking previews badly: sites commonly read a stored
// theme/locale during init, the exception aborted the rest of the init script,
// and every element waiting on a scroll-reveal animation stayed at opacity 0.
// The result looked like the preview "wasn't loading the full site" — headings
// visible, all the content below them blank — on all four devices at once.
//
// Installing an in-memory stand-in keeps the sandbox intact and lets those
// scripts run. Values don't persist, which is correct for a preview: each
// device should start from the site's default state, not a remembered one.
const STORAGE_SHIM_SCRIPT = `<script>
(function () {
  function createMemoryStorage() {
    var data = Object.create(null);
    var api = {
      getItem: function (key) {
        key = String(key);
        return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
      },
      setItem: function (key, value) { data[String(key)] = String(value); },
      removeItem: function (key) { delete data[String(key)]; },
      clear: function () { data = Object.create(null); },
      key: function (index) {
        var keys = Object.keys(data);
        return index >= 0 && index < keys.length ? keys[index] : null;
      },
    };
    Object.defineProperty(api, 'length', {
      get: function () { return Object.keys(data).length; },
    });
    return api;
  }

  ['localStorage', 'sessionStorage'].forEach(function (name) {
    var usable = false;
    try {
      var store = window[name];
      store.getItem('__preview_probe__');
      usable = true;
    } catch (err) {
      usable = false;
    }
    if (usable) return;
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get: function () { return this['__preview_' + name] || (this['__preview_' + name] = createMemoryStorage()); },
      });
    } catch (err) {
      /* If even defining it fails there is nothing more we can do. */
    }
  });

  // Same story: touching indexedDB in an opaque origin throws.
  try {
    void window.indexedDB;
  } catch (err) {
    try {
      Object.defineProperty(window, 'indexedDB', { configurable: true, value: null });
    } catch (err2) {
      /* ignore */
    }
  }
})();
</script>`;

const SYNC_BRIDGE_SCRIPT = `<script>
(function () {
  // Resolve a link back to its real target on the ORIGINAL site.
  //
  // a.href can't be trusted here: this document is served from the app's own
  // origin, so any link the site's own JS adds after proxying (or any href the
  // rewriter skipped) resolves against the app instead of the site. Navigating
  // to that made the preview load the app inside itself — four little copies of
  // Screenshot Taker in the device frames. Proxied hrefs carry the true target
  // in their "url" query param, so recover it from there when the rewriter
  // didn't leave a data attribute.
  function originalTargetOf(a) {
    if (a.dataset.previewOriginalHref) return a.dataset.previewOriginalHref;
    var raw = a.getAttribute('href') || '';
    var match = /[?&]url=([^&]+)/.exec(raw);
    if (match) {
      try {
        return decodeURIComponent(match[1]);
      } catch (err) {
        /* fall through */
      }
    }
    return a.href;
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (/^(#|mailto:|tel:|javascript:)/i.test(href)) return;
    e.preventDefault();
    var navUrl = originalTargetOf(a);
    // Last line of defence against previewing the app itself.
    try {
      if (new URL(navUrl, location.href).origin === location.origin) return;
    } catch (err) {
      return;
    }
    parent.postMessage({ type: 'preview-nav', url: navUrl }, '*');
  }, true);


  // No scroll sync: each device frame scrolls on its own, so you can park
  // the phone on one section while inspecting another on the desktop. Link
  // clicks still propagate (above) so all four stay on the same page.
  //
  // Cross-device scroll syncing used to live here and was removed
  // deliberately. It could never be faithful — the four viewport widths give
  // the same site four different content heights, so no single offset maps
  // to the same content everywhere — and keeping four CSS-zoomed documents
  // in lockstep meant every frame echoed every other one's corrections,
  // which made scrolling feel like it was fighting back.
})();
</script>`;

// The phone frame's status bar, applied inside the page rather than around it.
//
// A device frame previously reserved the strip by insetting the iframe, which
// left the frame's own background showing above the page — a white band across
// the top of the phone that no real device has. On a real iPhone the page's
// background runs right up behind the status bar and only the *content* is
// inset. So the inset is done here, in the page's own layout, where the site's
// own background (gradient, dark theme, whatever it is) paints it for free.
//
// The size arrives in the proxied page's own URL, so the same rewritten HTML
// serves every device and stays cacheable — only the phone iframe asks for a
// safe area, and the script reads it from its own location at runtime.
const SAFE_AREA_SCRIPT = `<script>
(function () {
  var safeTop = 0;
  try {
    safeTop = parseFloat(new URLSearchParams(location.search).get('safeTop')) || 0;
  } catch (err) {
    safeTop = 0;
  }
  if (!safeTop) return;

  var style = document.createElement('style');
  style.id = '__st-safe-area';
  style.textContent =
    ':root{--st-safe-top:' + safeTop + 'px}' +
    'body{padding-top:' + safeTop + 'px !important}';
  function install() {
    var head = document.head || document.documentElement;
    if (head && !document.getElementById('__st-safe-area')) head.appendChild(style);
  }
  install();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  }

  // Padding the body insets the content, but it does not move the thing that
  // paints the top of the page. A site whose top is a full-bleed hero gradient
  // paints that gradient from a child element, so padding pushed the gradient
  // down too and the reserved strip showed plain <body> underneath — the same
  // white band, now just inside the page instead of around it.
  //
  // So find whatever actually paints under the top edge and stretch just that
  // element upward: pull it up by the inset and give it the inset back as
  // padding. Its content stays exactly where the body padding put it, its
  // total height is unchanged so nothing below it moves, and its background —
  // gradient and all — now runs up behind the Dynamic Island the way it does
  // on a real phone.
  function paintsBackground(cs) {
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
    var color = cs.backgroundColor;
    if (!color || color === 'transparent') return false;
    var open = color.indexOf('(');
    var close = color.indexOf(')');
    if (open === -1 || close === -1) return true;
    var parts = color.slice(open + 1, close).split(',');
    return parts.length < 4 || parseFloat(parts[3]) > 0.5;
  }

  function extendTopBackground() {
    if (document.querySelector('[data-st-safe-extended]')) return;

    // Scanned rather than hit-tested. document.elementFromPoint returns the
    // topmost *hit-testable* element, which at this spot is the site's fixed
    // <nav> — transparent, and whose ancestors are <body> and <html>, so the
    // walk never reached the hero section actually painting the gradient two
    // subtrees away. Decorative layers are commonly pointer-events:none too,
    // which hit testing skips entirely.
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
      // In flow only: stretching a pinned or absolutely-placed layer moves it
      // relative to everything else instead of extending the page's own top.
      if (cs.position !== 'static' && cs.position !== 'relative') continue;
      if (!paintsBackground(cs)) continue;

      var rect = el.getBoundingClientRect();
      if (rect.width < window.innerWidth * 0.9) continue;
      // Must be the layer sitting at the top of the inset content. Anything
      // further down would be dragged up over the header.
      if (Math.abs(rect.top - safeTop) > 2) continue;

      el.setAttribute('data-st-safe-extended', '1');
      // Pull the box up by the inset and give the inset back as padding: the
      // background now starts at the true top edge while the content it holds
      // does not move, and the box's total height is unchanged so nothing
      // below it shifts.
      el.style.setProperty('margin-top', '-' + safeTop + 'px', 'important');
      el.style.setProperty('padding-top', safeTop + 'px', 'important');
      return;
    }
  }

  // Anything pinned to the top of the viewport ignores the body padding and
  // would sit back under the Dynamic Island — which is exactly what a site's
  // sticky header does. Push those down by the same amount, so a header stops
  // below the island and the page still scrolls behind it.
  function offsetPinned() {
    var all = document.querySelectorAll('body *');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.getAttribute('data-st-safe-offset')) continue;
      var cs;
      try {
        cs = getComputedStyle(el);
      } catch (err) {
        continue;
      }
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      if (cs.top !== '0px') continue;
      var rect = el.getBoundingClientRect();
      // A full-screen pinned layer is a modal or a backdrop, not a header;
      // nudging it down would leave a gap along the top of the overlay.
      if (rect.height > window.innerHeight * 0.7) continue;
      el.setAttribute('data-st-safe-offset', '1');
      el.style.setProperty('top', safeTop + 'px', 'important');
    }
  }

  function apply() {
    try { offsetPinned(); } catch (err) {}
    try { extendTopBackground(); } catch (err) {}
  }

  apply();
  // Headers and heroes commonly mount after hydration, so keep looking for a
  // while rather than only once.
  var ticks = 0;
  var timer = setInterval(function () {
    apply();
    if (++ticks > 40) clearInterval(timer);
  }, 250);
})();
</script>`;

const SKIP_HREF_RE = /^(#|mailto:|tel:|javascript:|data:)/i;

function toProxiedAssetUrl(rawValue, baseUrl) {
  if (!rawValue || SKIP_HREF_RE.test(rawValue) || rawValue.startsWith('/api/preview/')) {
    return null;
  }
  let absolute;
  try {
    absolute = new URL(rawValue, baseUrl).href;
  } catch {
    return null;
  }
  if (!/^https?:/i.test(absolute)) return null;
  return `/api/preview/asset?url=${encodeURIComponent(absolute)}`;
}

const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

export function rewriteCssUrls(cssText, baseUrl) {
  return cssText.replace(CSS_URL_RE, (match, quote, value) => {
    const proxied = toProxiedAssetUrl(value.trim(), baseUrl);
    if (!proxied) return match;
    return `url(${proxied})`;
  });
}

export async function rewritePageHtml(html, baseUrl) {
  const $ = cheerio.load(html);

  $('[href]').each((_, el) => {
    const rawHref = $(el).attr('href');
    const proxied = toProxiedAssetUrl(rawHref, baseUrl);
    if (!proxied) return;
    if (el.tagName && el.tagName.toLowerCase() === 'a') {
      let absolute;
      try {
        absolute = new URL(rawHref, baseUrl).href;
      } catch {
        absolute = null;
      }
      if (absolute) $(el).attr('data-preview-original-href', absolute);
    }
    $(el).attr('href', proxied);
  });
  $('[src]').each((_, el) => {
    const proxied = toProxiedAssetUrl($(el).attr('src'), baseUrl);
    if (proxied) $(el).attr('src', proxied);
  });
  $('form[action]').each((_, el) => {
    const proxied = toProxiedAssetUrl($(el).attr('action'), baseUrl);
    if (proxied) $(el).attr('action', proxied);
  });
  $('style').each((_, el) => {
    $(el).text(rewriteCssUrls($(el).text(), baseUrl));
  });
  $('[style]').each((_, el) => {
    $(el).attr('style', rewriteCssUrls($(el).attr('style'), baseUrl));
  });

  // PREPENDED to <head> so it runs before any of the site's own scripts — a
  // shim installed after the init script has already thrown is useless.
  if ($('head').length) {
    $('head').prepend(STORAGE_SHIM_SCRIPT);
  } else if ($('body').length) {
    $('body').prepend(STORAGE_SHIM_SCRIPT);
  } else {
    $.root().prepend(STORAGE_SHIM_SCRIPT);
  }

  // Appended last so it wins over the site's own scrollbar styling.
  if ($('head').length) {
    $('head').append(HIDE_SCROLLBAR_STYLE);
  } else if ($('body').length) {
    $('body').append(HIDE_SCROLLBAR_STYLE);
  } else {
    $.root().append(HIDE_SCROLLBAR_STYLE);
  }

  if ($('head').length) {
    $('head').append(SAFE_AREA_SCRIPT);
  } else if ($('body').length) {
    $('body').prepend(SAFE_AREA_SCRIPT);
  } else {
    $.root().prepend(SAFE_AREA_SCRIPT);
  }

  if ($('body').length) {
    $('body').append(SYNC_BRIDGE_SCRIPT);
  } else {
    $.root().append(SYNC_BRIDGE_SCRIPT);
  }

  // Same banner hiding the capture path applies, so the live preview shows what
  // the exported screenshots will actually contain.
  if ($('body').length) {
    $('body').append(HIDE_COOKIE_BANNERS_SCRIPT);
  } else {
    $.root().append(HIDE_COOKIE_BANNERS_SCRIPT);
  }

  // Intro splashes and blocking modals are cleared here too. Without this the
  // preview spends its first seconds showing the site's logo animation in all
  // four frames, and a first-visit dialog (geo picker, newsletter) then covers
  // the site for as long as the preview is open — and for the whole length of
  // any video recorded from it. Scroll-reveal animations are deliberately left
  // alone: unlike a screenshot, a preview and a video are meant to show them.
  if ($('body').length) {
    $('body').append(PREVIEW_PAGE_READY_SCRIPT);
  } else {
    $.root().append(PREVIEW_PAGE_READY_SCRIPT);
  }

  return $.html();
}
