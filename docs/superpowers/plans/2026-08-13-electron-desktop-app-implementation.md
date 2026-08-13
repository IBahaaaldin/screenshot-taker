# Electron Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package Screenshot Taker as a double-clickable macOS `.app` on the Desktop — Electron shell around the existing Express app, no terminal required to run it.

**Architecture:** `electron/main.js` runs the existing Express app in-process and opens a `BrowserWindow` at it. `electron-builder` packages it, bundling a pre-downloaded Playwright Chromium binary via `extraResources` so the packaged app doesn't need a first-run download. A build script copies the result to `~/Desktop/Screenshot Taker.app`.

**Tech Stack:** Electron, electron-builder (new devDependencies), reusing the existing Express/Playwright app unchanged.

## Global Constraints

- No changes to `src/server.js`'s existing `createApp()` default behavior, `npm start`, or the existing test suite — `npm test` must stay fully green throughout.
- Electron's own output directory is `app.getPath('userData')`-based, not the project's `output/` folder.
- Port fixed at 3000, matching `npm start`.
- macOS only, `target: "dir"` (no dmg/installer), no code signing/notarization, no auto-update.
- Full spec: `docs/superpowers/specs/2026-08-13-electron-desktop-app-design.md`.

---

### Task 1: Electron main process + dev mode

**Files:**
- Create: `electron/main.js`
- Modify: `package.json` (add `electron` devDependency, add `"electron": "electron electron/main.js"` script)

**Interfaces:**
- Consumes: `createApp({ outputRoot })` from `src/server.js` (existing export), `startScheduler({ outputRoot, igUserId, accessToken })` from `src/scheduler.js` (existing export).
- Produces: a runnable Electron entry point at `electron/main.js`.

- [ ] **Step 1: Install Electron as a dev dependency**

Run: `npm install --save-dev electron`

- [ ] **Step 2: Write `electron/main.js`**

```js
// electron/main.js
import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { startScheduler } from '../src/scheduler.js';

const PORT = 3000;

async function startServer() {
  const outputRoot = path.join(app.getPath('userData'), 'output');
  const expressApp = createApp({ outputRoot });

  const igUserId = process.env.IG_BUSINESS_ACCOUNT_ID;
  const accessToken = process.env.IG_ACCESS_TOKEN;
  if (igUserId && accessToken) {
    startScheduler({ outputRoot, igUserId, accessToken });
  }

  return new Promise((resolve, reject) => {
    const server = expressApp.listen(PORT, '127.0.0.1', () => resolve(server));
    server.on('error', (err) => {
      dialog.showErrorBox(
        'Screenshot Taker failed to start',
        `Could not start the local server on port ${PORT}: ${err.message}`
      );
      reject(err);
    });
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    title: 'Screenshot Taker',
    backgroundColor: '#0a0a0a',
  });
  await win.loadURL(`http://localhost:${PORT}`);
}

