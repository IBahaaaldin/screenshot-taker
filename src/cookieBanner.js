// src/cookieBanner.js
//
// Cookie/consent banners are page chrome that ends up in every capture — on a
// real run the banner sat across the bottom of every device screen in every
// post. They're hidden rather than dismissed by clicking "Accept": clicking
// consents on the site owner's behalf and sets cookies, and a rejected banner
// often reappears on the next page load anyway. Hiding is side-effect free and
// works regardless of the banner's language.
//
// The same logic runs in two places — Playwright pages before capture, and the
// proxied pages inside the live preview — so the preview shows what the export
// will contain. Keep it as one source of truth: a function body, stringified for
// injection.
export const HIDE_COOKIE_BANNERS_FN = function hideCookieBanners() {
  // Named containers from the common consent platforms. These are unambiguous,
  // so they're hidden on sight.
  var VENDOR_SELECTORS = [
    '#onetrust-consent-sdk', '#onetrust-banner-sdk',
    '#CybotCookiebotDialog', '#CybotCookiebotDialogBodyUnderlay',
    '.cc-window', '.cookieconsent',
    '.osano-cm-window', '.osano-cm-dialog',
    '#usercentrics-root', '#didomi-host',
    '.termly-consent-banner', '#termly-code-snippet-support',
    '#hs-eu-cookie-confirmation',
    '.cky-consent-container', '.cky-modal',
    '#gdpr-cookie-message', '#cookie-law-info-bar',
    '#klaro', '.klaro',
    '#tarteaucitronRoot',
    '#cookiescript_injected', '#cookiefirst-root',
  ];

  // A banner talks about cookies AND offers a way to dismiss it. Requiring both
  // matters: a site with a "Cookies" link in a sticky nav (or a /cookies policy
  // page) hits the first test alone, and hiding its nav would be worse than
  // leaving the banner in.
  var CONSENT_TEXT = /cookie|consent|gdpr|privacy preferences/i;
  var DISMISS_TEXT = /accept|agree|allow|got it|understood|dismiss|reject|decline|essential|manage|preferences|\bok\b/i;

  var hidden = [];

  function hide(el, why) {
    if (!el || el.nodeType !== 1) return;
    if (el.getAttribute('data-st-banner-hidden')) return;
    // Never hide something that contains the page's main content — that would
    // blank the capture instead of cleaning it.
    var main = document.querySelector('main') || document.body;
    if (el !== main && el.contains(main)) return;
    el.setAttribute('data-st-banner-hidden', '1');
    el.style.setProperty('display', 'none', 'important');
    hidden.push(why);
  }

  for (var i = 0; i < VENDOR_SELECTORS.length; i++) {
    try {
      var found = document.querySelectorAll(VENDOR_SELECTORS[i]);
      for (var j = 0; j < found.length; j++) hide(found[j], VENDOR_SELECTORS[i]);
    } catch (err) {
      /* an unsupported selector must not stop the rest */
    }
  }

  // Generic pass: an overlay pinned to the viewport, big enough to matter, that
  // both mentions consent and carries a dismiss control.
  var all = document.querySelectorAll('body *');
  for (var k = 0; k < all.length; k++) {
    var el = all[k];
    var cs;
    try {
      cs = getComputedStyle(el);
    } catch (err) {
      continue;
    }
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;

    var rect = el.getBoundingClientRect();
    if (rect.width < 200 || rect.height < 40) continue;

    var text = (el.innerText || '').slice(0, 600);
    if (!CONSENT_TEXT.test(text)) continue;

    var controls = el.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]');
    var hasDismiss = false;
    for (var c = 0; c < controls.length; c++) {
      var label = (controls[c].innerText || controls[c].value || controls[c].getAttribute('aria-label') || '');
      if (DISMISS_TEXT.test(label)) {
        hasDismiss = true;
        break;
      }
    }
    if (!hasDismiss) continue;

    hide(el, 'overlay: "' + text.slice(0, 60).replace(/\s+/g, ' ') + '"');
  }

  return hidden;
};

// For injection into a proxied document (see src/previewProxy.js).
export const HIDE_COOKIE_BANNERS_SCRIPT = `<script>
(function () {
  var run = ${HIDE_COOKIE_BANNERS_FN.toString()};
  function apply() { try { run(); } catch (err) {} }
  apply();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  }
  // Consent platforms usually inject their banner after load, so re-check for a
  // short window rather than only once.
  var tries = 0;
  var timer = setInterval(function () {
    apply();
    if (++tries > 20) clearInterval(timer);
  }, 250);
})();
</script>`;

// For a Playwright page, just before capturing.
export async function hideCookieBanners(page) {
  try {
    return await page.evaluate(HIDE_COOKIE_BANNERS_FN);
  } catch (err) {
    console.error(`[cookieBanner] could not hide banners: ${err.message}`);
    return [];
  }
}
