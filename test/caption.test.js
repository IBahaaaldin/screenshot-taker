import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCaption } from '../src/caption.js';

const HASHTAGS = '#webdesign #restaurant #instagood #foodie #smallbusiness';

test('uses the slug as the heading when it is a real selector-derived name', () => {
  const caption = generateCaption({
    siteName: 'baba-ganoush',
    pageUrl: 'https://example.com/index.html',
    slug: 'hero',
  });
  assert.equal(caption, `baba-ganoush — hero\n\n${HASHTAGS}`);
});

test('falls back to the page name when the slug is a generic auto-detect slug', () => {
  const caption = generateCaption({
    siteName: 'baba-ganoush',
    pageUrl: 'https://example.com/menu.html',
    slug: 'section-2',
  });
  assert.equal(caption, `baba-ganoush — menu\n\n${HASHTAGS}`);
});

test('falls back to "home" for the site root with a generic slug', () => {
  const caption = generateCaption({
    siteName: 'baba-ganoush',
    pageUrl: 'https://example.com/index.html',
    slug: 'section-0',
  });
  assert.equal(caption, `baba-ganoush — home\n\n${HASHTAGS}`);
});
