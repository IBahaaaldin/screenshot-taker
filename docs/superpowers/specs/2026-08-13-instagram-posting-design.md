# Instagram Auto-Posting — Design Spec

## Purpose

Screenshot Taker already produces composite mockup images and a `manifest.json`
per run — this was built as the deliberate integration point for posting.
This feature closes the loop: post those composites to Instagram directly
from the tool, instead of manually downloading and uploading them.

## Phasing

This is delivered in two phases:

- **Phase 1** — manual review-and-post. Proves the real end-to-end mechanism
  (Instagram Graph API + public image hosting via tunnel) works against a
  real account before anything is automated on top of it.
- **Phase 2** — fully-automatic posting and a scheduled queue, built on the
  Phase 1 posting primitives once they're proven.

## Instagram API constraints (why the design looks like this)

- Posting requires the Instagram account to be a **Professional (Business or
  Creator) account** linked to a Facebook Page, and a **Meta developer app**
  with Instagram Graph API access and a long-lived access token.
- The Graph API's media-creation endpoint accepts an `image_url` — it fetches
  the image itself from a **public HTTPS URL**. It does not accept direct
  file uploads. Since this tool's output lives on the user's local machine,
  each post needs a temporary public URL for that one image (or set of
  images, for a carousel).
- Posting is two API calls: create a media container (`POST
  /{ig-user-id}/media`), poll it until Instagram finishes fetching/processing
  the image (`GET /{creation_id}?fields=status_code`), then publish it
  (`POST /{ig-user-id}/media_publish`). A carousel post additionally creates
  one child container per image first (`is_carousel_item: true`), then a
  parent container referencing those children (`media_type: CAROUSEL`).
- Instagram caps posting at **25 posts per rolling 24 hours** per account.
- Long-lived access tokens expire after **~60 days** and must be manually
  refreshed (no silent auto-refresh via this API).

## Public image hosting: local tunnel

Given the constraints above, and that this is a local single-user tool
(no always-on public server), image hosting for a post is solved with a
temporary local tunnel: the `localtunnel` npm package exposes the running
Express server (specifically its `/output` static route) via a public
HTTPS URL, with no account signup required. A tunnel is started
immediately before a post, used to build the `image_url`(s) Instagram needs
to fetch, and closed immediately after that post completes (or the queue
batch completes), minimizing how long anything is publicly exposed.

## Credentials

Stored in a local `.env` file (git-ignored), never entered into the app's
UI or committed:

```
IG_BUSINESS_ACCOUNT_ID=...
IG_ACCESS_TOKEN=...
SCHEDULE_INTERVAL_HOURS=24        # Phase 2 only
```

The user obtains these themselves via Meta's own developer tools (Meta for
Developers app + Graph API Explorer), following a setup guide provided
separately (chat walkthrough, not part of this codebase) — this requires
their own Meta/Instagram login, which nothing in this codebase touches or
automates.

## Phase 1: Manual review-and-post

### Data model — `post-queue.json`

Written by `src/postQueue.js`, same read/write pattern as `src/manifest.js`:

```
{
  items: [
    {
      id: string,                        // uuid
      siteName: string,
      pageUrl: string,
      kind: 'single' | 'carousel',
      images: string[],                  // absolute paths to composite PNG(s)
      caption: string,
      status: 'queued' | 'posting' | 'posted' | 'failed',
      createdAt: string,                 // ISO timestamp
      postedAt: string | null,
      igMediaId: string | null,
      error: string | null
    }
  ]
}
```

### Flow

1. After a run completes and the gallery renders, the user picks one
   composite ("Post now") or a whole page's composites ("Post as carousel").
2. The UI shows an editable caption box pre-filled with an auto-generated
   draft (see Caption drafting below).
3. On submit, the item is added to `post-queue.json` with `status: 'queued'`
   and immediately posted (Phase 1 has no scheduling delay — "queued" here
   just means "recorded before attempting", so a crash mid-post is
   recoverable/visible rather than silently lost).
