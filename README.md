# Screenshot Taker

Point it at a website — a live URL or a local project folder — and it crawls every page,
screenshots every section at 4 device viewports, and builds ready-to-post composite
mockup images (desktop / laptop / tablet / mobile side by side). No more manually
resizing your browser and cropping screenshots for every section of every page.

## What it does

1. **Crawl** — give it a homepage URL (or a local folder) and it follows same-domain
   links to find every page.
2. **Detect sections** — auto-detects each page's content blocks (or use your own CSS
   selectors, or just capture the full page).
3. **Screenshot** — captures every section at Desktop (1920px), Laptop (1440px),
   Tablet (768px), and Mobile (390px).
4. **Composite** — builds one framed mockup image per section, with all 4 viewports
   arranged together — the same style you'd use for a portfolio or Instagram post.
5. **Download** — grab everything as a zip, or browse the results in the gallery.

Everything is also written to a `manifest.json` per run, so the raw data is there for
whatever comes next (e.g. automated posting).

## Requirements

- Node.js >= 18
- Google Chrome/Chromium (installed automatically via Playwright)

## Setup

```bash
npm install
npx playwright install chromium
```

## Run

```bash
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

- **Live URL** — paste any public URL.
- **Local folder** — paste the absolute path to a folder containing your site's
  `index.html`; it's served locally for you automatically.

## Development

```bash
npm test
```

Runs the full test suite (`node:test`) — crawler, section detection, screenshot
capture, composite rendering, manifest, and the full HTTP API, all against real
fixture sites and a real headless browser.

## Project layout

```
src/            pipeline: crawler, section detector, screenshot capture,
                composite builder, manifest, Express server + API routes
public/         frontend (plain HTML/CSS/JS — no framework)
test/           node:test suite + fixture sites
output/         generated screenshots and composites (git-ignored)
```

## License

MIT
