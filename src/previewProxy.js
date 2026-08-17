import * as cheerio from 'cheerio';

// A visible scrollbar inside a device frame is a dead giveaway that it's an
// iframe, not a screen — and because the frames are CSS-zoomed, the bar renders
// comically thick. It also steals width from the layout being previewed, so the
// site inside reflows differently than it would on the real device. Scrolling
// itself is unaffected.
const HIDE_SCROLLBAR_STYLE = `<style>
  html { scrollbar-width: none; -ms-overflow-style: none; }
  html::-webkit-scrollbar, body::-webkit-scrollbar { width: 0; height: 0; }
</style>`;

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

  // Appended last so it wins over the site's own scrollbar styling.
  if ($('head').length) {
    $('head').append(HIDE_SCROLLBAR_STYLE);
  } else if ($('body').length) {
    $('body').append(HIDE_SCROLLBAR_STYLE);
  } else {
    $.root().append(HIDE_SCROLLBAR_STYLE);
  }

  if ($('body').length) {
    $('body').append(SYNC_BRIDGE_SCRIPT);
  } else {
    $.root().append(SYNC_BRIDGE_SCRIPT);
  }

  return $.html();
}
