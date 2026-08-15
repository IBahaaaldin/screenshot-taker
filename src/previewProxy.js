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

  var lastSyncTarget = null;
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'preview-scroll-to') {
      lastSyncTarget = { y: e.data.y, atTime: Date.now() };
      window.scrollTo(0, e.data.y);
    }
  });
  window.addEventListener('scroll', function () {
    if (
      lastSyncTarget &&
      Math.abs(window.scrollY - lastSyncTarget.y) < 3 &&
      (Date.now() - lastSyncTarget.atTime) < 400
    ) {
      return;
    }
    parent.postMessage({ type: 'preview-scroll', y: window.scrollY }, '*');
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
