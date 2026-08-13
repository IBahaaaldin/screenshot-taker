#!/usr/bin/env bash
set -e

# electron-builder's ${env.HOME} extraResources templating doesn't resolve
# reliably across versions, so stage the Playwright browser cache into a
# project-relative directory instead and reference that from package.json.
rm -rf .build-playwright-browsers
mkdir -p .build-playwright-browsers
cp -R "$HOME/Library/Caches/ms-playwright/"chromium-* .build-playwright-browsers/ 2>/dev/null || true
cp -R "$HOME/Library/Caches/ms-playwright/"chromium_headless_shell-* .build-playwright-browsers/ 2>/dev/null || true

if [ -z "$(ls -A .build-playwright-browsers 2>/dev/null)" ]; then
  echo "Error: no Playwright Chromium found in ~/Library/Caches/ms-playwright." >&2
  echo "Run 'npx playwright install chromium' first, then retry." >&2
  rm -rf .build-playwright-browsers
  exit 1
fi

npx electron-builder --mac --dir

rm -rf .build-playwright-browsers

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