app.whenReady().then(async () => {
  try {
    await startServer();
    await createWindow();
  } catch (err) {
    app.quit();
    return;
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 3: Add the dev script**

In `package.json`'s `"scripts"` block, add:

```json
"electron": "electron electron/main.js"
```

- [ ] **Step 4: Verify dev mode runs**

Run: `npm run electron`
Expected: an Electron window opens titled "Screenshot Taker", showing the same UI as `npm start` at `http://localhost:3000`. Confirm by checking the window loaded (no blank/error page) — this is a manual check, there's no automated test for Electron's own window lifecycle (see plan's Global Constraints / spec's Testing section for why). Quit the app (Cmd+Q) when confirmed.

- [ ] **Step 5: Confirm the existing test suite is untouched**

Run: `npm test`
Expected: PASS, same count as before this task (this task adds no files under `test/`, `src/`, or `public/` — only `electron/` and `package.json`).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json electron/main.js
git commit -m "feat: add Electron main process for desktop app shell"
```

---

### Task 2: App icon

**Files:**
- Create: `assets/icon.png` (1024x1024 source)
- Create: `assets/icon.iconset/` (generated intermediate — see step 2, do NOT hand-author each size)
- Create: `assets/icon.icns` (final, committed)

**Interfaces:**
- Produces: `assets/icon.icns`, referenced by Task 3's electron-builder config as `mac.icon`.

- [ ] **Step 1: Generate a 1024x1024 source icon**

Design: dark background (`#0a0a0a`, matching the app's existing dark theme
in `public/style.css`), a simple centered camera-shutter or viewfinder-frame
glyph in a warm off-white/cream tone (matching the app's existing accent
color — check `public/style.css`'s CSS custom properties for the exact
accent hex before picking one, to stay consistent with the app's own
branding rather than inventing a new color).

Use any available image-generation tool to produce this as a clean, flat,
high-contrast 1024x1024 PNG at `assets/icon.png` — it needs to read clearly
at small sizes (16x16 in the Dock), so keep the glyph simple and bold, no
fine detail or text.

- [ ] **Step 2: Convert to `.icns` via macOS's `iconutil`**

Generate the required iconset sizes with `sips` (all standard macOS icon
sizes: 16, 32, 64, 128, 256, 512, 1024, plus @2x retina variants):

```bash
mkdir -p assets/icon.iconset
sips -z 16 16     assets/icon.png --out assets/icon.iconset/icon_16x16.png
sips -z 32 32     assets/icon.png --out assets/icon.iconset/icon_16x16@2x.png
sips -z 32 32     assets/icon.png --out assets/icon.iconset/icon_32x32.png
sips -z 64 64     assets/icon.png --out assets/icon.iconset/icon_32x32@2x.png
sips -z 128 128   assets/icon.png --out assets/icon.iconset/icon_128x128.png
sips -z 256 256   assets/icon.png --out assets/icon.iconset/icon_128x128@2x.png
sips -z 256 256   assets/icon.png --out assets/icon.iconset/icon_256x256.png
sips -z 512 512   assets/icon.png --out assets/icon.iconset/icon_256x256@2x.png
sips -z 512 512   assets/icon.png --out assets/icon.iconset/icon_512x512.png
sips -z 1024 1024 assets/icon.png --out assets/icon.iconset/icon_512x512@2x.png

iconutil --convert icns assets/icon.iconset --output assets/icon.icns
```

- [ ] **Step 3: Verify**

Run: `file assets/icon.icns`
Expected output contains "Mac OS X icon" — confirms a valid `.icns` was produced.

- [ ] **Step 4: Commit**

The intermediate `assets/icon.iconset/` directory is build scratch, not needed after conversion — do not commit it (add `assets/icon.iconset/` to `.gitignore`). Commit only the source PNG and the final icns:

```bash
echo "assets/icon.iconset/" >> .gitignore
git add .gitignore assets/icon.png assets/icon.icns
git commit -m "feat: add app icon"
```

---

### Task 3: Packaging, build script, and bundled Chromium

**Files:**
- Modify: `package.json` (add `electron-builder` devDependency, add `"build"` config block, add `"dist"` script)
- Create: `scripts/build-app.sh`

**Interfaces:**
- Consumes: `assets/icon.icns` from Task 2, `electron/main.js` from Task 1.
- Produces: `~/Desktop/Screenshot Taker.app` (not committed to git — it's a local build artifact on the user's actual Desktop, outside the repo entirely).

- [ ] **Step 1: Install electron-builder**

Run: `npm install --save-dev electron-builder`

- [ ] **Step 2: Confirm the Playwright Chromium cache exists and find its exact directory name**

Run: `ls "$HOME/Library/Caches/ms-playwright"`
Expected: a directory whose name starts with `chromium-` or
`chromium_headless_shell-` (the exact suffix is a Playwright-internal build
number that varies by installed Playwright version — do not hardcode a
specific number in any config; use a glob like `chromium-*/**` as shown in
Step 3, not a literal path).

If this directory doesn't exist, run `npx playwright install chromium`
first (same command the project's own README setup instructions already
use) — the packaging step needs it present.

- [ ] **Step 3: Add the `build` config to `package.json`**

```json
"build": {
  "appId": "com.screenshot-taker.app",
  "productName": "Screenshot Taker",
  "mac": {
    "category": "public.app-category.developer-tools",
    "icon": "assets/icon.icns",
    "target": "dir"
  },
  "files": ["src/**/*", "public/**/*", "electron/**/*", "package.json"],
  "extraResources": [
    {
      "from": "${env.HOME}/Library/Caches/ms-playwright",
      "to": "playwright-browsers",
      "filter": ["chromium-*/**", "chromium_headless_shell-*/**"]
    }
  ]
}
```

- [ ] **Step 4: Wire the bundled browser path into `electron/main.js`**

Playwright must be told where to find the bundled Chromium *before* it's
imported anywhere in the process (`createApp` → route handlers → eventually
`playwright`'s `chromium.launch()`). Add this at the very top of
`electron/main.js`, before the existing `import { createApp } ...` line:

```js
import { app } from 'electron';
import path from 'node:path';

if (app.isPackaged) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, 'playwright-browsers');
}
```

Note this means `electron/main.js`'s existing `import { app, BrowserWindow, dialog } from 'electron';`
line (from Task 1) should be merged with this new one rather than duplicated —
end result is one `electron` import at the top, followed by the `PLAYWRIGHT_BROWSERS_PATH`
conditional, followed by the rest of Task 1's code unchanged.

- [ ] **Step 5: Add the `dist` script**

In `package.json`'s `"scripts"`:

```json
"dist": "bash scripts/build-app.sh"
```

- [ ] **Step 6: Write `scripts/build-app.sh`**

```bash
#!/usr/bin/env bash
set -e

npx electron-builder --mac --dir

APP_PATH="dist/mac-arm64/Screenshot Taker.app"
if [ ! -d "$APP_PATH" ]; then
  APP_PATH="dist/mac/Screenshot Taker.app"
fi
if [ ! -d "$APP_PATH" ]; then
  echo "Error: build did not produce a .app bundle" >&2
  exit 1
fi

rm -rf ~/Desktop/"Screenshot Taker.app"
cp -R "$APP_PATH" ~/Desktop/"Screenshot Taker.app"

echo "Done → ~/Desktop/Screenshot Taker.app"
```

Make it executable: `chmod +x scripts/build-app.sh`

- [ ] **Step 7: Build and verify**

Run: `npm run dist`
Expected: completes without error, prints `Done → ~/Desktop/Screenshot Taker.app`.

Then manually verify the packaged app actually works (this is the real
test of the whole feature — packaging bugs only show up in the built
artifact, not in dev mode):
1. `open ~/Desktop/"Screenshot Taker.app"`
2. Confirm a window opens with the Screenshot Taker UI.
3. Run a real capture against a small test site (e.g. `https://example.com`
   or the project's own `test/fixtures/site` via a `file://` local-folder
   run) through the app's UI.
4. Confirm the capture succeeds — this proves the bundled Chromium binary
   was found and works, i.e. `PLAYWRIGHT_BROWSERS_PATH` pointed at the
   right place.
5. Confirm output appears under `~/Library/Application Support/Screenshot Taker/output/`
   (not in the project folder) — proves the `userData`-based output path
   from Task 1 works in a packaged (not just dev-mode) context.
6. Quit the app.

If step 4 fails with a Playwright "browser not found" error, the most
likely cause is the `filter` glob in Step 3 not matching the actual
directory name found in Step 2 — adjust the glob to match and rebuild.

- [ ] **Step 8: Confirm the existing test suite is still untouched**

Run: `npm test`
Expected: PASS, same as before this task.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json scripts/build-app.sh
git commit -m "feat: package Electron app with bundled Chromium via electron-builder"
```

Note: `dist/` (electron-builder's build output directory) should already
be covered by an existing `.gitignore` pattern or needs one added — check
`.gitignore` first; if `dist/` isn't already ignored, add it in this same
commit.

---

### Final Task: Whole-branch review

After Task 3, dispatch a final code reviewer over the full diff against
the base branch before merging. Check in particular:
- `electron` and `electron-builder` are `devDependencies`, not
  `dependencies` (they're build/dev tooling, not runtime code the packaged
  app needs at runtime beyond what electron-builder already embeds).
- `npm test` and `npm start` are provably unaffected — nothing in
  `src/server.js`'s existing exported behavior changed.
- No secrets or machine-specific absolute paths got hardcoded anywhere
  (the `${env.HOME}` templating in the build config should be the only
  home-directory reference, not a literal `/Users/bahaam/...` path).
- `.gitignore` correctly excludes `dist/`, `assets/icon.iconset/`, and
  confirm `~/Desktop/Screenshot Taker.app` itself was never accidentally
  created inside the repo directory instead of the real Desktop.
