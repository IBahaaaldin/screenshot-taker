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