4. Posting: start a tunnel, build the public `image_url`(s), create the
   container(s), poll until `FINISHED`, publish, close the tunnel, update
   the queue item to `status: 'posted'` with `igMediaId` and `postedAt` —
   or `status: 'failed'` with `error` if any step fails. No automatic retry.
5. The UI's Queue panel lists all items with their status, refreshable via
   a simple `GET /api/queue`.

### Caption drafting

`src/caption.js` generates a starting draft from data already in the
manifest: site name, page URL, section slug, and a small set of generic
hashtags (e.g. `#webdesign #restaurant #instagood`, exact list is a static
constant, not configurable in Phase 1). The user can edit this freely
before posting; nothing is posted without going through the editable box.

### API routes (`src/routes/postQueue.js`)

- `POST /api/queue` — body `{siteName, pageUrl, kind, images, caption}` →
  creates a queue item and immediately attempts to post it, returns the
  item (with final status).
- `GET /api/queue` — returns all queue items, newest first.

### Error handling

- Token/account misconfiguration (missing `.env` values) → the queue POST
  returns 400 immediately with a clear message, no tunnel is started.
- Any failure during container creation, polling (including a `status_code`
  of `ERROR` from Instagram), or publish → item marked `failed` with the
  underlying error message, tunnel is always closed in a `finally`.
- The 25-post/24h cap is checked (by counting `posted` items with
  `postedAt` in the last 24h in `post-queue.json`) before starting a post;
  if at the cap, the item is marked `failed` with a clear "rate limit"
  message rather than attempting and getting rejected by Instagram.

## Phase 2: Automatic + scheduled queue

Builds on Phase 1's `postQueue.js` and `instagram.js` — no changes to the
posting mechanism itself, only to how items get added to the queue and when
they're posted.

- **Fully automatic trigger**: an opt-in flag on `POST /api/run` (e.g.
  `autoPost: true`). When the pipeline's `run-done` event fires, every
  section's composite is queued automatically using the auto-generated
  caption with no manual edit step, `scheduledFor` set immediately (posts
  as soon as the scheduler's next tick runs).
- **Scheduled queue**: queue items gain a `scheduledFor` timestamp. A
  background interval (`src/scheduler.js`), started once when the Express
  server boots, wakes on a fixed cadence (e.g. every 15 minutes) and posts
  at most one due (`scheduledFor <= now`, `status: 'queued'`) item per
  tick — spacing posts out using `SCHEDULE_INTERVAL_HOURS` between each
  newly-queued item's `scheduledFor` rather than posting a whole batch at
  once.
- Manual "post now" (Phase 1) remains available alongside the scheduler at
  all times — it bypasses `scheduledFor` and posts immediately.

## Testing

Real posting cannot be part of the automated suite — it requires live
credentials and would post to a real Instagram account. What's covered:

- `caption.js` — pure function, unit tested directly.
- `postQueue.js` — read/write round-trip, same pattern as `manifest.test.js`.
- `instagram.js` — request-building and response-parsing logic tested with
  a mocked `fetch` (assert the correct endpoint/payload is sent for single
  vs carousel; assert polling stops on `FINISHED` and surfaces `ERROR`
  correctly) — the real Graph API is never called in tests.
- `tunnel.js` — thin wrapper; tested by confirming it returns a `close()`
  that doesn't throw when called (the actual `localtunnel` network behavior
  is out of scope for unit tests).
- `scheduler.js` (Phase 2) — "is this item due" and "am I at the rate
  limit" logic tested as pure functions of a fixed clock/queue state, not
  a real timer.
- Queue API routes — tested via real HTTP against the Express app (fetch),
  with `instagram.js`'s actual network calls mocked/stubbed at that layer
  so no real post happens in CI.
- **One real post against a real account is a manual verification step**
  the user performs after Phase 1 lands, the same way the earlier
  real-website capture test was a manual step outside the automated suite.

## Out of scope

- Posting to platforms other than Instagram.
- Multi-account support (one `IG_BUSINESS_ACCOUNT_ID`/token pair at a time).
- Automatic token refresh (a 60-day expiry warning is logged; renewal is
  manual, following the same setup guide used the first time).
- Editing/deleting an already-published Instagram post from within the tool.
- Analytics/insights on posted content.
