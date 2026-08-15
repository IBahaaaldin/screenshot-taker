# Live Interactive Multi-Device Preview — Design

## Goal

Let the user preview a target site live, interactively, at all 4 device
viewports simultaneously (desktop/laptop/tablet/mobile) inside the same
Apple-hardware bezel frames used by the composite mockups — like
fireship.dev/amiresponsive — before or independent of running a full
capture. Scrolling or clicking a link in any one frame moves all 4 in sync.
Purely exploratory: nothing is written to `output/`, no manifest entry, no
screenshots taken.

## Non-goals

- Not a replacement for the crawl+screenshot+composite pipeline.
- Not a general-purpose reverse proxy. SPA-heavy sites using client-side
  routing or dynamic `fetch()`/XHR for content will not proxy perfectly —
  acceptable, since the tool already targets static/marketing-style sites.
  The UI states this limitation.
- No accessibility of proxied-page cookies/auth/session state beyond a
  normal unauthenticated page load.

## Architecture

Two pieces: a server-side proxy that makes any live URL embeddable and
same-origin, and a frontend page that renders 4 synced iframes against it.

### Backend: `src/previewProxy.js`

Mounted on the existing Express app:

- `GET /api/preview/page?url=<encoded target URL>`
  - Fetches the target HTML server-side (`fetch`).
  - Parses with `cheerio`, rewrites every `href`, `src`, and `action`
    attribute that points at an http(s) URL (absolute or resolved-relative
    against `url`) to `/api/preview/asset?url=<resolved absolute URL>`.
  - Rewrites `url(...)` references inside inline `<style>` blocks and
    `style="..."` attributes the same way.
  - Injects one `<script>` before `</body>` (see "Sync bridge" below).
  - Responds with the rewritten HTML. Explicitly does NOT forward
    `X-Frame-Options` or `Content-Security-Policy: frame-ancestors` headers
    from the origin response — those are what would otherwise block
    framing.
- `GET /api/preview/asset?url=<encoded absolute URL>`
  - Streams the target resource (CSS, JS, image, font, etc.) through with
    its original `Content-Type`, no rewriting except: CSS responses get the
    same `url(...)` rewrite pass as inline styles, since a stylesheet can
    reference further assets.
  - Also drops frame-blocking headers here (some sites set CSP on
    sub-resources too).
- Local-folder sources: the existing `localServer.js` already serves them
  from `http://localhost:<port>` with no frame-blocking headers, so those
  load directly via `/api/preview/page?url=<local server URL>` — same code
  path, no special-casing needed beyond it being a normal fetch target.

**Sync bridge script** (injected into every proxied page):

```html
<script>
(function () {
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (!a) return;
    e.preventDefault();
    parent.postMessage({ type: 'preview-nav', url: a.href }, '*');
  }, true);

  var suppressScroll = false;
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'preview-scroll-to') {
      suppressScroll = true;
      window.scrollTo(0, e.data.y);
      suppressScroll = false;
    }
  });
  window.addEventListener('scroll', function () {
    if (suppressScroll) return;
    parent.postMessage({ type: 'preview-scroll', y: window.scrollY }, '*');
  }, { passive: true });
})();
</script>
```

Form submissions and non-http(s) links (mailto:, javascript:, #anchors
without preventDefault already handled by the browser) are left alone —
only real navigations get intercepted.

### Frontend

- New `public/preview.html` + `public/preview.js`, sharing `style.css` and
  the top nav from `index.html`.
- URL entry field + "Load preview" button. On submit, sets all 4 iframe
  `src` to `/api/preview/page?url=<encoded value>`.
- Reuses the device-bezel visual language from `composite.js`'s layout
  (same relative desktop/laptop/tablet/mobile positions as the
  amiresponsive-style hero) — each bezel holds a live `<iframe>` instead of
  a static image, CSS-scaled (`transform: scale(...)`) so the iframe's
  fixed device-width viewport (1920/1440/768/390) fits the bezel's display
  area.
- **Sync handling** in `preview.js`: a single `window.addEventListener('message', ...)`
  listens for `preview-nav` and `preview-scroll` from any of the 4 iframes.
  - `preview-nav`: re-point the other 3 iframes' `src` to
    `/api/preview/page?url=<new url>` — the sender's own iframe already
    navigated natively (its click was `preventDefault`ed, but the proxy
    could instead let it navigate by not intercepting its own frame; to
    keep all 4 identical, the sender also gets its `src` set explicitly
    rather than relying on native navigation).
  - `preview-scroll`: `postMessage({type:'preview-scroll-to', y}, '*')` to
    the other 3 iframes' `contentWindow`.
  - A per-event-type in-flight flag prevents feedback loops (a
    `preview-scroll-to` causing a `preview-scroll` echo back out).
- Small limitation banner in the UI: "Works best on standard multi-page
  sites — heavily JS-driven single-page apps may not preview perfectly."

### Wiring into the existing run form

- On the main page's run form (`public/index.html`), add a "Preview live"
  button next to the Source URL field (only enabled for `sourceType=url` or
  a filled `sourceValue`). Clicking it opens `preview.html?url=<value>` in
  a new tab — reuses the same standalone page rather than duplicating the
  4-frame UI inline, keeping the run form itself unchanged in complexity.
- Nav bar gets a new "Live Preview" link to `preview.html` for the
  standalone entry point.

## Data flow summary

```
User loads preview.html?url=X
  → 4 iframes request /api/preview/page?url=X
  → server fetches X, rewrites asset URLs + injects sync script, returns HTML
  → each iframe's sub-requests hit /api/preview/asset?url=...
  → user scrolls/clicks inside one iframe
  → injected script postMessages parent
  → parent relays to the other 3 iframes
```

## Testing

- `test/previewProxy.test.js`: fetch `/api/preview/page?url=<fixture site
  URL>` against the existing local fixture server, assert relative
  `href`/`src` in the response got rewritten to `/api/preview/asset?url=...`
  absolute-resolved paths, assert response has no
  `X-Frame-Options`/`Content-Security-Policy` header even if the fixture
  server were to send one, assert the sync-bridge `<script>` is present
  before `</body>`.
- `test/previewProxy.test.js`: `/api/preview/asset?url=<fixture CSS file>`
  returns the CSS with any `url(...)` rewritten, correct `Content-Type`.
- No browser-level (Playwright) test for the iframe sync itself — out of
  scope for the automated suite, verified manually in-browser same as the
  lightbox/filter feature was.
