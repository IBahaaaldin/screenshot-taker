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

test('auto mode finds top-level sections', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.setContent(TWO_SECTION_HTML);
  const sections = await detectSections(page, 'auto');
  assert.equal(sections.length, 2);
  assert.equal(sections[0].slug, 'section-0');
  assert.equal(sections[1].slug, 'section-1');
  assert.ok(sections[0].height >= 290 && sections[0].height <= 310);
  await browser.close();
});

test('auto mode falls back to full-page when nothing found', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 200 } });
  await page.setContent(NO_SECTION_HTML);
  const sections = await detectSections(page, 'auto');
  assert.equal(sections.length, 1);
  assert.equal(sections[0].slug, 'section-0');
  assert.equal(sections[0].x, 0);
  assert.equal(sections[0].y, 0);
  await browser.close();
});

test('selectors mode returns one entry per matching selector', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.setContent(TWO_SECTION_HTML);
  const sections = await detectSections(page, 'selectors', ['#hero', '#features', '#missing']);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].slug, 'hero');
  assert.equal(sections[1].slug, 'features');
  await browser.close();
});

test('full-page mode returns a single full-document entry', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.setContent(TWO_SECTION_HTML);
  const sections = await detectSections(page, 'full-page');
  assert.equal(sections.length, 1);
  assert.equal(sections[0].slug, 'section-0');
  await browser.close();
});
