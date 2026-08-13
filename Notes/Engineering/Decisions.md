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
