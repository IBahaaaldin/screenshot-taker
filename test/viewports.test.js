// test/viewports.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { VIEWPORTS } from '../src/viewports.js';

test('VIEWPORTS has exactly the 4 required presets in order', () => {
  assert.deepEqual(VIEWPORTS, [
    { name: 'desktop', width: 1920, height: 1080 },
    { name: 'laptop', width: 1440, height: 936 },
    { name: 'tablet', width: 768, height: 1114 },
    { name: 'mobile', width: 390, height: 789 },
  ]);
});

// Every device carries a real screen height, not a shared made-up one. A hero
// built with `min-height: 100vh` is exactly as tall as the viewport it renders
// in, so capturing all four at one height made the phone's hero 1000px where a
// real iPhone gives it 848 — and scaled into the phone frame, that overshoot
// opened a gap under the header the real device does not have.
test('every viewport has a real screen height, and the phone excludes its status bar', () => {
  for (const viewport of VIEWPORTS) {
    assert.ok(
      Number.isInteger(viewport.height) && viewport.height > 0,
      `${viewport.name} needs a real height, got ${viewport.height}`
    );
  }

  // The device frames draw the status bar strip themselves, above the
  // screenshot, so it must not also be inside the screenshot. 789 + 59 is the
  // 848px screen the frame draws.
  const mobile = VIEWPORTS.find((viewport) => viewport.name === 'mobile');
  assert.equal(mobile.height + 59, 848, 'phone viewport plus its status bar should be the full screen');
});
