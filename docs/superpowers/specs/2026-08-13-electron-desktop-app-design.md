# Electron Desktop App — Design

## Purpose

Package Screenshot Taker as a real double-clickable macOS app on the
Desktop, like the user's existing "Image Splitter.app" — no terminal, no
`npm start`, no navigating to `localhost:3000` manually.

## Scope

One subsystem: an Electron shell around the existing Express app, packaged
into a distributable `.app`. No changes to the pipeline, capture, or
posting logic — the web UI and API are reused as-is.

## Architecture

### Electron main process (`electron/main.js`)

Runs the existing Express app **in-process** (not as a spawned
subprocess) — imports `createApp` from `src/server.js` directly. This
avoids the packaging complexity of spawning a child Node process from
inside an asar-packaged app, and Electron's main process is a full Node
context so Playwright/Chromium capture works the same as it does under
plain `node src/server.js`.

```js
import { app, BrowserWindow } from 'electron';
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
    server.on('error', reject);
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
  await startServer();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- **Output location**: packaged apps can't reliably write inside their
  own `.app` bundle, so output moves to `app.getPath('userData')`
  (`~/Library/Application Support/Screenshot Taker/output`) instead of
  the project-relative `output/` directory `createApp`'s default uses.
  This only affects the Electron entry point — `createApp`'s existing
  default (used by `npm start` and all tests) is untouched.
- **Port**: fixed at 3000, matching `npm start`'s default. Single-user
  desktop app; if 3000 is somehow taken, the `server.on('error', ...)`
  handler surfaces a clear dialog rather than silently failing (see
  Task 1's error-handling step) instead of a fallback-port scheme, which
  would be unnecessary complexity for this use case.

### Playwright/Chromium bundling

Playwright normally downloads its browser binary to
`~/Library/Caches/ms-playwright` on first use — invisible in a dev
terminal, but a packaged app can't casually trigger a 150MB background
download on first launch. Instead:

- `electron-builder`'s `extraResources` copies the **already-downloaded**
  Chromium binary (from the build machine's Playwright cache) into the
  packaged app's `Resources/playwright-browsers` directory.
- `electron/main.js` sets `process.env.PLAYWRIGHT_BROWSERS_PATH` to that
  bundled path *before* any Playwright import happens, so `chromium.launch()`
  finds the bundled binary instead of looking in (or trying to download
  to) the user's cache.
- In dev mode (`npm run electron`), this env var isn't set, so Playwright
  uses its normal cache — no different from running `npm start`.

### Packaging (`electron-builder`)

Config lives under `"build"` in `package.json`:

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

`target: "dir"` produces an unpacked `Screenshot Taker.app` directly
under `dist/mac/` (or `dist/mac-arm64/` on Apple Silicon) — no
dmg/installer needed since the user just wants a double-clickable icon,
not a distributable installer for other people.

### Build script (`scripts/build-app.sh`)

Mirrors the shape of the user's existing Image Splitter `build.sh`:
runs `electron-builder`, verifies the `.app` was produced, then copies
(not moves — leaves the build output in `dist/` in case of rebuild) it
to `~/Desktop/Screenshot Taker.app`, overwriting any previous copy.

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

### App icon

Generated as a simple square PNG (camera/frame motif matching the app's
dark, minimal aesthetic already established in `public/style.css`), then
converted to `.icns` via `iconutil` (standard macOS toolchain, same as
Image Splitter's `AppIcon.iconset` → `AppIcon.icns` approach) as part of
the implementation task, not committed as a design decision here — the
plan will include the exact generation + conversion steps.

## Dependencies

New `devDependencies`: `electron`, `electron-builder`. Not runtime
dependencies of the web app itself — `npm test` and `npm start` are
unaffected.

## Testing

Electron main-process code (`electron/main.js`) is a thin integration
shim with no independently testable logic beyond "does it call
`createApp` with the right `outputRoot` and start listening" — not
practical to unit test without spinning up real Electron (slow, not
what `node:test` is for). Verification is manual: build the app, launch
it, confirm the window opens, confirm a real capture run works end to
end, confirm output lands in the Application Support folder.

`npm test` (the existing Node test suite) must remain fully green and
untouched by this work — this is additive packaging around already-tested
code, not a change to it.

## Out of Scope

- Windows/Linux packaging (macOS only, matching the user's machine and
  Image Splitter precedent).
- Auto-update mechanism.
- Code signing / notarization (fine for personal local use; would only
  matter for distributing to other people, which is out of scope here).
- A DMG installer — `target: "dir"` produces the `.app` directly, no
  installer UI needed for a single local copy.
