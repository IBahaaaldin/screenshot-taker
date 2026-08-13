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

- Node.js >= 20.9.0
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

## Instagram posting setup

Posting requires an Instagram **Professional (Business or Creator)**
account linked to a Facebook Page, and a Meta developer app with Graph API
access. This is a one-time setup you do yourself in your own browser —
this tool never touches your Facebook/Instagram login.

1. In the Instagram app: Settings → Account type and tools → switch to a
   Professional account (Business or Creator) if you haven't already.
2. Create (or use an existing) Facebook Page, and link your Instagram
   account to it: Instagram Settings → Linked accounts, or via
   [Meta Business Suite](https://business.facebook.com).
3. Go to [developers.facebook.com](https://developers.facebook.com) →
   My Apps → Create App → choose "Business" as the app type.
4. In your new app, add the **Instagram Graph API** product.
5. Open the [Graph API Explorer](https://developers.facebook.com/tools/explorer),
   select your app and your Page, and generate a User Access Token with
   the `instagram_basic`, `instagram_content_publish`, `pages_show_list`,
   and `pages_read_engagement` permissions.
6. Exchange that short-lived token for a long-lived one (valid ~60 days) —
   the Graph API Explorer's token has a "debug"/extend option, or use the
   `oauth/access_token` endpoint with `grant_type=fb_exchange_token`.
7. Find your Instagram Business Account ID:
   `GET /{page-id}?fields=instagram_business_account&access_token=...`
8. Copy `.env.example` to `.env` and fill in `IG_BUSINESS_ACCOUNT_ID` and
   `IG_ACCESS_TOKEN`. Restart the app (`npm start`) to pick them up.

Long-lived tokens expire after ~60 days — repeat steps 5-8 to refresh.

**What happens when you click Post:** Instagram's servers need to fetch your
images over the public internet, so clicking Post briefly starts a small
dedicated file server (serving your generated output files — not the rest of
the app, since no API routes are reachable through it) and exposes it via a public URL through
[localtunnel](https://localtunnel.github.io/www/). That public URL stays
reachable for roughly as long as the post takes — typically well under a
minute for a single image, up to several minutes for a large carousel — and
is closed automatically as soon as posting finishes or fails. Note that
localtunnel is a third-party service: it can see the traffic passing through
the tunnel it creates for you.

### Auto-post (unattended scheduling)

The run form has an **Auto-post** checkbox. When checked (and Instagram is
configured — see above), every section with a composite in that run is
automatically queued for posting instead of waiting for you to click Post on
each one individually. (A section that failed to capture at every viewport
has no composite, so it's skipped rather than queued.)

- **Unattended posting**: a background scheduler runs inside the app process
  and ticks every 15 minutes, checking the queue for anything due and posting
  at most one item per tick. It only starts if `IG_BUSINESS_ACCOUNT_ID` and
  `IG_ACCESS_TOKEN` are set. This means the "temporary public tunnel"
  described above now happens automatically and unattended — every time the
  scheduler posts a due item, it opens the same short-lived localtunnel URL,
  just without a human present to notice it happening.
- **Queuing math**: auto-queued items are spaced `SCHEDULE_INTERVAL_HOURS`
  apart (default 24 — see `.env.example`; a non-numeric or zero value
  silently falls back to that default). If a run produces N sections, the
  first posts as soon as it's due and the last one won't post until roughly
  `(N-1) x SCHEDULE_INTERVAL_HOURS` after the first. A second auto-post run
  against the same site doesn't post
  concurrently with the first — its items are queued to start *after* the
  first run's last already-queued item, so a busy site can end up with a long
  backlog. Check the Queue panel to see each item's `scheduledFor` time.

## License

MIT
