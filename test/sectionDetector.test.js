// test/sectionDetector.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { detectSections } from '../src/sectionDetector.js';

const TWO_SECTION_HTML = `<!doctype html><html><body>
  <section id="hero" style="height:300px;">Hero</section>
  <section id="features" style="height:400px;">Features</section>
</body></html>`;

const NO_SECTION_HTML = `<!doctype html><html><body>
  <span>just inline text, no block sections</span>
</body></html>`;

test('auto mode finds top-level sections and returns selectors that resolve to them', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.setContent(TWO_SECTION_HTML);
  const sections = await detectSections(page, 'auto');
  assert.equal(sections.length, 2);
  assert.equal(sections[0].slug, 'section-0');
  assert.equal(sections[1].slug, 'section-1');

  const firstId = await page.locator(sections[0].selector).getAttribute('id');
  const secondId = await page.locator(sections[1].selector).getAttribute('id');
  assert.equal(firstId, 'hero');
  assert.equal(secondId, 'features');
  await browser.close();
});

test('auto mode falls back to full-page (null selector) when nothing found', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 200 } });
  await page.setContent(NO_SECTION_HTML);
  const sections = await detectSections(page, 'auto');
  assert.equal(sections.length, 1);
  assert.equal(sections[0].slug, 'section-0');
  assert.equal(sections[0].selector, null);
  await browser.close();
});

test('selectors mode returns one entry per matching selector, selector passed through', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.setContent(TWO_SECTION_HTML);
  const sections = await detectSections(page, 'selectors', ['#hero', '#features', '#missing']);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].slug, 'hero');
  assert.equal(sections[0].selector, '#hero');
  assert.equal(sections[1].slug, 'features');
  assert.equal(sections[1].selector, '#features');
  await browser.close();
});

test('selectors mode dedupes colliding slugs', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.setContent(`<!doctype html><html><body>
    <div class="foo-bar" style="height:100px;">A</div>
    <div class="foo bar" style="height:150px;">B</div>
  </body></html>`);
  const sections = await detectSections(page, 'selectors', ['.foo-bar', '.foo.bar']);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].slug, 'foo-bar');
  assert.equal(sections[1].slug, 'foo-bar-2');
  assert.notEqual(sections[0].slug, sections[1].slug);
  await browser.close();
});

test('full-page mode returns a single entry with a null selector', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.setContent(TWO_SECTION_HTML);
  const sections = await detectSections(page, 'full-page');
  assert.equal(sections.length, 1);
  assert.equal(sections[0].slug, 'section-0');
  assert.equal(sections[0].selector, null);
  await browser.close();
});
