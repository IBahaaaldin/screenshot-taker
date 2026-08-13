import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCaption } from '../src/caption.js';

test('uses the slug as the heading when it is a real selector-derived name', () => {
  const caption = generateCaption({
    siteName: 'baba-ganoush',
    pageUrl: 'https://example.com/index.html',
    slug: 'hero',
  });
  assert.match(caption, /^🔥 Just Delivered: baba-ganoush, Digitally Served/);
  assert.match(caption, /a custom hero experience for baba-ganoush/);
});

test('falls back to the page name when the slug is a generic auto-detect slug', () => {
  const caption = generateCaption({
    siteName: 'baba-ganoush',
    pageUrl: 'https://example.com/menu.html',
    slug: 'section-2',
  });
  assert.match(caption, /a custom menu experience for baba-ganoush/);
});

test('falls back to "home" for the site root with a generic slug', () => {
  const caption = generateCaption({
    siteName: 'baba-ganoush',
    pageUrl: 'https://example.com/index.html',
    slug: 'section-0',
  });
  assert.match(caption, /a custom home experience for baba-ganoush/);
});

test('includes the feature checklist and a full hashtag block', () => {
  const caption = generateCaption({
    siteName: 'baba-ganoush',
    pageUrl: 'https://example.com/index.html',
    slug: 'hero',
  });
  assert.match(caption, /Features include:/);
  assert.match(caption, /Fully responsive design \(desktop → tablet → mobile\)/);
  assert.match(caption, /#WebDesign/);
  assert.match(caption, /#UXDesign/);
});

test('ends with a single-line hashtag block (no caption text after it)', () => {
  const caption = generateCaption({
    siteName: 'baba-ganoush',
    pageUrl: 'https://example.com/index.html',
    slug: 'hero',
  });
  const lines = caption.split('\n');
  assert.match(lines[lines.length - 1], /^#WebDesign/);
});
