# Screenshot Taker — Design Spec

## Purpose

Automate the manual work of capturing per-section, multi-viewport screenshots of
finished websites for Instagram posting. Today this is done by hand: scroll to
each section, resize the browser to each device width, screenshot, crop, repeat
for every page. This tool does that automatically and also produces the
composite device-mockup image (iMac / laptop / iPad / iPhone frames) currently
assembled by hand for IG posts.

Instagram auto-posting is explicitly out of scope for v1. The tool's output is
structured so that step can be added later without rework.

## Input

A single URL, entered in a local web UI:

- **Live URL** — any deployed site.
- **Local files** — user selects a local folder; tool spins up an ephemeral
  static file server (auto-picks a free port) and treats it as a normal URL
  from that point on.
- **Local dev server URL** — user already has `npm run dev` etc. running;
  paste the localhost URL directly.

All three collapse to "give the tool a URL" once local files are served.

## Section detection modes

User picks one per run:

1. **Auto-detect (default)** — scan the DOM for top-level semantic blocks
   (`<section>`, `<header>`, `<footer>`, or top-level `<div>`s with a visually
   distinct background/boundary) and treat each as a "section" to screenshot.
2. **CSS selector list** — user supplies explicit selectors
   (e.g. `#hero, .menu-section`); tool screenshots exactly those, in order.
3. **Full-page only** — skip section splitting; one full-page scrolling
   screenshot per viewport per page.

If auto-detect finds no clear sections on a given page, that page
automatically falls back to full-page mode (logged, not a hard failure).

## Site crawl scope

Given a homepage URL, the tool crawls same-domain internal links (BFS,
deduped) and processes every page found, up to a safety cap on total pages
(prevents runaway crawls on very large sites). No crawling of external
domains.

## Viewports

Four fixed presets shot for every section/page, matching current IG mockup
style:

| Name    | Width  |
|---------|--------|
| Desktop | 1920px |
| Laptop  | 1440px |
| Tablet  | 768px  |
| Mobile  | 390px  |

## Pipeline

1. User submits URL + section mode via web UI, clicks Run.
2. Tool crawls same-domain pages from the given homepage.
3. For each page × each of the 4 viewports: load page (Playwright), wait for
   network idle, detect sections per chosen mode, screenshot each section
   clipped to its bounding box.
4. Raw screenshots saved to:
   `output/<site>/<page>/<viewport>/<section-slug>.png`
5. For each section present across all 4 viewports, generate a composite
   image: an HTML page with CSS/SVG device-frame silhouettes (iMac, laptop,
   iPad, iPhone) arranged together, the matching raw screenshot dropped into
   each frame, rendered to a single PNG via Playwright. Saved to:
   `output/<site>/<page>/composites/<section-slug>-composite.png`
6. Web UI shows live progress during the run (page/section/viewport being
   processed), then a gallery grouped by page → section, with a "download
   all as zip" action.
7. A `manifest.json` is written per run at `output/<site>/manifest.json`
   listing site, pages crawled, sections found, and paths to every raw and
   composite image generated. This is the hook a future Instagram
   auto-posting step reads from — no rework needed to add that later.

## Architecture

- **Backend**: Node.js + Express. Owns the crawl/screenshot/composite
  pipeline and serves the frontend.
- **Browser automation**: Playwright (headless Chromium) for page loading,
  section detection (DOM queries), screenshot capture, and composite
  rendering (render the frame-layout HTML page itself to PNG).
- **Frontend**: single simple local web page — URL input, section-mode
  picker, Run button, progress log, results gallery, zip download. No
  framework needed; plain HTML/CSS/JS is enough for this scope.
- **Local file serving**: when input is a local folder, spin up a minimal
  static file server on an auto-picked free port before handing a URL into
  the same pipeline as any other run.

## Error handling

- Page load timeout: retry once, then skip that page and log the failure;
  rest of the crawl continues.
- No sections detected on a page (auto-detect mode): fall back to full-page
  mode for that page only, logged.
- Crawl safety cap: stop discovering new pages past a max-page limit so a
  huge site doesn't run indefinitely.
- Local static server: auto-pick a free port to avoid collisions.

## Testing

- Manual end-to-end run against a small sample static site and a live
  real-world site (e.g. one of the existing IG project sites), covering all
  three section-detection modes.
- Unit tests for the section-detection heuristic against fixture HTML
  (clear sections, no sections, nested sections).
- Verify composite image output dimensions/layout render correctly across a
  couple of example screenshots (different aspect ratios).

## Out of scope (v1)

- Instagram auto-posting (manifest.json is the future integration point).
- Custom/branded mockup templates beyond the generated device-frame style.
- Authentication-gated sites (crawler assumes publicly accessible pages).
