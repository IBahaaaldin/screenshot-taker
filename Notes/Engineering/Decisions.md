# Engineering Decisions

## 2026-08-13 — Stack
Node.js + Express backend, Playwright for browser control, plain HTML/CSS/JS
frontend. Local web app, no framework needed at this scope.

## 2026-08-13 — Vault
Project root doubles as Obsidian vault. Spec lives at
`docs/superpowers/specs/`, symlinked into `Notes/Design.md` — single source
of truth, no duplication.

## 2026-08-12 — Real-site testing found & fixed a structural capture bug
Tested against the actual Baba Ganoush site (Prototype - Resturants folder).
`min-height:100vh` hero section caused viewport-resize-to-fit-page approach
to loop forever (resize -> vh grows -> page grows -> resize again...),
silently blacking out most sections. Fixed by switching to Playwright
`locator.screenshot()` / `fullPage:true`, which don't depend on viewport
size at all. Also fixed: scroll-reveal animations (opacity:0 +
IntersectionObserver) never fired since the old approach never scrolled.
Verified output now matches the original hand-made Instagram posts.

## 2026-08-13 — Instagram auto-posting (Phase 1) shipped
Manual review-and-post flow: generate composites -> pick one (or a whole
page as a carousel) -> edit auto-drafted rich caption -> post to real
Instagram account via Graph API. Images hosted via a temporary localtunnel
pointed at a dedicated ephemeral static server (reusing localServer.js)
scoped to the output directory only — not the main app, so no API routes
are reachable through the public tunnel URL during a post.

Two things changed mid-build at user request, both now the default:
- Captions are rich/story-style (hook, metaphor, feature checklist, CTA,
  full hashtag block) instead of a bare "site — heading" stub.
- Composite images are one overlapping "hero mockup" (monitor+laptop+
  tablet+phone layered, amiresponsive.com style) instead of 4 separate
  side-by-side labeled boxes — this changed src/composite.js for the base
  app too, not just the new posting feature.

Final review found and fixed: .env wasn't git-ignored (real credential
leak path via the README's own setup steps), unguarded async route
handlers could crash the process on a corrupt post-queue.json, the queue
write wasn't atomic, the tunnel exposed the whole app rather than just
output files, and carousels had no 10-image cap (Instagram's real limit).
A second-order bug surfaced during re-verification of the first fix wave:
the atomic-write temp filename collided under concurrency (confirmed
empirically, 9/10 trials failed) — fixed with crypto.randomUUID().

Real Instagram posting (an actual post landing on a real account) is a
manual step for the user — needs their own Meta developer app + access
token, which nothing in this codebase can obtain on its own.

## 2026-08-13 — Instagram auto-posting Phase 2 (automation) shipped
Built on top of Phase 1's manual posting: an `autoPost` flag on a run
auto-queues every captured section with a spaced `scheduledFor` (default
24h apart, via SCHEDULE_INTERVAL_HOURS), and a background scheduler
(started only when `node src/server.js` actually boots, never in tests,
never without IG credentials configured) posts at most one due item every
15 minutes.

Final review found a genuine concurrency bug: the scheduler and a manual
"Post now" click run in the same process and could overlap during a real
post (which takes real time — tunnel setup + Graph API polling), so the
first read-modify-write cycle to finish could stomp the other's write to
post-queue.json. Worst case: an item already published to the real
Instagram account could get reverted to "queued" on disk and posted a
second time by the next tick.

First fix attempt (a lock local to postingService.js) was too narrow —
two OTHER call sites (the manual-post route's item-creation append, and
autoQueueManifest's bulk append after an autoPost run) mutated the same
file outside that lock. Re-review empirically reproduced both: an append
racing an in-flight post got silently erased, and two overlapping
scheduler ticks could both actually publish the same item to Instagram
twice. Root-caused to "the lock lives in the wrong module" — fixed
properly by moving to one shared `withQueueLock(queueFilePath, fn)` in
postQueue.js, used by literally every mutator (route append,
autoQueueManifest append, and the actual posting logic), plus a
status-recheck after acquiring the lock so a no-longer-queued item is
never re-posted. Independently re-verified via adversarial repro scripts
against both the broken and fixed versions — regressions reproduced
pre-fix, could not be reproduced post-fix across many timing variants.

This is the kind of bug that's easy to miss in a single-threaded mental
model ("it's just Node, nothing runs at the same time") but very real
once you have a background timer and a human both able to trigger the
same write path — worth remembering for any future feature that adds a
second, unattended writer to state a human-triggered path also mutates.
