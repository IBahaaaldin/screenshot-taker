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
