import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCaption } from '../src/caption.js';

const base = { siteName: 'baba-ganoush', pageUrl: 'https://example.com/index.html' };

// The hook, opener, body, feature list and closer are all chosen from a hash of
// the page + section, so these tests assert the invariants rather than one
// fixed wording — see the note at the top of src/caption.js.

test('names the section when the slug is a real selector-derived name', () => {
  const caption = generateCaption({ ...base, slug: 'hero' });
  assert.match(caption, /Hero/);
  assert.match(caption, /Baba Ganoush/);
});

test('falls back to the page name when the slug is a generic auto-detect slug', () => {
  const caption = generateCaption({ ...base, pageUrl: 'https://example.com/menu.html', slug: 'section-2' });
  assert.match(caption, /Menu/);
});

test('falls back to "home" for the site root with a generic slug', () => {
  const caption = generateCaption({ ...base, slug: 'section-0' });
  assert.match(caption, /home/);
});

// "/en" used to caption as "a custom en experience" — the locale segment is
// routing, not a page name.
test('strips a leading locale segment instead of naming the page after it', () => {
  const caption = generateCaption({
    siteName: 'EcoClean',
    pageUrl: 'https://ecoclean.example/en',
    slug: 'section-0',
  });
  assert.match(caption, /home/);
  assert.doesNotMatch(caption, /custom en experience/);
  assert.doesNotMatch(caption, /\ben\b experience/);
});

// A raw path used to be dropped straight into the sentence, e.g.
// "a custom en/products/dish-wash experience".
test('humanises a nested page path rather than pasting the raw URL path', () => {
  const caption = generateCaption({
    siteName: 'EcoClean',
    pageUrl: 'https://ecoclean.example/en/products/dish-wash',
    slug: 'section-3',
  });
  assert.match(caption, /Dish Wash/);
  assert.doesNotMatch(caption, /dish-wash/);
  assert.doesNotMatch(caption, /products\//);
});

test('includes a feature checklist and a hashtag block', () => {
  const caption = generateCaption({ ...base, slug: 'hero' });
  assert.match(caption, /Features include:/);
  const checks = caption.split('\n').filter((l) => l.startsWith('✅'));
  assert.equal(checks.length, 4, 'should list four features');
  const lastLine = caption.split('\n').at(-1);
  assert.ok(lastLine.startsWith('#'), 'caption should end with the hashtag block');
  assert.equal(lastLine.split(' ').length, 12, 'should carry twelve hashtags');
  assert.ok(
    lastLine.split(' ').every((t) => /^#[A-Za-z]+$/.test(t)),
    `hashtag block should be nothing but hashtags, got: ${lastLine}`
  );
});

test('is deterministic — the same section always produces the same caption', () => {
  const a = generateCaption({ ...base, slug: 'section-4' });
  const b = generateCaption({ ...base, slug: 'section-4' });
  assert.equal(a, b);
});

// Instagram reads a stream of byte-identical captions as spam, and a run of this
// tool can post well over a hundred sections from one site.
test('varies the copy across sections instead of repeating one caption', () => {
  const captions = new Set();
  for (const page of ['/', '/about', '/products/one', '/contact']) {
    for (let i = 0; i < 12; i++) {
      captions.add(
        generateCaption({
          siteName: 'baba-ganoush',
          pageUrl: `https://example.com${page}`,
          slug: `section-${i}`,
        })
      );
    }
  }
  // 48 posts; allow some collisions, but nothing like a single repeated caption.
  assert.ok(
    captions.size >= 40,
    `expected mostly-distinct captions across a run, got ${captions.size} distinct out of 48`
  );
});

test('varies the hashtag set rather than sending the same list every time', () => {
  const blocks = new Set();
  for (let i = 0; i < 12; i++) {
    blocks.add(generateCaption({ ...base, slug: `section-${i}` }).split('\n').at(-1));
  }
  assert.ok(blocks.size > 1, 'hashtag block should not be identical on every post');
});

// The Site name field is labelled "Output folder name" and restricted to
// letters/numbers/dots/dashes — nothing tells a user that string also becomes
// the public-facing brand name in every caption. A dashed folder slug used to
// be pasted straight in: "Just Delivered: acme-dental-clinic, Digitally Served".
test('humanizes a dashed siteName into a real brand name instead of pasting the folder slug', () => {
  const caption = generateCaption({
    siteName: 'acme-dental-clinic',
    pageUrl: 'https://example.com/',
    slug: 'section-0',
  });
  assert.match(caption, /Acme Dental Clinic/);
  assert.doesNotMatch(caption, /acme-dental-clinic/);
});

test('leaves an already-proper-cased siteName alone', () => {
  const caption = generateCaption({ ...base, siteName: 'EcoClean', slug: 'section-0' });
  assert.match(caption, /EcoClean/);
});
