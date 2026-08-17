import * as cheerio from 'cheerio';

const SYNC_BRIDGE_SCRIPT = `<script>
(function () {
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (/^(#|mailto:|tel:|javascript:)/i.test(href)) return;
    e.preventDefault();
    var navUrl = a.dataset.previewOriginalHref || a.href;
    parent.postMessage({ type: 'preview-nav', url: navUrl }, '*');
  }, true);

  // Scroll sync between the four device frames.
  //
  // Syncs a FRACTION of the scrollable range, not an absolute pixel offset:
  // each device lays the site out at a different viewport width, so their
  // content heights differ — the same scrollY shows different sections, and
  // a short device simply cannot reach a tall one's offset, which desynced
  // them permanently. A fraction keeps every device on the same part of the
  // page.
  //
  // Echo suppression is time-based. Comparing the resulting scrollY against
  // the requested one (the previous approach) is unreliable because these
  // frames are CSS-zoomed, so a programmatic scroll lands a few px off its
  // target and looked like a fresh user scroll — every device then echoed
  // every other one, which is what made scrolling feel laggy and fight
  // itself. A short window after applying a synced scroll is enough: the
  // resulting scroll event always arrives inside it.
  var APPLY_WINDOW_MS = 150;
  var applyingUntil = 0;
  var pendingFraction = null;
  var rafId = 0;

  function scrollableRange() {
    var doc = document.documentElement;
    var body = document.body;
    var height = Math.max(
      doc.scrollHeight,
      body ? body.scrollHeight : 0
    );
    // Never 0 — it's a divisor, and a page shorter than its viewport has no
    // scrollable range at all.
    return Math.max(1, height - window.innerHeight);
  }

  window.addEventListener('message', function (e) {
    var data = e.data;
    if (!data || data.type !== 'preview-scroll-to') return;
    if (typeof data.fraction !== 'number' || !isFinite(data.fraction)) return;
    applyingUntil = Date.now() + APPLY_WINDOW_MS;
    window.scrollTo(0, data.fraction * scrollableRange());
  });

  function flushFraction() {
    rafId = 0;
    if (pendingFraction === null) return;
    var fraction = pendingFraction;
    pendingFraction = null;
    parent.postMessage({ type: 'preview-scroll', fraction: fraction }, '*');
  }

  // Coalesce to one message per frame. A wheel gesture fires many scroll
  // events, and each one previously fanned out to three iframes that each
  // scrolled synchronously — a lot of forced layout inside one gesture.
  window.addEventListener('scroll', function () {
    if (Date.now() < applyingUntil) return;
    pendingFraction = window.scrollY / scrollableRange();
    if (!rafId) rafId = requestAnimationFrame(flushFraction);
  }, { passive: true });
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

  if ($('body').length) {
    $('body').append(SYNC_BRIDGE_SCRIPT);
  } else {
    $.root().append(SYNC_BRIDGE_SCRIPT);
  }

  return $.html();
}
