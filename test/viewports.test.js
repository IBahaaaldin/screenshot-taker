// test/viewports.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { VIEWPORTS } from '../src/viewports.js';

test('VIEWPORTS has exactly the 4 required presets in order', () => {
  assert.deepEqual(VIEWPORTS, [
    { name: 'desktop', width: 1920 },
    { name: 'laptop', width: 1440 },
    { name: 'tablet', width: 768 },
    { name: 'mobile', width: 390 },
  ]);
});
