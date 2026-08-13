#!/usr/bin/env bash
set -e

# electron-builder's ${env.HOME} extraResources templating doesn't resolve
# reliably across versions, so stage the Playwright browser cache into a
# project-relative directory instead and reference that from package.json.
rm -rf .build-playwright-browsers
mkdir -p .build-playwright-browsers
cp -R "$HOME/Library/Caches/ms-playwright/"chromium-* .build-playwright-browsers/ 2>/dev/null || true
cp -R "$HOME/Library/Caches/ms-playwright/"chromium_headless_shell-* .build-playwright-browsers/ 2>/dev/null || true

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
